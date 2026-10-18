// Ayah bar: a draggable floating button on note pages that opens a fuzzy ayah search and
// inserts the chosen ayat as typed text (KFGQPC Uthmanic HAFS v22, Subheading paragraph).
// Loaded by midad.qmd inside xochitl's DeviceSceneView; `sceneView` is that view's root.
import QtQuick
import com.remarkable
import common
import "search.js" as Search
import "hadith-search.js" as HadithSearch

Item {
    id: bar
    anchors.fill: parent

    property var sceneView: null
    readonly property bool active: !!sceneView && !!sceneView.controller && sceneView.notePage
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

    // Remembered when the panel opens: where typed text should go.
    property bool openedInTextMode: false
    property int openedCursorIndex: -1

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
        const c = sceneView.controller;
        openedInTextMode = sceneView.textMode;
        openedCursorIndex = openedInTextMode ? c.textCursorIndex : -1;
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

    function insertSelected() {
        if (selected < 0)
            return;
        const r = results[selected];
        const isAyah = mode === "ayah";
        const s = r.surah, a = r.ayah, b = isAyah ? r.ayah + span - 1 : 0;
        // Invisible category tags (U+2061 ayah, U+2062 hadith) let the ayahfont shim give each
        // paragraph its category's font at whatever size the user picks.
        const text = isAyah ? "⁡" + compose(s, a, b)
                            : "⁢" + r.item[4] + " " + hadithCitation(r.item);
        closePanel();

        const c = sceneView.controller;
        // Text mode with focus on the page's typed text, at the remembered cursor or the end.
        sceneView.moveCursorWithPen(sceneView.viewToScene(Qt.point(bar.width / 2, 40)));
        const len = c.rootDocumentLength;
        const at = (openedInTextMode && openedCursorIndex >= 0 && openedCursorIndex <= len) ? openedCursorIndex : len;
        c.selectTextRange(at, at);

        // Own paragraph, so the style change never touches the user's text.
        const pre = at > 0 ? "\n" : "";
        const post = at < len ? "\n" : "";
        Clipboard.setTextFromString(pre + text + post);
        c.pasteText(Clipboard.text, SceneController.KeepStyle);

        // Ayat get the Subheading size. A fresh paste is always a plain paragraph, and
        // textParagraphStyle lags right after a paste, so set it without reading it.
        // Hadith stay at the plain Paragraph size.
        const start = at + pre.length;
        if (isAyah) {
            c.selectTextRange(start + 1, start + 1);
            c.cycleParagraphStyle(ParagraphStyle.Type.Subheading);
        }
        c.selectTextRange(start + text.length, start + text.length);
        lastInsert = { key: isAyah ? s + ":" + a + "-" + b : hadithCitation(r.item),
                       at: at, length: len };
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
