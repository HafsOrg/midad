import { describe, expect, test } from 'bun:test'
import { loadCorpus, loadSearcher, rng, type Ayah } from './helpers.ts'
import { IMLAI_FIXTURE } from './imlai-fixture.ts'

const corpus = loadCorpus()
const byKey = new Map(corpus.map((a) => [a.key, a]))
const { searcher } = loadSearcher()
const SEED = 42

describe('corpus', () => {
  test('6236 ayat keyed surah:ayah', () => {
    expect(corpus.length).toBe(6236)
    expect(byKey.get('2:255')!.words.length).toBeGreaterThan(40)
  })
})

describe('C7 full ayah text, tashkeel stripped -> rank 1', () => {
  test('6236/6236', () => {
    const misses: string[] = []
    for (const a of corpus) {
      const r = searcher.search(a.text, 5)[0]
      const got = r && byKey.get(r.key)
      if (!got || got.text !== a.text) misses.push(`${a.key} -> ${r?.key}`)
    }
    console.log(`C7: ${corpus.length - misses.length}/${corpus.length}`, misses.slice(0, 10))
    expect(misses.length).toBe(0)
  })
})

function snippet(a: Ayah, r: () => number): string {
  const n = Math.min(a.words.length, 3 + Math.floor(r() * 3))
  const start = Math.floor(r() * (a.words.length - n + 1))
  return a.words.slice(start, start + n).join(' ')
}

const LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'
function mutate(s: string, r: () => number): string {
  const edits = 1 + Math.floor(r() * 2)
  let c = [...s]
  for (let e = 0; e < edits; e++) {
    const i = Math.floor(r() * c.length)
    const op = Math.floor(r() * 4)
    if (op === 0) c[i] = LETTERS[Math.floor(r() * LETTERS.length)] // substitute
    else if (op === 1) c.splice(i, 1) // delete
    else if (op === 2) c.splice(i, 0, LETTERS[Math.floor(r() * LETTERS.length)]) // insert
    else if (i + 1 < c.length) [c[i], c[i + 1]] = [c[i + 1], c[i]] // transpose
  }
  return c.join('')
}

function topFiveRate(make: (a: Ayah, r: () => number) => string, n = 2000) {
  const r = rng(SEED)
  let hit = 0
  const misses: string[] = []
  for (let i = 0; i < n; i++) {
    const a = corpus[Math.floor(r() * corpus.length)]
    const q = make(a, r)
    const top = searcher.search(q, 5).map((x) => x.key)
    // identical-text ayat count as the source
    if (top.some((k) => k === a.key || byKey.get(k)!.text === a.text)) hit++
    else misses.push(`${a.key} "${q}" -> ${top.join(',')}`)
  }
  return { rate: hit / n, misses }
}

describe('C8 snippets 3-5 words -> source in top 5', () => {
  test('>= 99% of 2000 (seed 42)', () => {
    const { rate, misses } = topFiveRate(snippet)
    console.log(`C8: ${(rate * 100).toFixed(2)}%`, misses.slice(0, 8))
    expect(rate).toBeGreaterThanOrEqual(0.99)
  })
})

describe('C9 snippets with 1-2 char edits -> source in top 5', () => {
  test('>= 95% of 2000 (seed 42)', () => {
    const { rate, misses } = topFiveRate((a, r) => mutate(snippet(a, r), r))
    console.log(`C9: ${(rate * 100).toFixed(2)}%`, misses.slice(0, 8))
    expect(rate).toBeGreaterThanOrEqual(0.95)
  })
})

describe("C10 imla'i spelling fixture -> rank 1", () => {
  test('fixture is well formed (>= 30, expected ayat exist)', () => {
    expect(IMLAI_FIXTURE.length).toBeGreaterThanOrEqual(30)
    for (const f of IMLAI_FIXTURE) expect(byKey.has(f.expect)).toBe(true)
  })
  test('>= 90% rank 1', () => {
    const wrong: string[] = []
    for (const f of IMLAI_FIXTURE) {
      const r = searcher.search(f.q, 5)[0]
      const ok = r && (r.key === f.expect || byKey.get(r.key)!.text === byKey.get(f.expect)!.text)
      if (!ok) wrong.push(`${f.expect} "${f.q}" -> ${r?.key}`)
    }
    const rate = 1 - wrong.length / IMLAI_FIXTURE.length
    console.log(`C10: ${(rate * 100).toFixed(1)}% (${IMLAI_FIXTURE.length - wrong.length}/${IMLAI_FIXTURE.length})`, wrong)
    expect(rate).toBeGreaterThanOrEqual(0.9)
  })
})

describe('C11 reference queries -> exact ayah/range at rank 1', () => {
  const cases: [string, number, number, number][] = [
    ['2:255', 2, 255, 255],
    ['البقرة ٢٥٥', 2, 255, 255],
    ['البقرة 255', 2, 255, 255],
    ['baqarah 255', 2, 255, 255],
    ['2:1-5', 2, 1, 5],
  ]
  for (const [q, s, from, to] of cases) {
    test(q, () => {
      const r = searcher.search(q, 5)[0]
      expect(r.surah).toBe(s)
      expect(r.ayah).toBe(from)
      expect(r.to ?? r.ayah).toBe(to)
    })
  }
})
