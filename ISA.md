---
task: "Ayah toolbar with Arabic keyboard and fuzzy search on reMarkable"
slug: 20261018-031836_rm-ayah-toolbar
project: rm-ayah-toolbar
phase: climbing
progress: 14/23
started: 2026-10-18T03:18:36+03:00
updated: 2026-10-18T03:22:00+03:00
principal_stated_goal: "I've created a test note for you, proceed by creating our ayah toolbar, we can use a local version of https://github.com/quran-ws/quran-png to insert ayah(s), with accurate fuzzy search."
principal_stated_goal_source: prompt
principal_stated_goal_signal: 4
principal_stated_goal_locked: 2026-10-18T03:18:36+03:00
context_sufficient: false
interview_invoked: false
---

# Ayah toolbar for the reMarkable Paper Pro

## Problem

Writing Islamic notes on the Paper Pro means copying ayat by hand or pre-building PDFs on a computer. The stock UI has no Arabic keyboard, no Arabic font in its UI (Arabic document titles render as □ boxes), and no way to place typeset Quran text into a note.

## Vision

I'm writing in a note, tap a small floating ayah button, type a few words the way I remember them (no tashkeel, hamzas wrong, a typo or two), and the right ayah is at the top of the list. I tap it and it lands in my note in the KFGQPC mushaf script, crisp, where I wanted it, and it is still there next time I open the note. Nothing else on the page moves or changes.

## Out of Scope

- Hadith insertion (the qirtaas-style second half) — a later run reuses the toolbar.
- Translations, tafsir, or audio.
- Packaging for Vellum or public release; other devices or firmware versions.
- Changing how quran-png typesets; we take its output as is.

## Constraints

- Device is a Paper Pro (ferrari), firmware 3.26.0.1351, with xovi, AppLoad, qt-resource-rebuilder, qt-command-executor, xovi-message-broker, framebuffer-spy, rm-shot and floating.qmd already installed. We add files; we never remove or replace the principal's existing extensions or QMDs.
- Only the principal's test note is opened or written during development. Any device file we overwrite is backed up first.
- Host and device helpers in bun/TypeScript; on-device UI in QML/JS. No Python.
- No GPU compute on the host (principal's standing rule).
- The tablet works offline: no network at search, render, or insert time.
- KFGQPC text and artwork under quran-png's stated terms, personal use, not redistributed.

## Goal

"I've created a test note for you, proceed by creating our ayah toolbar, we can use a local version of https://github.com/quran-ws/quran-png to insert ayah(s), with accurate fuzzy search." Done means: on the tablet, inside the open test note, I can type an Arabic query on an on-device Arabic keyboard, get the intended ayah from a fuzzy search, and insert it (or a range) into the note in quran-png's KFGQPC rendering, with the insertion persisting and the rest of the note untouched.

## Not yet specified

- fog: toolbar host — our own QML component shipped in an `.rcc` and instantiated by a small QMD in the scene view, vs an AppLoad window — leaning QMD+rcc now that the scene view hook works.
- fog: where an insert lands and at what size — today it goes to the typed-text cursor nearest the given point, in the default text style; whether to offer heading size or mushaf line breaks is open.

## Features

### F1 · Arabic keyboard
Why: search needs Arabic input on the tablet, and the stock keyboard has none, so this is the first thing I can type with.

- [x] C1: An Arabic layout is reachable on the tablet keyboard (or our panel's keyboard), covering the 28 letters plus ء أ إ آ ؤ ئ ى ة, space and backspace.
- [x] C2: Arabic typed into the field renders joined and right-to-left in an Arabic font, not as □ boxes.
- [x] C3: Anti: the stock English keyboard and every stock text field keep working after install.

### F2 · Local renderer
Why: inserts must look like the mushaf, and must come from our own copy, not png.quran.ws.

- [x] C4: A local quran-png checkout renders a surah:ayah range (e.g. 1:1-7) to PNG and SVG with networking disabled.
- [x] C5: The local render matches png.quran.ws for the same range.
- [x] C6: Every one of the 6236 ayat renders without error in a batch export.

### F3 · Fuzzy search
Why: I type ayat from memory, in imla'i spelling and with mistakes, and still need the right one first.

- [x] C7: Full-text queries with tashkeel stripped return the source ayah at rank 1 for 6236/6236 (identical-text ayat count as a hit).
- [x] C8: 3–5-word snippets taken from anywhere in an ayah return the source ayah in the top 5 for ≥ 99% of a seeded 2000-query sample.
- [x] C9: Snippets with 1–2 random character edits return the source in the top 5 for ≥ 95% of a seeded 2000-query sample.
- [x] C10: Imla'i spellings (alef, hamza, ya, ta marbuta variants, no Uthmani marks) find Uthmani ayat: ≥ 90% rank 1 on a hand-written fixture of ≥ 30 queries.
- [x] C11: Reference queries (`2:255`, `البقرة ٢٥٥`, `2:1-5`) resolve to the exact ayah or range at rank 1.
- [ ] C12: Search runs on the tablet with p95 ≤ 200 ms per query.

### F4 · Insert into the open note
Why: the point of the whole thing is the ayah on my page, in my note, staying there.

- [x] C13: A selected ayah appears in the open test note as Uthmani typed text in a Quran font (Amiri Quran), with ayah end marks, and reads correctly. (refined 2026-10-18 from "quran-png's KFGQPC rendering", see Decisions)
- [x] C14: A selected range (e.g. 1:1-7) inserts in order.
- [ ] C15: The insert persists after closing and reopening the note.
- [ ] C16: An insert of a ≤ 2-line ayah finishes in ≤ 10 s.
- [x] C17: The insert can be undone in one step.
- [ ] C18: Anti: content already on the page is unchanged outside the inserted region.
- [ ] C23: Anti: no general-purpose eval or shell surface ships; the hook accepts only fixed commands with validated arguments.

### F5 · Toolbar
Why: one tap from any open note, without leaving it.

- [ ] C19: An ayah button is visible on an open note next to the stock tools and can be moved like floating.qmd.
- [ ] C20: Tapping it opens a panel with the Arabic input and ranked results showing the ayah text.
- [ ] C21: Anti: stock tools and the principal's floating toolbar still work with ours installed.

### F0 · Cross-cutting
Why: this is the principal's daily device with real notes on it.

- [ ] C22: Anti: no document other than the test note is opened or modified during development.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
|---|---|---|---|---|---|
| C1 | ui | open keyboard, switch to Arabic, screenshot | all listed keys visible | rmshot + rminput | Goal |
| C2 | ui | type سبحان الله, screenshot the field | joined RTL glyphs, no □ | rmshot | Goal |
| C3 | ui | type latin text in stock search after install | text appears | rmshot | Anti |
| C4 | command | render 1:1-7 under `unshare -rn` | PNG+SVG non-empty | bun | Goal |
| C5 | appearance | compare local vs hosted PNG for 1:1-7 | visually identical | Read image | Goal |
| C6 | command | batch export all ayat | 6236 files, 0 errors | bun | Goal |
| C7 | eval | full-text eval script | 6236/6236 | bun test | Goal |
| C8 | eval | snippet eval, seed 42 | ≥ 99% top-5 | bun test | Goal |
| C9 | eval | typo eval, seed 42 | ≥ 95% top-5 | bun test | Goal |
| C10 | eval | imla'i fixture | ≥ 90% top-1 | bun test | Goal |
| C11 | eval | reference fixture | 100% top-1 | bun test | Goal |
| C12 | perf | timed queries on device | p95 ≤ 200 ms | ssh + device runner | Goal |
| C13 | appearance | insert 1:1, screenshot note | KFGQPC text legible | rmshot | Goal |
| C14 | appearance | insert 2:1-5, screenshot | 5 ayat in order | rmshot | Goal |
| C15 | appearance | close/reopen note, screenshot | insert still there | rminput + rmshot | Goal |
| C16 | perf | time insert of 1:1 | ≤ 10 s | stopwatch in helper | Vision |
| C17 | ui | undo after insert, screenshot | insert gone | rminput + rmshot | Vision |
| C18 | diff | screenshot diff outside insert box | 0 changed px | bun image diff | Anti |
| C19 | ui | screenshot open note | button visible, draggable | rmshot + rminput | Goal |
| C20 | ui | tap button, screenshot | panel with input + results | rmshot | Goal |
| C21 | ui | use pen, eraser, floating toolbar after install | all work | rminput + rmshot | Anti |
| C22 | fs | mtime scan of xochitl data dir vs start | only test note changed | ssh find -newer | Anti |

## Decisions

- 2026-10-18 03:20: ambiguity flag — "insert into currently open note" read as native note content (strokes or page data that persists and syncs), not a temporary overlay. The spike decides the primitive; redirect if an overlay was meant.
- 2026-10-18 03:20: project ISA at `~/Hafs/rm-ayah-toolbar/ISA.md` because the toolbar has persistent identity; shape checked inline at scaffold (substantial sections present), full CheckCompleteness at close.
- 2026-10-18 03:21: principal mid-turn: "we probably will need to start by implementing an arabic keyboard." Keyboard becomes F1 and is built first on the device; the renderer and search legs (F2, F3) run in parallel on a Worker since they don't touch the tablet.
- 2026-10-18 03:21: a rung hook reported this session on Sonnet while the harness attribution reports Opus 5.5; proceeding with design inline as the main loop.
- 2026-10-18 03:30: keyboard fog resolved toward the stock keyboard. xochitl's VirtualKeyboard (C++, `xofm.modules.virtualkeyboard`) reads `:/misc/keyboards/<code>/keyboard_layout.json` (rows of `default`/`shifted` symbol arrays, `special` keys, `inherits`), 18 layouts, none RTL. qt-resource-rebuilder adds resources from `.rcc` files, so an `ar_SA` layout can ship without patching C++.
- 2026-10-18 03:31: incident — deploying `ayah.rcc` (layout + font) and `ayahKeyboardFont.qmd` (FontLoader in KeyboardPanel) made xochitl block right after library load (no CPU spin, load 0.17), systemd watchdog SIGABRT at 60 s, crash handler stalled, restart job timed out, tablet rebooted into stock. Rolled back (files parked in `/home/root/ayah-disabled`), `xovi/start` restored the prior state; screenshot verified My files. Cause not yet isolated.
- 2026-10-18 03:35: every further device change goes through a detached guard script that restarts xochitl, waits for the healthy marker `DeviceReporter enabled`, and on timeout moves our files out and `kill -9`s xochitl before the watchdog's crash path. Font moves from runtime FontLoader to fontconfig at startup (`FONTCONFIG_FILE` drop-in via xovi services) to avoid runtime font registration.

- 2026-10-18 03:37: guarded boots — font-only (`FONTCONFIG_FILE` drop-in) healthy in 10 s and Arabic document titles render; layout-only `ayah-kbd.rcc` healthy in 9 s and "Arabic" appears in the stock language list (xochitl enumerates `:/misc/keyboards/` and names it via the locale). The earlier hang is therefore the runtime FontLoader QMD; it is dropped.
- 2026-10-18 03:38: observed stock behaviour — after a long-press popup opens, a separate tap on a popup symbol typed the key underneath (ف) instead of أ. Not our layout's doing; revisit only if it bites real use.

- 2026-10-18 03:50: dead ends for inline images — a QML TextEdit's rich-text copy reaches Qt's system clipboard (2 chars pasted back) but xochitl's `Clipboard` ignores in-process changes; `Clipboard.setTextFromString` is plain text (an `<img>` tag pasted literally, undone). A general JS eval bridge was refused by the safety classifier as an RCE surface, so the hook is fixed-command only.
- 2026-10-18 03:58: principal: "how about using a quran glyph font and adding quran as text instead? wouldn't that make it easier". Spike confirmed it: Uthmani text from quran-png's `words.json` (`rasm_uthmani`) + `۝` + Arabic-Indic number, pasted with `Clipboard.setTextFromString` + `controller.pasteText` at the cursor, renders in Amiri Quran (fontconfig `<accept>` for the serif families typed text uses; UI keeps Noto Naskh). One undo step, saved to the page file. Insertion primitive fog resolved to typed text; `.rm` stroke writing and pen replay dropped. quran-png images stay available for a possible mushaf-exact mode later. C13 refined accordingly.
- 2026-10-18 03:58: rung — the harness now reports Opus 5.5 for this session, matching the pin.

## Learning

- conjectured: adding a keyboard layout + font through one `.rcc` and a FontLoader QMD is a safe additive change; refuted by: xochitl blocked after library load and the watchdog killed it, which rebooted the tablet; learned: additive resource changes can still wedge xochitl's startup, and the watchdog's crash path can stall into a reboot; criterion now: one change per guarded boot, auto-rollback on a missing health marker within 40 s.

## Verification

- C1: screenshots kbd1 (Arabic in language list) + kbd2 (3 Arabic rows, ⌫, space "Arabic") + kbd4 (ا long-press → أ إ آ ٱ); layout `device/keyboard/ar_SA/keyboard_layout.json`.
- C2: screenshot kbd3, field reads سبحان الله joined RTL with the الله ligature; font via `device/fonts.conf` + `device/ayah-toolbar.conf`.
- C3: screenshot kbd5, English layout back and `a` typed after the Arabic text.
- C4: `unshare -rn bun run render 1 1-7` → 1600×1479 PNG + SVG. C5: sha256 of local == png.quran.ws `?width=1600` (947b0149…). C6: 6236 SVG + 6236 PNG in `out/ayat`.
- C7–C11: `bun run test` 39 pass / 0 fail (eval suites, seed 42), commit f8fd23d.
- C13/C14: screenshot q1 — 1:1-7 as Amiri Quran typed text, ۝١–۝٧. C17: screenshots u1/r1 — one undo removes all 7 ayat, redo restores.
