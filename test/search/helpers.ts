// Shared by the search evals. Loads the corpus straight from quran-png's bundle
// (independent of the engine's own build code) and loads the built search
// bundle exactly the way a QML JS library would: as plain script text with
// global function declarations, no module system.
import { readFileSync, existsSync } from 'node:fs'
import { build } from '../../src/search/build.ts'

const WORDS = new URL('../../vendor/quran-png/.data/quran-svg-hafs-kfgqpc/index/words.json', import.meta.url)

/** Remove every Arabic mark ("tashkeel" in the widest sense), keep letters and alef wasla. */
export const stripMarks = (s: string) => s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640]/g, '')

export type Ayah = { key: string; surah: number; ayah: number; words: string[]; text: string }

export function loadCorpus(): Ayah[] {
  const w = JSON.parse(readFileSync(WORDS, 'utf8'))
  const col = Object.fromEntries(w.fields.map((f: string, i: number) => [f, i]))
  const by = new Map<string, string[]>()
  for (const r of w.rows) {
    const [s, a] = (r[col.word_key] as string).split(':')
    const k = `${s}:${a}`
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(stripMarks(r[col.rasm_uthmani]))
  }
  const out: Ayah[] = []
  for (const [key, words] of by) {
    const [s, a] = key.split(':').map(Number)
    out.push({ key, surah: s, ayah: a, words: words.flatMap((x) => x.split(' ').filter(Boolean)), text: words.join(' ').replace(/\s+/g, ' ').trim() })
  }
  out.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah)
  return out
}

export type Result = { surah: number; ayah: number; to?: number; key: string; score: number; kind: string }
export type Searcher = { search(q: string, limit?: number): Result[] }

let cached: { searcher: Searcher; indexBytes: number } | null = null
export function loadSearcher() {
  if (cached) return cached
  if (!existsSync(new URL('../../dist/search/search.js', import.meta.url))) build()
  const src = readFileSync(new URL('../../dist/search/search.js', import.meta.url), 'utf8')
  const indexText = readFileSync(new URL('../../dist/search/index.json', import.meta.url), 'utf8')
  // QML-style load: evaluate as a classic script; only globals declared by it are visible.
  const lib = new Function(`${src}\n;return { createSearcher: createSearcher };`)()
  cached = { searcher: lib.createSearcher(JSON.parse(indexText)), indexBytes: Buffer.byteLength(indexText) }
  return cached
}

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
