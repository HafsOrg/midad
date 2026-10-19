// The midad layer: ayat and hadith drawn by the bar over a page, kept in midad's own file
// instead of xochitl's typed text, so xochitl never pins handwriting to them. Plain ES2017 with
// no host APIs, so it runs unchanged in Qt's QML JavaScript engine (imported by AyahBar.qml) and
// under bun (tests).
//
// One document's layer is a JSON value: {"rev":n,"v":1,"pages":{"<page id>":[insert, ...]}}, with
// rev first so a write can be found in the saved file. An insert is
// {id, kind: "ayah"|"hadith", text, ref, x, y, w, size}, in scene units: x, y is its top-left
// corner, w its width, size its font's pixel size; its height follows from the text.

var SIZES = [28, 32, 36, 40, 44, 50, 56, 64, 72, 84];
var DEFAULT_SIZE = { ayah: 44, hadith: 36 };
var MIN_WIDTH = 200;

function emptyDoc() {
    return { rev: 0, v: 1, pages: {} };
}

// The stored value for a document: { doc, ok }. ok is false when the value is there but can't be
// read, and then nothing may be written over it.
function parseDoc(raw) {
    if (raw === undefined || raw === null || raw === "")
        return { doc: emptyDoc(), ok: true };
    try {
        var j = JSON.parse(String(raw));
        if (j && typeof j === "object" && !Array.isArray(j) && j.pages && typeof j.pages === "object"
            && !Array.isArray(j.pages))
            return { doc: { rev: typeof j.rev === "number" ? j.rev : 0, v: 1, pages: j.pages }, ok: true };
    } catch (e) {
    }
    return { doc: emptyDoc(), ok: false };
}

function finite(n) {
    return typeof n === "number" && isFinite(n);
}

function isInsert(o) {
    return !!o && typeof o === "object" && typeof o.id === "string" && o.id !== ""
        && (o.kind === "ayah" || o.kind === "hadith") && typeof o.text === "string"
        && finite(o.x) && finite(o.y) && finite(o.w) && o.w > 0 && finite(o.size) && o.size > 0;
}

// The page's list as stored (entries this version can't draw included), and the drawable ones.
function storedPage(doc, page) {
    var list = doc && doc.pages ? doc.pages[page] : null;
    return Array.isArray(list) ? list : [];
}

function pageInserts(doc, page) {
    return storedPage(doc, page).filter(isInsert);
}

// A new document value with the page's list replaced; an empty list drops the page.
function withPage(doc, page, list) {
    var pages = {};
    for (var k in doc.pages)
        if (k !== page)
            pages[k] = doc.pages[k];
    if (list.length)
        pages[page] = list;
    return { rev: doc.rev + 1, v: 1, pages: pages };
}

function serialize(doc) {
    return JSON.stringify({ rev: doc.rev, v: 1, pages: doc.pages });
}

// Edits that leave every other entry, readable or not, exactly as it was.
function patchInsert(list, id, patch) {
    return list.map(function (o) {
        if (!o || o.id !== id)
            return o;
        var n = {};
        for (var k in o)
            n[k] = o[k];
        for (var p in patch)
            n[p] = patch[p];
        return n;
    });
}

function removeInsert(list, id) {
    return list.filter(function (o) { return !o || o.id !== id; });
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Moving by (dx, dy) from the box's place at the start of the drag; the box stays on the page.
function moved(from, dx, dy, h, page) {
    return {
        x: clamp(from.x + dx, page.x, Math.max(page.x, page.x + page.width - from.w)),
        y: clamp(from.y + dy, page.y, Math.max(page.y, page.y + page.height - h))
    };
}

// The width handle sits on the left edge: the left edge follows the drag and the right edge,
// where the text starts, stays.
function widened(from, dx, page) {
    var right = from.x + from.w;
    var left = clamp(from.x + dx, Math.min(page.x, right - MIN_WIDTH), right - MIN_WIDTH);
    return { x: left, w: right - left };
}

// The next size up (dir > 0) or down from size, staying within SIZES.
function stepSize(size, dir) {
    if (dir > 0) {
        for (var i = 0; i < SIZES.length; i++)
            if (SIZES[i] > size)
                return SIZES[i];
        return SIZES[SIZES.length - 1];
    }
    for (var j = SIZES.length - 1; j >= 0; j--)
        if (SIZES[j] < size)
            return SIZES[j];
    return SIZES[0];
}

// Where a new insert of width w goes: centred on the part of the page in view, near its top, or
// under the lowest insert in view when there is room for about h more. boxes are the page's
// inserts as {x, y, w, h}. Everything in scene units.
function placeNew(page, view, boxes, w, h) {
    var left = Math.max(page.x, view.x);
    var right = Math.min(page.x + page.width, view.x + view.width);
    var top = Math.max(page.y, view.y);
    var bottom = Math.min(page.y + page.height, view.y + view.height);
    var width = Math.max(MIN_WIDTH, Math.min(w, right - left));
    var x = clamp(Math.round((left + right - width) / 2), page.x, Math.max(page.x, page.x + page.width - width));
    var y = top;
    var gap = 24;
    for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var below = b.y + b.h + gap;
        if (b.y + b.h > top && b.y < bottom && below > y && below + h <= bottom)
            y = below;
    }
    return { x: x, y: clamp(Math.round(y), page.y, Math.max(page.y, page.y + page.height - h)), w: width };
}

// The rev of a document's layer as saved in the INI file's text, or -1. QSettings writes the
// value quoted (it holds commas) with each " escaped, and keeps a document id's characters.
function savedRev(ini, docId) {
    var lead = "\n" + docId + '="{\\"rev\\":';
    var text = "\n" + String(ini);
    var at = text.indexOf(lead);
    if (at < 0)
        return -1;
    var m = /^[0-9]+,/.exec(text.slice(at + lead.length, at + lead.length + 20));
    return m ? parseInt(m[0], 10) : -1;
}

function newId(now, random) {
    return now.toString(36) + "-" + Math.floor(random * 1679616).toString(36);
}
