---
task: "Ayah toolbar with Arabic keyboard and fuzzy search on reMarkable"
slug: 20261018-031836_rm-ayah-toolbar
project: rm-ayah-toolbar
phase: marking
progress: 0/22
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

- fog: insertion primitive — replaying pen strokes through xochitl's input vs writing .rm v6 strokes and reloading vs something else — resolves by a spike on the test note (speed, fidelity, undo, persistence).
- fog: toolbar host — a QMD patch (with qt-command-executor for helpers) vs an AppLoad window — resolves after reading xochitl's QML structure and floating.qmd.
- fog: keyboard host — extend xochitl's own keyboard with an Arabic layout vs our own keyboard inside the toolbar panel — resolves after finding how xochitl implements its keyboard and how it loads fonts.
- fog: where an insert lands (tap point, selection box, next free line) and at what size.

## Features

### F1 · Arabic keyboard
Why: search needs Arabic input on the tablet, and the stock keyboard has none, so this is the first thing I can type with.

- [ ] C1: An Arabic layout is reachable on the tablet keyboard (or our panel's keyboard), covering the 28 letters plus ء أ إ آ ؤ ئ ى ة, space and backspace.
- [ ] C2: Arabic typed into the field renders joined and right-to-left in an Arabic font, not as □ boxes.
- [ ] C3: Anti: the stock English keyboard and every stock text field keep working after install.

### F2 · Local renderer
Why: inserts must look like the mushaf, and must come from our own copy, not png.quran.ws.

- [ ] C4: A local quran-png checkout renders a surah:ayah range (e.g. 1:1-7) to PNG and SVG with networking disabled.
- [ ] C5: The local render matches png.quran.ws for the same range.
- [ ] C6: Every one of the 6236 ayat renders without error in a batch export.

### F3 · Fuzzy search
Why: I type ayat from memory, in imla'i spelling and with mistakes, and still need the right one first.

- [ ] C7: Full-text queries with tashkeel stripped return the source ayah at rank 1 for 6236/6236 (identical-text ayat count as a hit).
- [ ] C8: 3–5-word snippets taken from anywhere in an ayah return the source ayah in the top 5 for ≥ 99% of a seeded 2000-query sample.
- [ ] C9: Snippets with 1–2 random character edits return the source in the top 5 for ≥ 95% of a seeded 2000-query sample.
- [ ] C10: Imla'i spellings (alef, hamza, ya, ta marbuta variants, no Uthmani marks) find Uthmani ayat: ≥ 90% rank 1 on a hand-written fixture of ≥ 30 queries.
- [ ] C11: Reference queries (`2:255`, `البقرة ٢٥٥`, `2:1-5`) resolve to the exact ayah or range at rank 1.
- [ ] C12: Search runs on the tablet with p95 ≤ 200 ms per query.

### F4 · Insert into the open note
Why: the point of the whole thing is the ayah on my page, in my note, staying there.

- [ ] C13: A selected ayah appears in the open test note in quran-png's KFGQPC rendering and reads correctly.
- [ ] C14: A selected range (e.g. 2:1-5) inserts in order.
- [ ] C15: The insert persists after closing and reopening the note.
- [ ] C16: An insert of a ≤ 2-line ayah finishes in ≤ 10 s.
- [ ] C17: The insert can be undone.
- [ ] C18: Anti: content already on the page is unchanged outside the inserted region.

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
