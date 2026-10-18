// bun run src/hadith/build.ts
//   dist/device/midad/data/hadith.json        books + items for display and insert
//   dist/device/midad/data/hadith-index.json  search index (folded matns, trigram postings, numbers)
//   dist/device/midad/qml/hadith-search.js    src/search/hadith-core.js plus a CommonJS shim
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadHadith } from './load.ts'

const OUT = new URL('../../dist/device/midad/', import.meta.url)
const CORE = new URL('../search/hadith-core.js', import.meta.url)

export const BOOKS = [
  { id: 'bukhari', ar: 'صحيح البخاري' },
  { id: 'muslim', ar: 'صحيح مسلم' },
]

/** Load the core the way a classic-script consumer would: only its globals are visible. */
export function loadHadithCore(src: string) {
  return new Function(
    `${src}\n;return { foldText: foldText, HADITH_INDEX_VERSION: HADITH_INDEX_VERSION, createHadithSearcher: createHadithSearcher };`,
  )() as { foldText(s: string): string; HADITH_INDEX_VERSION: number; createHadithSearcher: (i: any) => any }
}

export function build() {
  const coreSrc = readFileSync(CORE, 'utf8')
  const core = loadHadithCore(coreSrc)
  const { items, report } = loadHadith()
  for (const d of ['data', 'qml']) mkdirSync(new URL(d, OUT), { recursive: true })

  // items are book-ordered; bs holds the book start offsets
  const bs = [0, items.findIndex((i) => i.book === 1), items.length]
  if (items.slice(0, bs[1]).some((i) => i.book !== 0)) throw new Error('items not ordered by book')

  const a: string[] = items.map((i) => core.foldText(i.matn))
  const post = new Map<string, number[]>()
  a.forEach((t, id) => {
    for (let k = 0; k + 3 <= t.length; k++) {
      const g = t.substr(k, 3)
      let p = post.get(g)
      if (!p) post.set(g, (p = []))
      if (p[p.length - 1] !== id) p.push(id)
    }
  })
  const g: Record<string, string> = {}
  for (const [tri, ids] of [...post].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    let prev = 0
    g[tri] = ids.map((id) => { const d = id - prev; prev = id; return d.toString(36) }).join(',')
  }

  const index = { v: core.HADITH_INDEX_VERSION, n: items.length, bs, num: items.map((i) => i.number), a, g }
  const indexJson = JSON.stringify(index)
  const hadithJson = JSON.stringify({ books: BOOKS, items: items.map((i) => [i.book, i.number, i.kitab, i.bab, i.matn]) })
  const footer = `\n// CommonJS shim for bun/node consumers; ignored by QML (guarded by typeof).\nif (typeof module !== "undefined" && module.exports) { module.exports = { createHadithSearcher: createHadithSearcher, foldText: foldText }; }\n`
  writeFileSync(new URL('data/hadith-index.json', OUT), indexJson)
  writeFileSync(new URL('data/hadith.json', OUT), hadithJson)
  writeFileSync(new URL('qml/hadith-search.js', OUT), coreSrc + footer)
  return {
    items,
    report,
    counts: [bs[1], items.length - bs[1]],
    indexBytes: Buffer.byteLength(indexJson),
    hadithBytes: Buffer.byteLength(hadithJson),
    triCount: post.size,
  }
}

if (import.meta.main) {
  const r = build()
  const kib = (n: number) => `${(n / 1024).toFixed(0)} KiB`
  console.log(`hadith.json ${kib(r.hadithBytes)}, hadith-index.json ${kib(r.indexBytes)} (${r.triCount} trigrams)`)
  console.log(`items: bukhari ${r.counts[0]}, muslim ${r.counts[1]}; LK rows ${r.report.rows.join('/')}`)
  const by = new Map<string, number>()
  for (const d of r.report.dropped) by.set(`${d.book ? 'muslim' : 'bukhari'}: ${d.why}`, (by.get(`${d.book ? 'muslim' : 'bukhari'}: ${d.why}`) ?? 0) + 1)
  console.log('dropped', Object.fromEntries(by))
  console.log('muslim join', r.report.muslimJoin, `gapsFilled ${r.report.gapsFilled}, blanked ${r.report.blanked}, unnumbered ${r.report.unnumbered}`)
}
