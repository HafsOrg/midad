// Assemble the tablet tree in dist/device/midad/ (copied to /home/root/midad/):
//   qml/AyahBar.qml, qml/search.js, qml/move.js  the bar, the search core and the move planner
//   data/index.json                           search index
//   data/quran-hafs-v22.json                  ayah text in the KFGQPC v22 encoding
//   data/surahs.json                          [{ ar, n }] per surah
//   fonts/, fonts.conf, guard.sh              fonts and support files
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const at = (p: string) => new URL(p, root)
const OUT = at('dist/device/midad/')
const BUNDLE = at('vendor/quran-png/.data/quran-svg-hafs-kfgqpc/index/')

for (const d of ['qml', 'data', 'fonts']) mkdirSync(new URL(d, OUT), { recursive: true })

// Text: KFGQPC v22 rows split into surahs by quran-png's ayah counts (same numbering as search).
const rows = JSON.parse(readFileSync(at('vendor/qpc-hafs-v22/UthmanicHafs v22.json'), 'utf8')) as [string, number][]
const meta = JSON.parse(readFileSync(new URL('surahs.json', BUNDLE), 'utf8')).surahs as any[]
if (rows.length !== 6236) throw new Error(`expected 6236 ayat in v22 text, got ${rows.length}`)
rows.forEach(([, n], i) => {
  if (n !== i + 1) throw new Error(`v22 row ${i} has index ${n}`)
})
const surahs: string[][] = []
let i = 0
for (const s of meta) {
  surahs.push(rows.slice(i, i + s.ayah_count).map(([t]) => t))
  i += s.ayah_count
}
if (i !== rows.length) throw new Error(`surah counts cover ${i} ayat, text has ${rows.length}`)
writeFileSync(new URL('data/quran-hafs-v22.json', OUT), JSON.stringify({ surahs }))
writeFileSync(new URL('data/surahs.json', OUT), JSON.stringify(meta.map((s) => ({ ar: s.name_arabic, n: s.ayah_count }))))

cpSync(at('dist/search/index.json'), new URL('data/index.json', OUT))
cpSync(at('dist/search/search.js'), new URL('qml/search.js', OUT))
cpSync(at('device/qml/AyahBar.qml'), new URL('qml/AyahBar.qml', OUT))
cpSync(at('device/qml/move.js'), new URL('qml/move.js', OUT))
cpSync(at('device/fonts/'), new URL('fonts/', OUT), { recursive: true })
cpSync(at('device/fonts.conf'), new URL('fonts.conf', OUT))
cpSync(at('device/guard.sh'), new URL('guard.sh', OUT))

console.log(`built dist/device/midad/ (${rows.length} ayat, ${meta.length} surahs)`)
