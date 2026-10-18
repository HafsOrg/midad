// Moving inserts up and down a page's typed text. Plain ES2017 with no host APIs, so it runs
// unchanged in Qt's QML JavaScript engine (imported by AyahBar.qml) and under bun (tests).
//
// xochitl gives a page one typed-text flow, so an insert moves by trading the empty lines just
// below it for empty lines above it, or back. Edits only ever remove newlines or add them next
// to existing ones: the insert's own characters never move, so its paragraph style and any
// handwriting anchored to it come along.

var QURAN_MARK = /[ٱۖ-ۜ۟ۡۥۦ]/;

// Index of the ayah (U+2061) or hadith (U+2062) tag near the paragraph's start, or -1.
function tagIndex(paragraph) {
    for (var i = 0; i < paragraph.length && i < 4; i++) {
        var c = paragraph.charAt(i);
        if (c === "⁡" || c === "⁢")
            return i;
    }
    return -1;
}

// A paragraph the font shim treats as an insert: a tag near the start, or a mark only the
// KFGQPC Quran text uses, which also catches ayat inserted before the tags existed.
function isInsert(paragraph) {
    return tagIndex(paragraph) >= 0 || QURAN_MARK.test(paragraph);
}

// Sideways placement. Six variation selectors (U+FE00..U+FE0F, invisible) right after the tag
// hold the paragraph's right and left margins in scene units as hex digits, each biased by
// 2048; the font shim lays the paragraph out with those margins. No run means 0, 0.
var PLACEMENT_BIAS = 2048;

function placementOf(paragraph) {
    var t = tagIndex(paragraph);
    if (t < 0 || paragraph.length < t + 7)
        return { right: 0, left: 0, run: false };
    var v = 0;
    for (var k = 1; k <= 6; k++) {
        var d = paragraph.charCodeAt(t + k) - 0xFE00;
        if (d < 0 || d > 15)
            return { right: 0, left: 0, run: false };
        v = v * 16 + d;
    }
    return { right: Math.floor(v / 4096) - PLACEMENT_BIAS, left: v % 4096 - PLACEMENT_BIAS, run: true };
}

function placementRun(right, left) {
    var v = (right + PLACEMENT_BIAS) * 4096 + left + PLACEMENT_BIAS;
    var s = "";
    for (var shift = 20; shift >= 0; shift -= 4)
        s += String.fromCharCode(0xFE00 + (Math.floor(v / Math.pow(2, shift)) & 15));
    return s;
}

// The edit that gives the insert [start, end) of text a new placement, as [from, to, text], and
// how much longer the insert gets. It rewrites the tag along with any old run, so that undoing
// it inserts text again (the shim only sees inserts). An ayah from before the tags gets one.
function planPlacement(text, start, end, right, left) {
    var p = text.slice(start, end);
    var t = tagIndex(p);
    var run = placementRun(right, left);
    if (t < 0)
        return { edit: [start, start + 1, "⁡" + run + p.charAt(0)], grow: 7 };
    var old = placementOf(p).run ? 6 : 0;
    return { edit: [start + t, start + t + 1 + old, p.charAt(t) + run], grow: 6 - old };
}

// The insert holding the cursor as { start, end } (end is where its newline sits), or null.
function insertAt(text, cursor) {
    if (cursor < 0 || cursor > text.length)
        return null;
    var start = cursor > 0 ? text.lastIndexOf("\n", cursor - 1) + 1 : 0;
    var end = text.indexOf("\n", cursor);
    if (end < 0)
        end = text.length;
    return start < end && isInsert(text.slice(start, end)) ? { start: start, end: end } : null;
}

// The first insert on the page, in insertAt's shape, or null.
function firstInsert(text) {
    for (var start = 0; start <= text.length;) {
        var nl = text.indexOf("\n", start);
        var end = nl < 0 ? text.length : nl;
        if (end > start && isInsert(text.slice(start, end)))
            return { start: start, end: end };
        if (nl < 0)
            break;
        start = nl + 1;
    }
    return null;
}

// The empty lines around the paragraph [start, end) and what lies past them:
//   emptyAbove  empty lines between it and the text above, or the page's start
//   deleteFrom  where removing those starts: the newline that ends the text above (so that
//               paragraph keeps its style when they merge into it), or 0 when there is none
//   emptyBelow  empty lines between it and the text below, or the page's end
//   textBelow   whether any text follows
function layoutAround(text, start, end, cursor) {
    var r = start - 1;
    while (r >= 0 && text.charAt(r) === "\n")
        r--;
    var f = end;
    while (f < text.length && text.charAt(f) === "\n")
        f++;
    var textBelow = f < text.length;
    return {
        start: start,
        end: end,
        cursor: cursor,
        emptyAbove: r >= 0 ? start - r - 2 : start,
        deleteFrom: r + 1,
        emptyBelow: textBelow ? f - end - 1 : f - end,
        textBelow: textBelow
    };
}

// Moves the paragraph k lines (k > 0 is down; up stops at the text above). Returns the lines
// actually moved, the edits as [from, to, text] ranges to replace, in the order to apply them
// (each lies before the ones already applied, so its indices still hold), and the layout
// afterwards. Moving down takes empty lines from below first, so the text below keeps its
// place while they last. Moving up adds empty lines below to hold the text below in place,
// unless keepBelow is false.
function planMove(layout, k, keepBelow) {
    var m = layout;
    var lines = Math.max(k, -m.emptyAbove);
    var edits = [];
    var below = m.emptyBelow;
    if (lines > 0) {
        var d = Math.min(lines, m.emptyBelow);
        if (d > 0)
            edits.push([m.end, m.end + d, ""]);
        below -= d;
        // After the text above, so the new lines take that paragraph's next style; at the page's
        // start there is nothing above, and the paragraph itself has to split.
        var at = m.start > 0 ? m.start - 1 : 0;
        edits.push([at, at, "\n".repeat(lines)]);
    } else if (lines < 0) {
        if (m.textBelow && keepBelow) {
            edits.push([m.end, m.end, "\n".repeat(-lines)]);
            below -= lines;
        }
        edits.push([m.deleteFrom, m.deleteFrom - lines, ""]);
    }
    return {
        lines: lines,
        edits: edits,
        after: {
            start: m.start + lines,
            end: m.end + lines,
            cursor: m.cursor + lines,
            emptyAbove: m.emptyAbove + lines,
            deleteFrom: m.deleteFrom,
            emptyBelow: below,
            textBelow: m.textBelow
        }
    };
}

// planMove plus a new placement (right, left) for the insert in layout, which text holds. The
// placement edit sits inside the insert, so it goes after the edits below the insert and before
// those above it (an insert at the page's start is rewritten before lines go in front of it).
function planMoveTo(text, layout, k, keepBelow, right, left) {
    var plan = planMove(layout, k, keepBelow);
    var now = placementOf(text.slice(layout.start, layout.end));
    if (now.right === right && now.left === left)
        return plan;
    var place = planPlacement(text, layout.start, layout.end, right, left);
    var below = plan.edits.filter(function (e) { return e[0] >= layout.end; });
    var above = plan.edits.filter(function (e) { return e[0] < layout.end; });
    var a = plan.after;
    var shift = layout.cursor > place.edit[0] ? place.grow : 0;
    return {
        lines: plan.lines,
        edits: below.concat([place.edit], above),
        after: {
            start: a.start,
            end: a.end + place.grow,
            cursor: a.cursor + shift,
            emptyAbove: a.emptyAbove,
            deleteFrom: a.deleteFrom,
            emptyBelow: a.emptyBelow,
            textBelow: a.textBelow
        }
    };
}
