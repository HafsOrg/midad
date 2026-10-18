import { describe, expect, test } from 'bun:test'
import { loadCorpus, loadSearcher } from './helpers.ts'
import { sample } from './queries.ts'
import { IMLAI_FIXTURE } from './imlai-fixture.ts'

const corpus = loadCorpus()
const byKey = new Map(corpus.map((a) => [a.key, a]))
const { searcher } = loadSearcher()

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

function topFiveRate(typo: boolean) {
  let hit = 0
  const misses: string[] = []
  const qs = sample(corpus, typo)
  for (const { source: a, q } of qs) {
    const top = searcher.search(q, 5).map((x) => x.key)
    // identical-text ayat count as the source
    if (top.some((k) => k === a.key || byKey.get(k)!.text === a.text)) hit++
    else misses.push(`${a.key} "${q}" -> ${top.join(',')}`)
  }
  return { rate: hit / qs.length, misses }
}

describe('C8 snippets 3-5 words -> source in top 5', () => {
  test('>= 99% of 2000 (seed 42)', () => {
    const { rate, misses } = topFiveRate(false)
    console.log(`C8: ${(rate * 100).toFixed(2)}%`, misses.slice(0, 8))
    expect(rate).toBeGreaterThanOrEqual(0.99)
  })
})

describe('C9 snippets with 1-2 char edits -> source in top 5', () => {
  test('>= 95% of 2000 (seed 42)', () => {
    const { rate, misses } = topFiveRate(true)
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
