// Moving inserts up and down a page's typed text. Plain ES2017 with no host APIs, so it runs
// unchanged in Qt's QML JavaScript engine (imported by AyahBar.qml) and under bun (tests).
//
// xochitl gives a page one typed-text flow, so an insert moves by trading the empty lines just
// below it for empty lines above it, or back. Edits only ever remove newlines or add them next
// to existing ones: the insert's own characters never move, so its paragraph style and any
// handwriting anchored to it come along.

var QURAN_MARK = /[ٱۖ-ۜ۟ۡۥۦ]/;

// A paragraph the font shim treats as an insert: an ayah (U+2061) or hadith (U+2062) tag near
// the start, or a mark only the KFGQPC Quran text uses, which also catches ayat inserted before
// the tags existed.
function isInsert(paragraph) {
    for (var i = 0; i < paragraph.length && i < 4; i++) {
        var c = paragraph.charAt(i);
        if (c === "⁡" || c === "⁢")
            return true;
    }
    return QURAN_MARK.test(paragraph);
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
