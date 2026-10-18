// bun run export [outdir=out/ayat] [--png-width 1200] [--png-every N] [--svg-only]
// Renders every ayah individually: <outdir>/svg/SSS_AAA.svg and <outdir>/png/SSS_AAA.png.
import { mkdir, writeFile } from 'node:fs/promises'
import { loadIndex, renderRange } from './lib.ts'

const args = process.argv.slice(2)
const opt = (name: string, d: number) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args.splice(i, 2)[1]) : d
}
const pngWidth = opt('--png-width', 1200)
const pngEvery = opt('--png-every', 1) // 1 = every ayah
const svgOnly = args.includes('--svg-only')
const outdir = args.find((a) => !a.startsWith('--')) ?? 'out/ayat'
await mkdir(`${outdir}/svg`, { recursive: true })
await mkdir(`${outdir}/png`, { recursive: true })

const index = await loadIndex()
const t0 = performance.now()
let n = 0, svgs = 0, pngs = 0, bytes = 0
const errors: string[] = []
for (const s of index.surahs) {
  for (let a = 1; a <= s.ayahs; a++) {
    n++
    const name = `${String(s.number).padStart(3, '0')}_${String(a).padStart(3, '0')}`
    try {
      // basmalah=0: an ayah image is that ayah only, not the surah's opening line
      const r = await renderRange(s.number, a, a, { width: pngWidth, query: { basmalah: '0' } })
      await writeFile(`${outdir}/svg/${name}.svg`, r.svg)
      svgs++
      bytes += r.svg.length
      if (!svgOnly && (n - 1) % pngEvery === 0) {
        const png = r.png(pngWidth)
        await writeFile(`${outdir}/png/${name}.png`, png)
        pngs++
        bytes += png.length
      }
    } catch (e) {
      errors.push(`${s.number}:${a} ${(e as Error).message}`)
    }
  }
  if (s.number % 10 === 0) console.error(`surah ${s.number} done, ${((performance.now() - t0) / 1000).toFixed(0)}s`)
}
const secs = (performance.now() - t0) / 1000
console.log(JSON.stringify({ ayat: n, svgs, pngs, errors: errors.length, bytes, mb: +(bytes / 1048576).toFixed(1), seconds: +secs.toFixed(1), pngWidth, pngEvery }))
if (errors.length) console.log(errors.slice(0, 20).join('\n'))
process.exit(errors.length ? 1 : 0)
