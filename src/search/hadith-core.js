// Hadith search core. Plain ES2017, no host APIs: it must run unchanged inside
// Qt's QML JavaScript engine and under bun. No import/export, no async, no
// Node/Bun/DOM globals. Sibling of core.js (same folding and matching model,
// duplicated on purpose so the Quran core and its tests stay untouched).
//
//   var s = createHadithSearcher(JSON.parse(hadithIndexJsonText));
//   s.search("إنما الأعمال بالنيات", 10)
//     -> [{ id, score, kind: "text" }, ...]       id indexes hadith.json "items"
//   s.search("bukhari 1") / s.search("مسلم ٨") -> [{ id, score: 2, kind: "ref" }]
//
// Matching: query and corpus are folded to a skeleton (marks stripped, alef/ya/
// ta-marbuta/hamza variants merged). Candidates come from a character-trigram
// inverted index (idf weighted), then are verified with an approximate-substring
// edit distance (Damerau/OSA, free start/end in the matn) so typos cost 1-2.

var HADITH_INDEX_VERSION = 1;
var HADITH_RARE_POSTING_CHARS = 4000; // ~10% of the corpus

var HADITH_MARKS_RE = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g;

/** Fold Arabic text to its search skeleton: letters only, single spaces. */
function foldText(s) {
  s = String(s).replace(HADITH_MARKS_RE, "");
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    switch (c) {
      case 0x0623: case 0x0625: case 0x0622: case 0x0671: out += "ا"; break;
      case 0x0649: case 0x06CC: case 0x0626: out += "ي"; break;
      case 0x0629: out += "ه"; break;
      case 0x0624: out += "و"; break;
      case 0x06A9: out += "ك"; break;
      case 0x0621: break;
      default:
        out += (c >= 0x0621 && c <= 0x064A) ? s.charAt(i) : " ";
    }
  }
  return out.replace(/ +/g, " ").replace(/^ | $/g, "");
}

function toAsciiDigits(s) {
  return String(s).replace(/[٠-٩۰-۹]/g, function (d) {
    var c = d.charCodeAt(0);
    return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
  });
}

/** Min Damerau-OSA distance of q to any substring of t. */
function approxDist(q, t) {
  var m = q.length, n = t.length, i, j;
  if (m === 0) return 0;
  var p2 = new Int32Array(m + 1), p1 = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (j = 0; j <= m; j++) p1[j] = j;
  var best = m, tmp;
  for (i = 1; i <= n; i++) {
    cur[0] = 0;
    var tc = t.charCodeAt(i - 1);
    for (j = 1; j <= m; j++) {
      var qc = q.charCodeAt(j - 1);
      var v = p1[j - 1] + (qc === tc ? 0 : 1);
      var d = p1[j] + 1; if (d < v) v = d;
      d = cur[j - 1] + 1; if (d < v) v = d;
      if (i > 1 && j > 1 && qc === t.charCodeAt(i - 2) && q.charCodeAt(j - 2) === tc) {
        d = p2[j - 2] + 1; if (d < v) v = d;
      }
      cur[j] = v;
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

function decodePosting(str) {
  var out = [], id = 0, parts = str.split(",");
  for (var i = 0; i < parts.length; i++) { id += parseInt(parts[i], 36); out.push(id); }
  return out;
}

// Book names: [bookIndex, key, maxEdits]. Arabic keys are folded with spaces and "ال"/"صحيح" removed.
var HADITH_BOOK_KEYS = [
  [0, "bukhari", 2], [0, "buhari", 1], [0, "bokhari", 1], [0, "بخاري", 1],
  [1, "muslim", 2], [1, "moslem", 1], [1, "مسلم", 1]
];

function hadithBookOf(name) {
  var latin = /[a-zA-Z]/.test(name), key;
  if (latin) {
    key = name.toLowerCase().replace(/\b(sahih|saheeh|al|el|imam)\b/g, " ").replace(/[^a-z]/g, "");
  } else {
    key = foldText(name).replace(/(^| )(صحيح|الامام|كتاب)(?= |$)/g, " ").replace(/ /g, "");
    key = key.replace(/^ال(?=.{3})/, "");
  }
  if (!key) return -1;
  var best = -1, bestD = 99;
  for (var i = 0; i < HADITH_BOOK_KEYS.length; i++) {
    var k = HADITH_BOOK_KEYS[i];
    if (/[a-z]/.test(k[1]) !== latin) continue;
    var d = levenshtein(key, k[1]);
    if (d <= k[2] && d < bestD) { bestD = d; best = k[0]; }
  }
  return best;
}

/** Build a searcher over a parsed index (see src/hadith/build.ts for the format). */
function createHadithSearcher(index) {
  var N = index.n, texts = index.a, post = index.g, nums = index.num, bs = index.bs;
  var decoded = {};
  var scores = new Float32Array(N);
  var CELL_BUDGET = 400000;
  var i;

  // ---- references: per book, number string -> first id, and ids sorted by whole number
  var books = [];
  (function () {
    for (var b = 0; b < bs.length - 1; b++) {
      var byStr = {}, list = [];
      for (var id = bs[b]; id < bs[b + 1]; id++) {
        if (nums[id] === "") continue;
        if (byStr[nums[id]] === undefined) byStr[nums[id]] = id;
        list.push({ w: parseInt(nums[id], 10), id: id });
      }
      list.sort(function (x, y) { return x.w - y.w || x.id - y.id; });
      books.push({ byStr: byStr, list: list });
    }
  })();

  function lookup(b, numStr, whole) {
    var bk = books[b];
    if (bk.byStr[numStr] !== undefined) return bk.byStr[numStr];
    var lo = 0, hi = bk.list.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (bk.list[mid].w < whole) lo = mid + 1; else hi = mid; }
    var up = bk.list[lo], down = bk.list[lo - 1];
    if (up && up.w === whole) return up.id;
    if (up && down) return (whole - down.w) < (up.w - whole) ? down.id : up.id;
    return (up || down).id;
  }

  function parseReference(q) {
    var s = toAsciiDigits(q).replace(/[،؛]/g, ",").trim();
    var m = /^(\D+?)[\s:.,\/#\-]*(\d{1,5})\s*([a-zA-Z]{1,2})?$/.exec(s);
    if (!m || !/[ء-يa-zA-Z]/.test(m[1])) return null;
    var b = hadithBookOf(m[1]);
    if (b < 0 || !books[b] || !books[b].list.length) return null;
    var whole = parseInt(m[2], 10);
    return { book: b, id: lookup(b, m[2] + (m[3] ? m[3].toLowerCase() : ""), whole) };
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

  function trigrams(q) {
    var seen = {}, out = [];
    for (var k = 0; k + 3 <= q.length; k++) {
      var g = q.substr(k, 3);
      if (!seen[g]) { seen[g] = 1; out.push(g); }
    }
    return out;
  }

  function MAX_EDITS(m) { return Math.max(2, Math.floor(m / 3)); }

  /**
   * Edit distance of q to the best place in t, checked only around the places where one of
   * q's trigrams occurs verbatim (a few edits leave most trigrams intact). Much cheaper than
   * sliding q over the whole matn; a matn with no trigram hit is out (99).
   */
  function windowDist(q, t, budget) {
    var m = q.length, n = t.length, best = 99, diags = [], k, pos;
    for (k = 0; k + 3 <= m && diags.length < 6; k++) {
      pos = t.indexOf(q.substr(k, 3));
      var guard = 0;
      while (pos >= 0 && guard++ < 3 && diags.length < 6) {
        var diag = pos - k, dup = false;
        for (var x = 0; x < diags.length; x++) if (Math.abs(diags[x] - diag) <= 2) { dup = true; break; }
        if (!dup) diags.push(diag);
        pos = t.indexOf(q.substr(k, 3), pos + 1);
      }
    }
    for (var w = 0; w < diags.length; w++) {
      var from = Math.max(0, diags[w] - 3), to = Math.min(n, diags[w] + m + 3);
      budget.cells += m * (to - from);
      var d = approxDist(q, t.substring(from, to));
      if (d < best) { best = d; if (best === 0) break; }
    }
    return best;
  }

  function searchText(raw, limit) {
    var q = foldText(raw);
    if (q.length === 0) return [];
    var m = q.length, c, k, cands = [];

    if (m < 3) {
      for (c = 0; c < N; c++) if (texts[c].indexOf(q) >= 0) cands.push(c);
      cands.sort(function (x, y) { return texts[x].length - texts[y].length || x - y; });
      return cands.slice(0, limit).map(function (id) { return { id: id, score: 0.5, kind: "text" }; });
    }

    var tris = trigrams(q), touched = [], rare = 0;
    for (k = 0; k < tris.length; k++) {
      var rawp = post[tris[k]];
      if (rawp !== undefined && rawp.length <= HADITH_RARE_POSTING_CHARS) rare++;
    }
    for (k = 0; k < tris.length; k++) {
      if (rare >= 2 && post[tris[k]] !== undefined && post[tris[k]].length > HADITH_RARE_POSTING_CHARS) continue;
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
    var floor = maxScore * 0.3, pool = [];
    for (k = 0; k < touched.length; k++) if (scores[touched[k]] >= floor) pool.push(touched[k]);
    pool.sort(function (x, y) { return scores[y] - scores[x] || x - y; });
    var sc = {};
    for (k = 0; k < pool.length; k++) sc[pool[k]] = scores[pool[k]];
    for (k = 0; k < touched.length; k++) scores[touched[k]] = 0;

    // stage 1: exact substring (native indexOf); stage 2: approximate verification
    var res = [], rest = [];
    for (k = 0; k < pool.length; k++) {
      c = pool[k];
      if (texts[c].indexOf(q) >= 0) res.push({ id: c, d: 0, sc: sc[c] });
      else rest.push(c);
    }
    if (res.length < limit) {
      var budget = { cells: 0 };
      for (k = 0; k < rest.length; k++) {
        c = rest[k];
        if (budget.cells > CELL_BUDGET && k >= limit) break;
        var wd = windowDist(q, texts[c], budget);
        if (wd <= MAX_EDITS(m)) res.push({ id: c, d: wd, sc: sc[c] });
      }
    }
    res.sort(function (x, y) {
      return x.d - y.d || y.sc - x.sc || texts[x.id].length - texts[y.id].length || x.id - y.id;
    });
    var out = [];
    for (k = 0; k < res.length && out.length < limit; k++) {
      out.push({ id: res[k].id, score: Math.max(0, 1 - res[k].d / m), kind: "text" });
    }
    return out;
  }

  function search(query, limit) {
    limit = limit || 10;
    var q = String(query == null ? "" : query);
    var ref = parseReference(q);
    if (ref) return [{ id: ref.id, score: 2, kind: "ref" }];
    return searchText(q, limit);
  }

  return { search: search, fold: foldText, parseReference: parseReference };
}
