// Build the on-device Quran text: dist/device/quran-hafs-v22.json = { surahs: string[][] }, one
// string per ayah in KFGQPC's own encoding, from the text that ships with the KFGQPC Uthmanic
// HAFS v22 font (nuqayah/qpc-fonts, text-mushafs/UthmanicHafs_V22). Surah boundaries come from
// quran-png's index so numbering matches the renderer and the search index.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const V22 = new URL('../../vendor/qpc-hafs-v22/UthmanicHafs v22.json', import.meta.url)
const BUNDLE = new URL('../../vendor/quran-png/.data/quran-svg-hafs-kfgqpc/index/', import.meta.url)
const OUT = new URL('../../dist/device/', import.meta.url)

const rows = JSON.parse(readFileSync(V22, 'utf8')) as [string, number][]
const counts = (JSON.parse(readFileSync(new URL('surahs.json', BUNDLE), 'utf8')).surahs as any[]).map(
  (s) => s.ayah_count as number,
)
if (rows.length !== 6236) throw new Error(`expected 6236 ayat in v22 text, got ${rows.length}`)
rows.forEach(([, n], i) => {
  if (n !== i + 1) throw new Error(`v22 row ${i} has index ${n}`)
})

const surahs: string[][] = []
let i = 0
for (const n of counts) {
  surahs.push(rows.slice(i, i + n).map(([t]) => t))
  i += n
}
if (i !== rows.length) throw new Error(`surah counts cover ${i} ayat, text has ${rows.length}`)

mkdirSync(OUT, { recursive: true })
writeFileSync(new URL('quran-hafs-v22.json', OUT), JSON.stringify({ surahs }))
console.log(`wrote ${rows.length} ayat in ${surahs.length} surahs to dist/device/quran-hafs-v22.json`)
