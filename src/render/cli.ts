// bun run render <surah> <ayahRange> <outdir> [--width N]
// e.g. bun run render 1 1-7 out/fatiha   -> out/fatiha/1-1-7.png + .svg
import { mkdir, writeFile } from 'node:fs/promises'
import { loadIndex, parseRange, renderRange, DEFAULT_PNG_WIDTH } from './lib.ts'

const args = process.argv.slice(2)
const wi = args.indexOf('--width')
let width = DEFAULT_PNG_WIDTH
if (wi >= 0) width = Number(args.splice(wi, 2)[1])
const [surahArg, rangeArg, outdir] = args
if (!surahArg || !rangeArg || !outdir) {
  console.error('usage: bun run render <surah> <ayahRange e.g. 1-7|255|1-> <outdir> [--width N]')
  process.exit(2)
}
const surah = Number(surahArg)
const index = await loadIndex()
const meta = index.surahs[surah - 1]
if (!meta) throw new Error(`surah must be 1..114, got ${surahArg}`)
const { from, to } = parseRange(rangeArg, meta.ayahs)
const r = await renderRange(surah, from, to, { width })
await mkdir(outdir, { recursive: true })
const base = `${surah}-${from}${to === from ? '' : `-${to}`}`
const png = r.png(width)
await writeFile(`${outdir}/${base}.svg`, r.svg)
await writeFile(`${outdir}/${base}.png`, png)
console.log(`${outdir}/${base}.svg (${r.svg.length} B)  ${outdir}/${base}.png (${png.length} B, ${width}px wide, svg ${r.width}x${r.height})`)
