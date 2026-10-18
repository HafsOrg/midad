// Ayah search core. Plain ES2017, no host APIs: it must run unchanged inside
// Qt's QML JavaScript engine (`.pragma library`, top-level declarations are the
// exports) and under bun. No import/export, no async, no Node/Bun/DOM globals.
//
//   var s = createSearcher(JSON.parse(indexJsonText));
//   s.search("\u0627\u0644\u0644\u0647 \u0644\u0627 \u0627\u0644\u0647 \u0627\u0644\u0627 \u0647\u0648", 10)
//     -> [{ id, key: "2:255", surah: 2, ayah: 255, to: 255, score, dist, kind: "text" }, ...]
//   s.search("baqarah 255") / s.search("2:1-5") -> kind "ref"
//
// Matching model: both the query and the corpus are folded to a skeleton
// (marks stripped, alef/ya/ta-marbuta/hamza variants merged). Candidates come
// from a character-trigram inverted index (idf weighted); they are then verified
// with an approximate-substring edit distance (Damerau/OSA, free start/end in
// the ayah) so typos cost 1-2 instead of killing the match.

var INDEX_VERSION = 1;
var RARE_POSTING_CHARS = 1800; // ~600 ayat of 6236

// Arabic marks: harakat, tanween, shadda, sukun, dagger alef, Quranic annotation
// signs and small letters, tatweel, extended Arabic marks.
var MARKS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640]/g;

/** Fold Arabic text to its search skeleton: letters only, single spaces. */
function foldText(s) {
  s = String(s).replace(MARKS_RE, "");
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    switch (c) {
      case 0x0623: case 0x0625: case 0x0622: case 0x0671: out += "\u0627"; break; // \u0623 \u0625 \u0622 \u0671 -> \u0627
      case 0x0649: case 0x06CC: case 0x0626: out += "\u064A"; break; // \u0649 \u06CC \u0626 -> \u064A
      case 0x0629: out += "\u0647"; break; // \u0629 -> \u0647
      case 0x0624: out += "\u0648"; break; // \u0624 -> \u0648
      case 0x06A9: out += "\u0643"; break; // \u06A9 -> \u0643
      case 0x0621: break; // \u0621 dropped
      default:
        out += (c >= 0x0621 && c <= 0x064A) ? s.charAt(i) : " ";
    }
  }
  return out.replace(/ +/g, " ").replace(/^ | $/g, "");
}

function toAsciiDigits(s) {
  return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (d) {
    var c = d.charCodeAt(0);
    return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
  });
}

// ---- Latin surah-name keys -------------------------------------------------

var LATIN_MAP = {
  "\u0101": "a", "\u012B": "i", "\u016B": "u", "\u0113": "e", "\u014D": "o", "\u0125": "h", "\u0127": "h",
  "\u1E25": "h", "\u1E63": "s", "\u1E0D": "d", "\u1E6D": "t", "\u1E93": "z", "\u02BF": "", "\u02BE": "",
  "\u00E2": "a", "\u00EE": "i", "\u00FB": "u", "\u00E1": "a", "\u00ED": "i", "\u00FA": "u", "\u00E9": "e"
};
var NOISE_TOKENS = { surah: 1, surat: 1, sura: 1, soorah: 1, soorat: 1, chapter: 1, the: 1, of: 1 };

function latinTokens(s) {
  s = String(s).toLowerCase();
  var t = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (LATIN_MAP.hasOwnProperty(ch)) t += LATIN_MAP[ch];
    else if (ch >= "a" && ch <= "z") t += ch;
    else if (ch === "'" || ch === "`" || ch === "\u2019" || ch === "\u2018") t += "";
    else t += " ";
  }
  var parts = t.split(" "), out = [];
  for (var j = 0; j < parts.length; j++) if (parts[j] && !NOISE_TOKENS.hasOwnProperty(parts[j])) out.push(parts[j]);
  return out;
}

/** Phonetic-ish key so baqarah/baqara, yaseen/yasin, taubah/tawbah meet. */
function phon(s) {
  s = s.replace(/ph/g, "f").replace(/kh/g, "x").replace(/gh/g, "g").replace(/sh/g, "s")
    .replace(/th/g, "t").replace(/dh/g, "d").replace(/q/g, "k").replace(/w/g, "u")
    .replace(/[aeiou]/g, "a").replace(/(.)\1+/g, "$1");
  return s.replace(/h$/, "");
}

var ARTICLE_RE = /^(al|an|ar|as|ash|at|az|ad|adh|ath)(?=.{3,})/;

/** All comparable keys for a Latin name: with and without the article. */
function latinKeys(name) {
  var toks = latinTokens(name);
  if (!toks.length) return [];
  var full = toks.join(""), keys = [phon(full)];
  var stripped;
  if (toks.length > 1 && /^(al|an|ar|as|ash|at|az|ad|adh|ath)$/.test(toks[0])) stripped = toks.slice(1).join("");
  else stripped = full.replace(ARTICLE_RE, "");
  var k2 = phon(stripped);
  if (k2 && keys.indexOf(k2) < 0) keys.push(k2);
  return keys;
}

/** Arabic keys for a surah name: folded, spaces removed, with/without \u0627\u0644. */
function arabicKeys(name) {
  var f = foldText(name).replace(/ /g, "");
  var keys = [f];
  if (/^\u0627\u0644./.test(f)) keys.push(f.slice(2));
  return keys;
}

// ---- edit distance ---------------------------------------------------------

/** Min Damerau-OSA distance of q to any substring of t. Early exit above maxD. */
function approxDist(q, t, maxD) {
  var m = q.length, n = t.length, i, j;
  if (m === 0) return 0;
  var p2 = new Int32Array(m + 1), p1 = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (j = 0; j <= m; j++) p1[j] = j;
  var best = m, tmp;
  for (i = 1; i <= n; i++) {
    cur[0] = 0;
    var tc = t.charCodeAt(i - 1), rowMin = cur[0];
    for (j = 1; j <= m; j++) {
      var qc = q.charCodeAt(j - 1);
      var v = p1[j - 1] + (qc === tc ? 0 : 1);
      var d = p1[j] + 1; if (d < v) v = d;
      d = cur[j - 1] + 1; if (d < v) v = d;
      if (i > 1 && j > 1 && qc === t.charCodeAt(i - 2) && q.charCodeAt(j - 2) === tc) {
        d = p2[j - 2] + 1; if (d < v) v = d;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (cur[m] < best) { best = cur[m]; if (best === 0) return 0; }
    tmp = p2; p2 = p1; p1 = cur; cur = tmp;
  }
  return best;
}

function levenshtein(a, b) {
  var m = a.length, n = b.length, prev = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    var cur = [i];
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ---- searcher --------------------------------------------------------------

function decodePosting(str) {
  var out = [], id = 0, parts = str.split(",");
  for (var i = 0; i < parts.length; i++) { id += parseInt(parts[i], 36); out.push(id); }
  return out;
}

/** Build a searcher over a parsed index (see build.ts for the format). */
function createSearcher(index) {
  var N = index.n, texts = index.a, utexts = index.u, post = index.g;
  var starts = [0], i;
  for (i = 0; i < index.sur.length; i++) starts.push(starts[i] + index.sur[i]);
  var decoded = {};
  var scores = new Float32Array(N);
  var CELL_BUDGET = 300000;

  function ayahId(surah, ayah) { return starts[surah - 1] + ayah - 1; }
  function keyOf(id) {
    var s = 1;
    while (starts[s] <= id) s++;
    return { surah: s, ayah: id - starts[s - 1] + 1 };
  }
  function postings(tri) {
    var d = decoded[tri];
    if (d === undefined) {
      var raw = post[tri];
      d = raw === undefined ? null : decodePosting(raw);
      decoded[tri] = d;
    }
    return d;
  }
  function utext(id) { return utexts[id] === "" ? texts[id] : utexts[id]; }

  function make(id, extra) {
    var k = keyOf(id);
    var r = { id: id, key: k.surah + ":" + k.ayah, surah: k.surah, ayah: k.ayah, to: k.ayah, score: 0, dist: 0, kind: "text" };
    for (var p in extra) r[p] = extra[p];
    return r;
  }

  // ---- references ----------
  function findSurah(namePart) {
    var latin = /[a-zA-Z]/.test(namePart);
    var qkeys;
    if (latin) qkeys = latinKeys(namePart);
    else {
      var f = foldText(namePart.replace(/(^|\s)(\u0633\u0648\u0631\u0647|\u0633\u0648\u0631\u0629)(\s|$)/g, " "));
      qkeys = arabicKeys(f);
    }
    if (!qkeys.length || !qkeys[0]) return 0;
    var bestS = 0, bestD = 99, s, a, b;
    for (s = 0; s < index.names.length; s++) {
      var keys = latin ? index.names[s].l : index.names[s].a;
      for (a = 0; a < qkeys.length; a++) {
        for (b = 0; b < keys.length; b++) {
          var kq = qkeys[a], kk = keys[b], d;
          if (!kq || !kk) continue;
          if (kq === kk) d = 0;
          else {
            var lim = Math.min(kq.length, kk.length) >= 7 ? 2 : (Math.min(kq.length, kk.length) >= 4 ? 1 : 0);
            if (lim === 0 || Math.abs(kq.length - kk.length) > lim) continue;
            d = levenshtein(kq, kk);
            if (d > lim) continue;
            d += 0.5; // fuzzy is worse than exact
          }
          if (d < bestD) { bestD = d; bestS = s + 1; }
        }
      }
    }
    return bestS;
  }

  function parseReference(q) {
    var s = toAsciiDigits(q).replace(/[\u060C\u061B]/g, ",").replace(/\u066B/g, ".").trim();
    var m = /^(\d{1,3})\s*[:.\/,\-\s]\s*(\d{1,3})(?:\s*[-\u2013\u2014~]\s*(\d{1,3}))?$/.exec(s), surah, from, to;
    if (m) { surah = +m[1]; from = +m[2]; to = m[3] ? +m[3] : from; }
    else {
      m = /^(\D+?)[\s:.,\/\-]*(\d{1,3})(?:\s*[-\u2013\u2014~]\s*(\d{1,3}))?$/.exec(s);
      if (!m || !/[\u0621-\u064Aa-zA-Z]/.test(m[1])) return null;
      surah = findSurah(m[1]);
      if (!surah) return null;
      from = +m[2]; to = m[3] ? +m[3] : from;
    }
    if (surah < 1 || surah > index.sur.length) return null;
    var cnt = index.sur[surah - 1];
    if (to < from) { var t = from; from = to; to = t; }
    if (from < 1 || from > cnt) return null;
    if (to > cnt) to = cnt;
    return { surah: surah, from: from, to: to };
  }

  // ---- text ----------
  function trigrams(q) {
    var seen = {}, out = [];
    for (var k = 0; k + 3 <= q.length; k++) {
      var g = q.substr(k, 3);
      if (!seen[g]) { seen[g] = 1; out.push(g); }
    }
    return out;
  }

  function searchText(raw, limit) {
    var q = foldText(raw);
    if (q.length === 0) return [];
    var m = q.length, cands = [], c, k;
    var found = {}; // id -> {d, sc}

    if (m < 3) {
      for (c = 0; c < N; c++) {
        if (texts[c].indexOf(q) >= 0 || utext(c).indexOf(q) >= 0) cands.push(c);
      }
      cands.sort(function (x, y) { return Math.abs(texts[x].length - m) - Math.abs(texts[y].length - m) || x - y; });
      return cands.slice(0, limit).map(function (id) { return make(id, { score: 0.5, dist: 0 }); });
    }

    var tris = trigrams(q), touched = [];
    // Frequent trigrams (long posting strings) cost the most and discriminate the
    // least: when at least two rare trigrams exist, score from those alone.
    var rare = 0;
    for (k = 0; k < tris.length; k++) {
      var raw = post[tris[k]];
      if (raw !== undefined && raw.length <= RARE_POSTING_CHARS) rare++;
    }
    for (k = 0; k < tris.length; k++) {
      if (rare >= 2 && post[tris[k]] !== undefined && post[tris[k]].length > RARE_POSTING_CHARS) continue;
      var p = postings(tris[k]);
      if (!p) continue;
      var w = Math.log(1 + N / p.length);
      for (var j = 0; j < p.length; j++) {
        var id = p[j];
        if (scores[id] === 0) touched.push(id);
        scores[id] += w;
      }
    }
    var maxScore = 0;
    for (k = 0; k < touched.length; k++) if (scores[touched[k]] > maxScore) maxScore = scores[touched[k]];
    var floor = maxScore * 0.25, pool = [];
    for (k = 0; k < touched.length; k++) {
      c = touched[k];
      if (scores[c] >= floor) pool.push(c);
    }
    pool.sort(function (x, y) { return scores[y] - scores[x] || x - y; });
    var sc = {};
    for (k = 0; k < pool.length; k++) sc[pool[k]] = scores[pool[k]];
    for (k = 0; k < touched.length; k++) scores[touched[k]] = 0;

    // stage 1: exact substring in either form (cheap, native indexOf)
    var res = [], rest = [];
    for (k = 0; k < pool.length; k++) {
      c = pool[k];
      if (texts[c].indexOf(q) >= 0 || utext(c).indexOf(q) >= 0) res.push({ id: c, d: 0, sc: sc[c] });
      else rest.push(c);
    }
    // stage 2: approximate verification of the best remaining candidates
    if (res.length < limit) {
      var cells = 0;
      for (k = 0; k < rest.length; k++) {
        c = rest[k];
        var cost = m * (texts[c].length + (utexts[c] === "" ? 0 : utexts[c].length));
        if (k >= limit && cells + cost > CELL_BUDGET) break;
        cells += cost;
        var d = approxDist(q, texts[c]);
        if (utexts[c] !== "" && d > 0) { var d2 = approxDist(q, utexts[c]); if (d2 < d) d = d2; }
        res.push({ id: c, d: d, sc: sc[c] });
      }
    }
    res.sort(function (x, y) {
      return x.d - y.d ||
        Math.abs(texts[x.id].length - m) - Math.abs(texts[y.id].length - m) ||
        y.sc - x.sc || x.id - y.id;
    });
    var out = [];
    for (k = 0; k < res.length && out.length < limit; k++) {
      out.push(make(res[k].id, { dist: res[k].d, score: Math.max(0, 1 - res[k].d / m) }));
    }
    return out;
  }

  function search(query, limit) {
    limit = limit || 10;
    var q = String(query == null ? "" : query);
    var ref = parseReference(q);
    if (ref) {
      var id = ayahId(ref.surah, ref.from);
      var r = make(id, { to: ref.to, score: 2, kind: "ref" });
      return [r];
    }
    return searchText(q, limit);
  }

  return { search: search, fold: foldText, ayahId: ayahId, parseReference: parseReference };
}
