// Shared by the hadith evals. Loads the built search bundle exactly the way a QML JS
// library would: as plain script text with global function declarations, no module system.
import { existsSync, readFileSync } from 'node:fs'
import { build } from '../../src/hadith/build.ts'
import { rng, stripMarks } from '../search/helpers.ts'

export { rng, stripMarks }

const DIR = new URL('../../dist/device/ayah-toolbar/', import.meta.url)

export type Hadith = { books: { id: string; ar: string }[]; items: [number, string, string, string, string][] }
export type Result = { id: number; score: number; kind: 'text' | 'ref' }
export type Searcher = { search(q: string, limit?: number): Result[] }

let cached: { searcher: Searcher; hadith: Hadith; indexBytes: number; src: string } | null = null
export function loadHadithSearcher() {
  if (cached) return cached
  if (!existsSync(new URL('data/hadith-index.json', DIR))) build()
  const src = readFileSync(new URL('qml/hadith-search.js', DIR), 'utf8')
  const indexText = readFileSync(new URL('data/hadith-index.json', DIR), 'utf8')
  const lib = new Function(`${src}\n;return { createHadithSearcher: createHadithSearcher };`)()
  cached = {
    searcher: lib.createHadithSearcher(JSON.parse(indexText)),
    hadith: JSON.parse(readFileSync(new URL('data/hadith.json', DIR), 'utf8')),
    indexBytes: Buffer.byteLength(indexText),
    src,
  }
  return cached
}

/** 3-6 consecutive words of a matn with tashkeel stripped. */
export function snippet(matn: string, r: () => number): string {
  const words = stripMarks(matn).split(/\s+/).filter(Boolean)
  const n = Math.min(words.length, 3 + Math.floor(r() * 4))
  const st = Math.floor(r() * (words.length - n + 1))
  return words.slice(st, st + n).join(' ')
}

/** 1-2 character edits (delete / substitute / insert / swap) on letters. */
export function typos(q: string, r: () => number): string {
  const letters = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'
  let c = [...q]
  const edits = 1 + Math.floor(r() * 2)
  for (let e = 0; e < edits; e++) {
    const i = Math.floor(r() * c.length)
    if (c[i] === ' ') continue
    const kind = Math.floor(r() * 4)
    if (kind === 0) c.splice(i, 1)
    else if (kind === 1) c[i] = letters[Math.floor(r() * letters.length)]
    else if (kind === 2) c.splice(i, 0, letters[Math.floor(r() * letters.length)])
    else if (i + 1 < c.length && c[i + 1] !== ' ') [c[i], c[i + 1]] = [c[i + 1], c[i]]
  }
  return c.join('')
}

let stripped: string[] | null = null

/** How many distinct other matns contain this tashkeel-stripped snippet verbatim. */
export function otherMatnsContaining(h: Hadith, id: number, q: string): number {
  stripped ??= h.items.map((it) => stripMarks(it[4]))
  const others = new Set<string>()
  for (let i = 0; i < stripped.length; i++) if (stripped[i].includes(q) && h.items[i][4] !== h.items[id][4]) others.add(h.items[i][4])
  return others.size
}

const bases = new Map<boolean, { id: number; q: string }[]>()

/**
 * Seeded sample of source items (matns with >= 6 words) and their queries. A snippet like
 * "رسول الله صلى الله عليه" occurs in thousands of matns, so no ranker can put a particular
 * one in the top 5. With `answerable` a draw is repeated until at most 4 other distinct matns
 * contain the snippet (the top 5 can then hold all of them plus the source). The suites gate on
 * that sample and print the unfiltered rate next to it.
 */
export function sample(h: Hadith, typo: boolean, answerable = true, count = 2000, seed = 42) {
  let base = bases.get(answerable)
  if (!base) {
    const r = rng(seed)
    const pool = h.items.map((_, i) => i).filter((i) => stripMarks(h.items[i][4]).split(/\s+/).length >= 6)
    base = Array.from({ length: count }, () => {
      for (;;) {
        const id = pool[Math.floor(r() * pool.length)]
        const q = snippet(h.items[id][4], r)
        if (!answerable || otherMatnsContaining(h, id, q) <= 4) return { id, q }
      }
    })
    bases.set(answerable, base)
  }
  const r = rng(seed + 1)
  return base.map(({ id, q }) => ({ id, q: typo ? typos(q, r) : q }))
}
