// Build the on-device Quran text: dist/device/quran-uthmani.json = { surahs: string[][] }, one
// Uthmani string per ayah (words joined by spaces), from quran-png's KFGQPC word index so
// numbering matches the renderer and the search index.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BUNDLE = new URL('../../vendor/quran-png/.data/quran-svg-hafs-kfgqpc/index/', import.meta.url)
const OUT = new URL('../../dist/device/', import.meta.url)

const words = JSON.parse(readFileSync(new URL('words.json', BUNDLE), 'utf8'))
const col = Object.fromEntries(words.fields.map((f: string, i: number) => [f, i]))
const surahCount = JSON.parse(readFileSync(new URL('surahs.json', BUNDLE), 'utf8')).surahs.length as number

const surahs: string[][][] = Array.from({ length: surahCount }, () => [])
for (const r of words.rows) {
  const [s, a] = (r[col.word_key] as string).split(':').map(Number)
  ;(surahs[s - 1][a - 1] ??= []).push(r[col.rasm_uthmani])
}

const text = surahs.map((ayat) => ayat.map((w) => w.join(' ')))
const total = text.reduce((n, s) => n + s.length, 0)
if (total !== 6236) throw new Error(`expected 6236 ayat, got ${total}`)

mkdirSync(OUT, { recursive: true })
writeFileSync(new URL('quran-uthmani.json', OUT), JSON.stringify({ surahs: text }))
console.log(`wrote ${total} ayat to dist/device/quran-uthmani.json`)
