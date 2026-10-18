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
bun run build:search    # dist/search.js + dist/index.json
bun test
```
