# rm-ayah-toolbar

Ayah toolbar for the reMarkable Paper Pro. bun/TypeScript only. See ISA.md.

## Vendor: quran-png

`vendor/quran-png` (gitignored) is a clone of https://github.com/quran-ws/quran-png
at commit **6867ae704debc5b3825e922e9e506254d290f191**. We do not modify it.
Code MIT, data CC BY 4.0, text and artwork under KFGQPC terms (personal use here,
not redistributed).

Setup from a fresh checkout:

```sh
git clone --depth 1 https://github.com/quran-ws/quran-png vendor/quran-png
git -C vendor/quran-png checkout 6867ae704debc5b3825e922e9e506254d290f191
mkdir -p vendor/quran-png/.data
curl -L -o vendor/quran-png/.data/quran-svg-hafs-kfgqpc.tar.gz \
  https://github.com/quran-ws/quran-png/releases/download/artwork-v1.0.0/quran-svg-hafs-kfgqpc.tar.gz
echo "2bff7bcc1d84b61ee9baf2c356ea554b0a1dd317d6a8145406b5cee998914d17  vendor/quran-png/.data/quran-svg-hafs-kfgqpc.tar.gz" | sha256sum -c
tar xzf vendor/quran-png/.data/quran-svg-hafs-kfgqpc.tar.gz -C vendor/quran-png/.data
(cd vendor/quran-png && bun scripts/build-store.mjs)   # ~25 s, writes .data/store + data/index.json
bun install
```

(quran-png's own `package.json` workspaces break `bun install` inside the clone;
dependencies are installed at the project root instead and resolved by walking up.)

## Render

```sh
bun run render 1 1-7 out/fatiha        # PNG (1600 px wide) + SVG, local only
bun run export out/ayat                # all 6236 ayat, SVG + PNG 1200 px wide
```

How quran-png renders: no fonts and no line breaking at request time. The
bundle holds the 604 printed KFGQPC mushaf pages as vector outlines, one
`<g class="word">` per word. `build-store.mjs` cuts them into per-page JSON;
`compose.mjs` picks the printed lines an ayah range touches and places each
word snippet with a translate (mushaf layout keeps printed positions); resvg
rasterises to a transparent PNG. Note single-ayah images use `basmalah=0`.

## Search

```sh
bun run build:search    # dist/search/search.js + dist/search/index.json
bun test
```

Outputs in `dist/search/`: `search.js` (the core, one classic script, ES2017, no host
APIs; loads in QML via `.pragma library`), `index.json` (prebuilt index, ~2.1 MiB),
`text.json` (Uthmani display text per ayah, 1.3 MiB, not part of the index budget).
Usage: `var s = createSearcher(JSON.parse(indexText)); s.search(query, 10)` ->
`[{id, key:"2:255", surah, ayah, to, score, dist, kind:"text"|"ref"}]`.

Corpus: quran-png bundle `index/words.json` (KFGQPC Hafs, 6236 ayat, 77,432 words),
keyed surah:ayah exactly as quran-png numbers them (its `search` field = imla'i
skeleton, `rasm_uthmani` = display/Uthmani skeleton). Both forms are indexed.
Known limit: a query spanning two ayat (e.g. 55:1-2 typed as one phrase) is not matched as a range.

`bun run src/search/bench.ts` prints host latency per query class.

## Engine comparison (quran-search-engine)

`vendor/quran-search-engine` (gitignored) = https://github.com/adelpro/quran-search-engine at
`4de9fd08a00bb18e7c9addc00fd0ad0e031d2fba`, v0.3.2. Both engines run behind `src/search/compare/adapters.ts`
(query in, ranked `surah:ayah` out; its `sura_id`/`aya_id` map 1:1 onto ours, all 6236 ayat).
`bun src/search/compare/run.ts <ours|qse|qse-exact> <acc|lat>`, then `bun src/search/compare/table.ts`.
Same seeded queries as the eval tests (`test/search/queries.ts`); extra root/lemma/phonetic fixture in
`test/search/extras-fixture.ts`, written before either engine ran on it.
