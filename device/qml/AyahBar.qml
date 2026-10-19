// Ayah bar: floating buttons on note and PDF pages that open a fuzzy ayah or hadith search.
// The chosen ayat (KFGQPC Uthmanic HAFS v22) or hadith (Amiri) go into the midad layer: drawn
// here over the page and kept in midad's own file, never in xochitl's typed text, so xochitl
// never pins handwriting to them. A finger tap selects an insert; selected, it moves with a
// finger or the pen, a handle sets its width, and its toolbar sizes or removes it.
// Loaded by midad.qmd inside xochitl's DeviceSceneView; `sceneView` is that view's root.
import QtQuick
import QtCore as QC
import com.remarkable
import common
import xofm.libs.peninput
import "search.js" as Search
import "hadith-search.js" as HadithSearch
import "layer.js" as Layer

Item {
    id: bar
    anchors.fill: parent

    property var sceneView: null
    readonly property bool pdfPage: !!sceneView && !!sceneView.document && sceneView.document.fileType === Document.Pdf
    readonly property bool active: !!sceneView && !!sceneView.controller && (sceneView.notePage || pdfPage)
    visible: active

    readonly property string dataDir: "file:///home/root/midad/data/"
    readonly property string quranFont: "kfgqpc_hafs_uthmanic_script"
    readonly property string hadithFont: "Amiri"
    readonly property string uiFont: "Noto Naskh Arabic UI"

    // "ayah" or "hadith": which button opened the panel.
    property string mode: "ayah"

    property var searcher: null
    property var quran: null
    property var surahs: null
    property var hadithSearcher: null
    property var hadith: null
    readonly property bool ready: mode === "ayah" ? (!!searcher && !!quran && !!surahs)
                                                 : (!!hadithSearcher && !!hadith)
    // Per mode, so a failed hadith load never blocks the ayah search; retried on each open.
    property var loadErrors: ({})
    property var loading: ({})
    readonly property string loadError: loadErrors[mode] || ""

    property var results: []
    property int selected: -1
    property int span: 1
    property int lastSearchMs: -1
    property var lastInsert: ({})

    // The midad layer (layer.js has the format): one INI file for every document, which QSettings
    // writes through a temporary file and a rename. It sits outside /home/root/midad, so
    // installing and uninstalling never touch it.
    readonly property string layerFile: "file:///home/root/.local/share/midad/layer.ini"
    QC.Settings {
        id: layerStore
        location: bar.layerFile
        category: "layer"
    }

    readonly property string docId: active && sceneView.document ? String(sceneView.document.id) : ""
    readonly property string pageKey: active ? String(sceneView.pageId) : ""
    property var layerDoc: Layer.emptyDoc()
    property string layerDocId: ""
    // This document's stored layer couldn't be read, so nothing is written over it.
    property bool layerUnreadable: false
    readonly property var pageInserts: Layer.pageInserts(layerDoc, pageKey)
    property string selectedId: ""
    readonly property var selectedInsert: insertById(selectedId)
    // While the selected insert is dragged: where the drag began, and the insert's box so far.
    property var dragFrom: null
    property var live: null
    property string layerNote: ""

    onDocIdChanged: loadLayer()
    onPageKeyChanged: deselect()

    // Changes whenever the page is zoomed or scrolled, so bindings that map the page rerun.
    readonly property var viewKey: {
        const tm = sceneView ? sceneView.tileManager : null;
        return tm ? [tm.scale, tm.center.x, tm.center.y] : [];
    }
    // View pixels per scene unit.
    readonly property real viewScale: {
        void viewKey;
        return active ? sceneView.sceneToView(Qt.rect(0, 0, 1000, 1000)).width / 1000 : 1;
    }

    function arabicDigits(n) {
        return String(n).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
    }

    function setFlag(name, m, value) {
        const next = Object.assign({}, bar[name]);
        next[m] = value;
        bar[name] = next;
    }

    function readJson(m, file, done) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", dataDir + file);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return;
            setFlag("loading", m, false);
            if (!xhr.responseText) {
                setFlag("loadErrors", m, "missing");
                return;
            }
            try {
                done(JSON.parse(xhr.responseText));
            } catch (e) {
                setFlag("loadErrors", m, file + ": " + e);
            }
        };
        xhr.send();
    }

    function loadData() {
        const m = mode;
        if (ready || loading[m])
            return;
        setFlag("loadErrors", m, "");
        setFlag("loading", m, true);
        if (m === "ayah") {
            readJson(m, "index.json", (j) => { searcher = Search.createSearcher(j); runSearch(); });
            readJson(m, "quran-hafs-v22.json", (j) => { quran = j.surahs; runSearch(); });
            readJson(m, "surahs.json", (j) => { surahs = j; runSearch(); });
        } else {
            readJson(m, "hadith-index.json", (j) => { hadithSearcher = makeHadithSearcher(j); runSearch(); });
            readJson(m, "hadith.json", (j) => { hadith = j; runSearch(); });
        }
    }

    function makeHadithSearcher(index) {
        return HadithSearch.createHadithSearcher(index);
    }

    function ayahText(s, a) {
        return quran[s - 1][a - 1];
    }

    // Hadith item: [bookIndex, number, kitab, bab, matn].
    function hadithBook(item) {
        return hadith.books[item[0]];
    }

    function hadithSource(item) {
        return hadithBook(item).id === "bukhari" ? "البخاري" : "مسلم";
    }

    // Arabic-Indic number for citing, without sunnah.com sub-letters ("8a" -> "٨");
    // empty when the dataset couldn't pin the number.
    function hadithNumber(item) {
        return item[1] ? arabicDigits(String(item[1]).replace(/[a-z]+$/i, "")) : "";
    }

    function hadithCitation(item) {
        const n = hadithNumber(item);
        return "(رواه " + hadithSource(item) + (n ? " " + n : "") + ")";
    }

    function runSearch() {
        if (!ready)
            return;
        const q = query.text.trim();
        selected = -1;
        span = 1;
        if (!q) {
            results = [];
            return;
        }
        const t0 = Date.now();
        if (mode === "ayah") {
            const found = searcher.search(q, 4);
            lastSearchMs = Date.now() - t0;
            results = found.map((r) => ({
                surah: r.surah,
                ayah: r.ayah,
                to: r.to || r.ayah,
                ref: "سورة " + surahs[r.surah - 1].ar + " · " + arabicDigits(r.ayah)
                     + ((r.to && r.to > r.ayah) ? "–" + arabicDigits(r.to) : ""),
                text: ayahText(r.surah, r.ayah)
            }));
        } else {
            const found = hadithSearcher.search(q, 4);
            lastSearchMs = Date.now() - t0;
            results = found.map((r) => {
                const it = hadith.items[r.id];
                return {
                    item: it,
                    ref: hadithBook(it).ar + (hadithNumber(it) ? " · " + hadithNumber(it) : "") + " · " + it[2],
                    text: it[4]
                };
            });
        }
        if (results.length > 0)
            choose(0);
    }

    function choose(i) {
        selected = i;
        const r = results[i];
        span = mode === "ayah" ? r.to - r.ayah + 1 : 1;
    }

    function maxSpan() {
        if (selected < 0 || mode !== "ayah")
            return 1;
        const r = results[selected];
        return surahs[r.surah - 1].n - r.ayah + 1;
    }

    function compose(s, a, b) {
        const parts = [];
        for (let i = a; i <= b; i++)
            parts.push(ayahText(s, i) + " " + arabicDigits(i));
        return parts.join(" ");
    }

    function openPanel(newMode) {
        deselect();
        if (mode !== newMode) {
            mode = newMode;
            results = [];
            selected = -1;
            query.text = "";
        }
        panel.visible = true;
        loadData();
        query.forceActiveFocus();
        Qt.inputMethod.show();
    }

    function closePanel() {
        query.focus = false;
        Qt.inputMethod.hide();
        panel.visible = false;
    }

    // The chosen ayat or hadith become a layer insert on the open page, selected so it can be
    // moved straight away. Nothing goes into the page's typed text.
    function insertSelected() {
        if (selected < 0)
            return;
        const r = results[selected];
        const isAyah = mode === "ayah";
        const s = r.surah, a = r.ayah, b = isAyah ? r.ayah + span - 1 : 0;
        const kind = isAyah ? "ayah" : "hadith";
        const text = isAyah ? compose(s, a, b) : r.item[4] + " " + hadithCitation(r.item);
        const ref = isAyah ? s + ":" + a + "-" + b : hadithCitation(r.item);
        closePanel();

        const size = Layer.DEFAULT_SIZE[kind];
        const page = pageRect();
        // The part of the screen clear of the page's edges and the bar's buttons.
        const view = sceneView.viewToScene(Qt.rect(0, 140, bar.width, bar.height - 280));
        // Clear of what is on the page already: xochitl's typed text and handwriting, and inserts.
        const boxes = [];
        const c = sceneView.controller;
        for (const r of [c.rootDocumentBoundingRect, c.itemsBoundingRect])
            if (r.width > 0 && r.height > 0)
                boxes.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        for (let i = 0; i < layerRepeater.count; i++) {
            const d = layerRepeater.itemAt(i);
            if (d)
                boxes.push({ x: d.box.x, y: d.box.y, w: d.box.w, h: d.textHeight });
        }
        const at = Layer.placeNew(page, view, boxes, Math.round(page.width * 0.8), size * 3);
        const item = { id: Layer.newId(Date.now(), Math.random()), kind: kind, text: text, ref: ref,
                       x: at.x, y: at.y, w: at.w, size: size };
        if (savePage(Layer.storedPage(layerDoc, pageKey).concat([item]))) {
            selectedId = item.id;
            lastInsert = { key: ref, id: item.id, page: pageKey };
        }
    }

    // The page in scene units. On note pages pageBorderRect comes back with its sides swapped
    // (2160 by 1620 on the Paper Pro), so a note page is the screen's width at 100%, centred on
    // x = 0, and as tall as it has been scrolled.
    function pageRect() {
        if (pdfPage)
            return sceneView.viewToScene(sceneView.pageBorderRect);
        const seen = sceneView.viewToScene(Qt.rect(0, 0, bar.width, bar.height));
        return Qt.rect(-bar.width / 2, 0, bar.width, Math.max(bar.height, seen.y + seen.height));
    }

    function note(text) {
        layerNote = text;
        noteTimer.restart();
    }

    function loadLayer() {
        deselect();
        const r = Layer.parseDoc(docId ? layerStore.value(docId, "") : "");
        layerDocId = docId;
        layerDoc = r.doc;
        layerUnreadable = !r.ok;
        if (!r.ok)
            note("تعذّرت قراءة طبقة midad لهذا المستند، فلن يُكتب فوقها");
    }

    // Replaces the open page's list and writes the document's layer, then looks for the write in
    // the file itself.
    function savePage(list) {
        if (!docId || docId !== layerDocId || layerUnreadable) {
            note("لم يُحفظ: تعذّرت قراءة طبقة midad لهذا المستند");
            return false;
        }
        const doc = Layer.withPage(layerDoc, pageKey, list);
        layerStore.setValue(docId, Layer.serialize(doc));
        layerStore.sync();
        layerDoc = doc;
        checkSaved(docId, doc.rev);
        return true;
    }

    function checkSaved(id, rev) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", layerFile);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE && Layer.savedRev(xhr.responseText, id) < rev)
                bar.note("تعذّر حفظ طبقة midad");
        };
        xhr.send();
    }

    function insertById(id) {
        const l = pageInserts;
        for (let i = 0; i < l.length; i++)
            if (l[i].id === id)
                return l[i];
        return null;
    }

    function select(id) {
        if (selectedId !== id) {
            cancelDrag();
            selectedId = id;
        }
    }

    function deselect() {
        cancelDrag();
        selectedId = "";
    }

    function cancelDrag() {
        dragFrom = null;
        live = null;
    }

    // A finger tap on an insert selects it; anywhere else it drops the selection.
    function tapAt(p) {
        for (let i = layerRepeater.count - 1; i >= 0; i--) {
            const d = layerRepeater.itemAt(i);
            if (d && p.x >= d.x && p.x <= d.x + d.width && p.y >= d.y && p.y <= d.y + d.height) {
                select(d.modelData.id);
                return;
            }
        }
        deselect();
    }

    // which: "move" drags the whole insert, "width" its left edge. p is in the bar's coordinates.
    function beginDrag(which, p, d) {
        const it = insertById(selectedId);
        if (!it)
            return;
        dragFrom = { which: which, px: p.x, py: p.y, x: it.x, y: it.y, w: it.w, h: d.textHeight, page: pageRect() };
        live = { x: it.x, y: it.y, w: it.w };
    }

    function dragTo(p) {
        const f = dragFrom;
        if (!f)
            return;
        const dx = (p.x - f.px) / viewScale, dy = (p.y - f.py) / viewScale;
        if (f.which === "move") {
            const m = Layer.moved(f, dx, dy, f.h, f.page);
            live = { x: m.x, y: m.y, w: f.w };
        } else {
            const m = Layer.widened(f, dx, f.page);
            live = { x: m.x, y: f.y, w: m.w };
        }
    }

    // Saving rebuilds every insert's item, the one being touched included, so changes are saved
    // after the touch has been handled.
    function endDrag() {
        const f = dragFrom, l = live;
        if (!f || !l)
            return;
        Qt.callLater(() => {
            if (dragFrom !== f)
                return;
            if (l.x !== f.x || l.y !== f.y || l.w !== f.w)
                savePage(Layer.patchInsert(Layer.storedPage(layerDoc, pageKey), selectedId,
                                           { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w) }));
            cancelDrag();
        });
    }

    function resize(dir) {
        const it = insertById(selectedId);
        if (!it)
            return;
        const size = Layer.stepSize(it.size, dir);
        if (size !== it.size)
            Qt.callLater(() => savePage(Layer.patchInsert(Layer.storedPage(layerDoc, pageKey), it.id, { size: size })));
    }

    function removeSelected() {
        const id = selectedId;
        if (!id)
            return;
        Qt.callLater(() => {
            deselect();
            savePage(Layer.removeInsert(Layer.storedPage(layerDoc, pageKey), id));
        });
    }

    // On-device search timing over a fixed query mix (dev: ayahBench).
    readonly property var benchQueries: [
        "ذلك الكتاب لا ريب", "قل هو الله احد", "الله لا اله الا هو الحي القيوم",
        "ان مع العسر يسرا", "والعصر ان الانسان لفي خسر", "يا ايها الذين امنوا",
        "ولقد يسرنا القران للذكر", "فباي الاء ربكما تكذبان", "2:255", "البقرة 255",
        "الحمد لله رب العلمين", "اقرا باسم ربك الذي خلق", "انا اعطيناك الكوثر",
        "وما خلقت الجن والانس الا ليعبدون", "سبح اسم ربك الاعلى", "الرحمن علم القران",
        "تبارك الذي بيده الملك", "والضحى والليل اذا سجى", "قل اعوذ برب الناس",
        "لا يكلف الله نفسا الا وسعها"
    ]

    function bench() {
        if (!ready) {
            loadData();
            return "loading";
        }
        const t = [];
        const top = [];
        for (const q of benchQueries) {
            const t0 = Date.now();
            const r = searcher.search(q, 4);
            t.push(Date.now() - t0);
            top.push(r.length ? r[0].key : "-");
        }
        const sorted = t.slice().sort((x, y) => x - y);
        return JSON.stringify({
            n: t.length,
            p50: sorted[Math.floor(t.length * 0.5)],
            p95: sorted[Math.floor(t.length * 0.95)],
            max: sorted[t.length - 1],
            ms: t,
            top: top
        });
    }

    Timer {
        id: searchTimer
        interval: 250
        onTriggered: bar.runSearch()
    }


    Timer {
        id: noteTimer
        interval: 4000
        onTriggered: bar.layerNote = ""
    }

    // Finger taps for selecting. The handler only watches (a passive grab), so xochitl still
    // gets every touch for scrolling and zooming; the pen never reaches it.
    TapHandler {
        acceptedDevices: PointerDevice.TouchScreen
        enabled: bar.active && !panel.visible
        onTapped: (eventPoint) => bar.tapAt(eventPoint.position)
    }

    // An insert drawn at its place on the page: box is {x, y, w} in scene units.
    component InsertView: Item {
        id: view
        property var box: ({ x: 0, y: 0, w: 1 })
        property string text: ""
        property string kind: "ayah"
        property real size: 44
        // In scene units.
        readonly property real textHeight: body.height / bar.viewScale
        readonly property point at: {
            void bar.viewKey;
            const r = bar.sceneView.sceneToView(Qt.rect(box.x, box.y, box.w, 1));
            return Qt.point(r.x, r.y);
        }
        x: at.x
        y: at.y
        width: body.width
        height: body.height

        // Laid out at the size it shows at, rather than scaled, so glyphs are drawn sharp at every
        // zoom.
        Text {
            id: body
            width: view.box.w * bar.viewScale
            text: view.text
            font.family: view.kind === "ayah" ? bar.quranFont : bar.hadithFont
            font.pixelSize: Math.max(1, Math.round(view.size * bar.viewScale))
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignRight
            color: "black"
        }
    }

    // xochitl's page container, the parent of its page views.
    readonly property var pagesRoot: {
        const k = sceneView ? sceneView.children : [];
        for (let i = 0; i < k.length; i++)
            if (k[i].objectName === "SceneViewsRoot")
                return k[i];
        return null;
    }

    // The layer: the open page's inserts. xochitl takes anything painted above its pen surface
    // out of the pen's area, so the inserts are drawn inside the page container, under that
    // surface, where the pen writes over them as over the page.
    Item {
        parent: bar.pagesRoot || bar
        width: bar.width
        height: bar.height
        z: 100
        visible: bar.active

        Repeater {
            id: layerRepeater
            model: bar.active ? bar.pageInserts : []

            InsertView {
                required property var modelData
                box: modelData
                text: modelData.text
                kind: modelData.kind
                size: modelData.size
                visible: modelData.id !== bar.selectedId
            }
        }
    }

    // Pen presses go to the page unless a blocker covers the spot. A blocker keeps blocking while
    // hidden, so each one exists only while the control it covers is shown.
    Component {
        id: penBlocker
        PenInputBlocker {
            manager: bar.sceneView.penInput.surfaceManager
        }
    }

    // The selected insert, drawn above the pen surface with its controls: there the pen stops
    // writing and drags it instead, like a finger.
    Loader {
        anchors.fill: parent
        active: bar.active && !!bar.selectedInsert

        sourceComponent: Item {
            readonly property var it: bar.selectedInsert || ({ x: 0, y: 0, w: 1, text: "", kind: "ayah", size: 44 })

            InsertView {
                id: ins
                box: bar.live || parent.it
                text: parent.it.text
                kind: parent.it.kind
                size: parent.it.size

                Rectangle {
                    x: -12
                    y: -10
                    width: parent.width + 24
                    height: parent.height + 20
                    color: "transparent"
                    border.color: "black"
                    border.width: 3
                    radius: 8
                }

                // The insert is its own move handle.
                MouseArea {
                    anchors.fill: parent
                    anchors.margins: -12
                    preventStealing: true
                    onPressed: (mouse) => bar.beginDrag("move", mapToItem(bar, mouse.x, mouse.y), ins)
                    onPositionChanged: (mouse) => bar.dragTo(mapToItem(bar, mouse.x, mouse.y))
                    onReleased: bar.endDrag()
                    onCanceled: bar.cancelDrag()

                    Loader {
                        anchors.fill: parent
                        active: parent.visible
                        sourceComponent: penBlocker
                    }
                }

                // Width handle on the left edge, where the lines end: drag it to narrow or widen.
                Rectangle {
                    visible: !bar.dragFrom || bar.dragFrom.which === "width"
                    width: 52
                    height: 120
                    radius: 26
                    color: "white"
                    border.color: "black"
                    border.width: 3
                    // Clear of xochitl's toolbar on the left, which would take the touch.
                    x: Math.max(120 - ins.x, -width - 22)
                    y: ins.height / 2 - height / 2

                    Row {
                        anchors.centerIn: parent
                        spacing: 10
                        Repeater {
                            model: 2
                            Rectangle { width: 5; height: 44; radius: 2; color: "black" }
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        anchors.margins: -20
                        preventStealing: true
                        onPressed: (mouse) => bar.beginDrag("width", mapToItem(bar, mouse.x, mouse.y), ins)
                        onPositionChanged: (mouse) => bar.dragTo(mapToItem(bar, mouse.x, mouse.y))
                        onReleased: bar.endDrag()
                        onCanceled: bar.cancelDrag()

                        Loader {
                            anchors.fill: parent
                            active: parent.visible
                            sourceComponent: penBlocker
                        }
                    }
                }

                // Toolbar above the insert, right edges together; below it when there's no room
                // above.
                Rectangle {
                    visible: !bar.dragFrom
                    width: tools.width + 20
                    height: 100
                    radius: 12
                    color: "white"
                    border.color: "black"
                    border.width: 3
                    x: Math.max(120 - ins.x, Math.min(bar.width - 8 - width - ins.x, ins.width - width + 12))
                    y: ins.y - height - 28 >= 16 ? -height - 28 : ins.height + 28

                    // Touches between the buttons stop here.
                    MouseArea {
                        anchors.fill: parent

                        Loader {
                            anchors.fill: parent
                            active: parent.visible
                            sourceComponent: penBlocker
                        }
                    }

                    Row {
                        id: tools
                        anchors.centerIn: parent
                        spacing: 10
                        layoutDirection: Qt.RightToLeft

                        Repeater {
                            model: [
                                { label: "حذف", act: "remove" },
                                { label: "−", act: "smaller" },
                                { label: "+", act: "bigger" },
                                { label: "تم", act: "done" }
                            ]

                            Rectangle {
                                required property var modelData
                                readonly property bool primary: modelData.act === "done"
                                width: 110
                                height: 80
                                radius: 10
                                color: primary ? "black" : "white"
                                border.color: "black"
                                border.width: 2

                                Text {
                                    anchors.centerIn: parent
                                    text: parent.modelData.label
                                    color: parent.primary ? "white" : "black"
                                    font.family: bar.uiFont
                                    font.pixelSize: parent.modelData.label.length === 1 ? 50 : 36
                                    font.bold: parent.primary
                                }

                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: {
                                        const a = parent.modelData.act;
                                        if (a === "remove")
                                            bar.removeSelected();
                                        else if (a === "smaller")
                                            bar.resize(-1);
                                        else if (a === "bigger")
                                            bar.resize(1);
                                        else
                                            bar.deselect();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Short notices from the layer, e.g. when a save didn't reach the file.
    Rectangle {
        visible: bar.layerNote !== ""
        anchors.horizontalCenter: parent.horizontalCenter
        y: 40
        width: noteText.width + 48
        height: noteText.height + 28
        radius: 12
        color: "black"

        Text {
            id: noteText
            anchors.centerIn: parent
            width: Math.min(implicitWidth, bar.width - 200)
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignHCenter
            text: bar.layerNote
            color: "white"
            font.family: bar.uiFont
            font.pixelSize: 32
        }
    }

    // Floating button.
    Rectangle {
        id: fab
        width: 112
        height: 112
        radius: 56
        color: "white"
        border.color: "black"
        border.width: 3
        x: bar.width - width - 36
        y: Math.round(bar.height * 0.42)
        visible: !panel.visible

        Text {
            anchors.centerIn: parent
            text: "آية"
            font.family: bar.quranFont
            font.pixelSize: 46
            color: "black"
        }

        MouseArea {
            anchors.fill: parent
            preventStealing: true
            drag.target: fab
            drag.minimumX: 0
            drag.minimumY: 0
            drag.maximumX: bar.width - fab.width
            drag.maximumY: bar.height - fab.height
            onClicked: bar.openPanel("ayah")
        }
    }

    // Hadith button, below the ayah one; drags on its own.
    Rectangle {
        id: hadithFab
        width: 112
        height: 112
        radius: 56
        color: "white"
        border.color: "black"
        border.width: 3
        x: bar.width - width - 36
        y: Math.round(bar.height * 0.42) + 136
        visible: !panel.visible

        Text {
            anchors.centerIn: parent
            text: "حديث"
            font.family: bar.uiFont
            font.pixelSize: 34
            color: "black"
        }

        MouseArea {
            anchors.fill: parent
            preventStealing: true
            drag.target: hadithFab
            drag.minimumX: 0
            drag.minimumY: 0
            drag.maximumX: bar.width - hadithFab.width
            drag.maximumY: bar.height - hadithFab.height
            onClicked: bar.openPanel("hadith")
        }
    }

    // Search panel; sits above the keyboard.
    Rectangle {
        id: panel
        visible: false
        width: Math.min(bar.width - 120, 1360)
        height: 1380
        x: Math.round((bar.width - width) / 2)
        y: 140
        color: "white"
        border.color: "black"
        border.width: 3
        radius: 12

        // Swallow touches so nothing reaches the page underneath.
        MouseArea {
            anchors.fill: parent
        }

        Item {
            id: header
            x: 24
            y: 16
            width: panel.width - 48
            height: 72

            Text {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: bar.mode === "ayah" ? "إدراج آية" : "إدراج حديث"
                font.family: bar.uiFont
                font.pixelSize: 40
                font.bold: true
            }

            Text {
                id: closeButton
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: "إغلاق"
                font.family: bar.uiFont
                font.pixelSize: 34

                MouseArea {
                    anchors.fill: parent
                    anchors.margins: -24
                    onClicked: bar.closePanel()
                }
            }
        }

        Rectangle {
            id: searchBox
            x: 24
            y: header.y + header.height + 12
            width: panel.width - 48
            height: 100
            radius: 8
            border.color: "black"
            border.width: 2

            TextInput {
                id: query
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                verticalAlignment: TextInput.AlignVCenter
                horizontalAlignment: TextInput.AlignRight
                font.family: bar.uiFont
                font.pixelSize: 44
                inputMethodHints: Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
                clip: true
                onTextChanged: searchTimer.restart()
            }

            Text {
                anchors.fill: query
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignRight
                visible: query.text.length === 0
                text: bar.mode === "ayah" ? "اكتب جزءًا من الآية، أو ٢:٢٥٥"
                                          : "اكتب جزءًا من الحديث، أو البخاري ١"
                font.family: bar.uiFont
                font.pixelSize: 38
                color: "#777777"
            }
        }

        Text {
            id: status
            x: 24
            y: searchBox.y + searchBox.height + 10
            width: panel.width - 48
            height: 44
            horizontalAlignment: Text.AlignRight
            font.family: bar.uiFont
            font.pixelSize: 28
            color: "#555555"
            text: bar.loadError === "missing" ? (bar.mode === "hadith" ? "بيانات الأحاديث لم تُثبَّت على الجهاز بعد"
                                                                     : "بيانات القرآن غير موجودة على الجهاز")
                : bar.loadError ? ("تعذّر التحميل: " + bar.loadError)
                : !bar.ready ? "جارٍ التحميل…"
                : (query.text.trim() && bar.results.length === 0) ? "لا نتائج"
                : ""
        }

        Column {
            id: resultList
            x: 24
            y: status.y + status.height + 6
            width: panel.width - 48
            spacing: 10

            Repeater {
                model: bar.results

                Rectangle {
                    required property var modelData
                    required property int index
                    width: resultList.width
                    // Sized to its two lines of ayah text: a fixed height clipped a third line
                    // and left its tashkeel floating under the second.
                    height: rowText.y + rowText.height + 12
                    radius: 8
                    color: index === bar.selected ? "#e4e4e4" : "white"
                    border.color: "black"
                    border.width: index === bar.selected ? 3 : 1

                    Text {
                        id: rowRef
                        x: 16
                        y: 8
                        width: parent.width - 32
                        horizontalAlignment: Text.AlignRight
                        text: modelData.ref
                        font.family: bar.uiFont
                        font.pixelSize: 28
                        color: "#333333"
                    }

                    Text {
                        id: rowText
                        x: 16
                        y: rowRef.y + rowRef.height + 2
                        width: parent.width - 32
                        horizontalAlignment: Text.AlignRight
                        text: modelData.text
                        font.family: bar.mode === "ayah" ? bar.quranFont : bar.hadithFont
                        font.pixelSize: 40
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }

                    MouseArea {
                        anchors.fill: parent
                        onClicked: bar.choose(index)
                    }
                }
            }
        }

        // Footer: range and insert, once a result is chosen.
        Item {
            id: footer
            x: 24
            width: panel.width - 48
            height: 110
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 20
            visible: bar.selected >= 0

            Rectangle {
                id: insertButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                width: 300
                height: 96
                radius: 10
                color: "black"

                Text {
                    anchors.centerIn: parent
                    text: "إدراج"
                    color: "white"
                    font.family: bar.uiFont
                    font.pixelSize: 42
                    font.bold: true
                }

                MouseArea {
                    anchors.fill: parent
                    onClicked: bar.insertSelected()
                }
            }

            Row {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                spacing: 20
                layoutDirection: Qt.RightToLeft
                visible: bar.mode === "ayah"

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "عدد الآيات"
                    font.family: bar.uiFont
                    font.pixelSize: 32
                }

                Rectangle {
                    width: 88
                    height: 88
                    radius: 44
                    border.width: 2
                    Text { anchors.centerIn: parent; text: "+"; font.pixelSize: 52 }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: if (bar.span < bar.maxSpan()) bar.span += 1
                    }
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    width: 80
                    horizontalAlignment: Text.AlignHCenter
                    text: bar.arabicDigits(bar.span)
                    font.family: bar.uiFont
                    font.pixelSize: 44
                }

                Rectangle {
                    width: 88
                    height: 88
                    radius: 44
                    border.width: 2
                    Text { anchors.centerIn: parent; text: "−"; font.pixelSize: 52 }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: if (bar.span > 1) bar.span -= 1
                    }
                }
            }
        }
    }
}
