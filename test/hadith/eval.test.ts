import { describe, expect, test } from 'bun:test'
import { loadHadithSearcher, sample, stripMarks } from './helpers.ts'

const { searcher, hadith } = loadHadithSearcher()
const items = hadith.items

describe('hadith.json shape', () => {
  test('books and items', () => {
    expect(hadith.books).toEqual([{ id: 'bukhari', ar: 'صحيح البخاري' }, { id: 'muslim', ar: 'صحيح مسلم' }])
    for (const it of items) {
      expect(it.length).toBe(5)
      expect([0, 1]).toContain(it[0])
      expect(typeof it[1]).toBe('string')
      expect(it[4].length).toBeGreaterThan(0)
    }
  })
  test('matns are clean: no direction marks, no double spaces, no edge junk', () => {
    for (const it of items) {
      expect(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(it[4])).toBe(false)
      expect(/\s{2,}/.test(it[4])).toBe(false)
      expect(it[4]).toBe(it[4].trim())
      expect(/^[\s.,\u060C:\-]/.test(it[4])).toBe(false)
    }
  })
  test('matns keep tashkeel', () => {
    const marked = items.filter((it) => stripMarks(it[4]) !== it[4]).length
    expect(marked / items.length).toBeGreaterThan(0.95)
  })
  test('Bukhari numbers are integers and Muslim numbers are N or N+letters', () => {
    for (const it of items) expect(it[0] === 0 ? /^\d+$/.test(it[1]) : /^(\d+[a-z]{0,2})?$/.test(it[1])).toBe(true)
  })
})

function topFiveRate(typo: boolean, answerable = true) {
  let hit = 0
  const misses: string[] = []
  const qs = sample(hadith, typo, answerable)
  for (const { id, q } of qs) {
    const top = searcher.search(q, 5).map((x) => x.id)
    // the Sahihayn repeat matns: any item with an identical matn counts
    if (top.some((t) => t === id || items[t][4] === items[id][4])) hit++
    else misses.push(`${items[id][0]}:${items[id][1]} "${q}" -> ${top.join(',')}`)
  }
  return { rate: hit / qs.length, misses }
}

describe('H1 snippets 3-6 words, tashkeel stripped -> source in top 5', () => {
  test('>= 95% of 2000 answerable snippets (seed 42)', () => {
    const { rate, misses } = topFiveRate(false)
    console.log(`H1: ${(rate * 100).toFixed(2)}%`, misses.slice(0, 8))
    expect(rate).toBeGreaterThanOrEqual(0.95)
  })
  test('reported only: all random snippets, ambiguous ones included', () => {
    console.log(`H1 (unfiltered): ${(topFiveRate(false, false).rate * 100).toFixed(2)}%`)
  })
})

describe('H2 snippets with 1-2 char edits -> source in top 5', () => {
  test('>= 90% of 2000 answerable snippets (seed 42)', () => {
    const { rate, misses } = topFiveRate(true)
    console.log(`H2: ${(rate * 100).toFixed(2)}%`, misses.slice(0, 8))
    expect(rate).toBeGreaterThanOrEqual(0.9)
  })
  test('reported only: all random snippets, ambiguous ones included', () => {
    console.log(`H2 (unfiltered): ${(topFiveRate(true, false).rate * 100).toFixed(2)}%`)
  })
})

describe('H3 reference queries -> the numbered hadith at rank 1', () => {
  const at = (book: number, n: string) => items.findIndex((it) => it[0] === book && it[1] === n)
  const first = (book: number, whole: string) => items.findIndex((it) => it[0] === book && parseInt(it[1]) === +whole && it[1] !== '')
  const cases: [string, number][] = [
    ['البخاري ١', at(0, '1')],
    ['البخاري 1', at(0, '1')],
    ['bukhari 1', at(0, '1')],
    ['مسلم ٨', first(1, '8')],
    ['muslim 2564', first(1, '2564')],
    ['Sahih Bukhari 603', at(0, '603')],
    ['صحيح البخاري ٦٠٣', at(0, '603')],
    ['muslim 8a', at(1, '8a')],
    ['muslim 8b', at(1, '8b')],
    ['bukhari: 7000', at(0, '7000')],
  ]
  for (const [q, want] of cases) {
    test(q, () => {
      expect(want).toBeGreaterThanOrEqual(0)
      const r = searcher.search(q, 5)
      expect(r[0].kind).toBe('ref')
      expect(r[0].id).toBe(want)
    })
  }
  test('a number outside the book resolves to a neighbour, never throws', () => {
    expect(searcher.search('bukhari 99999', 5)[0].kind).toBe('ref')
    expect(searcher.search('muslim 0', 5)[0].kind).toBe('ref')
  })
  test('plain text with digits is not a reference', () => {
    expect(searcher.search('إنما الأعمال بالنيات', 5)[0].kind).toBe('text')
  })
})

describe('H4 well-known hadith by opening words', () => {
  const cases: [string, string][] = [
    ['إنما الأعمال بالنيات', 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ'],
    ['من كذب علي متعمدا فليتبوأ مقعده من النار', 'مَنْ كَذَبَ عَلَىَّ مُتَعَمِّدًا فَلْيَتَبَوَّأْ مَقْعَدَهُ مِنَ النَّارِ'],
    ['لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه', 'لاَ يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لأَخِيهِ'],
  ]
  for (const [q, frag] of cases) {
    test(q, () => {
      const top = searcher.search(q, 5).map((x) => items[x.id][4])
      expect(top.some((m) => stripMarks(m).includes(stripMarks(frag)))).toBe(true)
    })
  }
})
