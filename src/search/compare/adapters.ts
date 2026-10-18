// Both engines behind one shape: query in, ranked "surah:ayah" keys out.
import { loadSearcher } from '../../../test/search/helpers.ts'
import {
  search as qseSearch,
  loadQuranData,
  loadMorphology,
  loadWordMap,
  loadSemanticData,
  loadPhoneticData,
  buildInvertedIndex,
  createArabicFuseSearch,
} from '../../../vendor/quran-search-engine/src/index.ts'

export type Hit = { key: string }
export type Engine = {
  name: string
  /** ranked keys; for range queries the keys of the range in order */
  search(q: string, k: number): string[]
}

export function oursEngine(): Engine {
  const { searcher } = loadSearcher()
  return {
    name: 'ours',
    search(q, k) {
      return searcher.search(q, k).flatMap((r) => {
        if (r.kind === 'ref' && r.to && r.to > r.ayah) {
          return Array.from({ length: r.to - r.ayah + 1 }, (_, i) => `${r.surah}:${r.ayah + i}`)
        }
        return [r.key]
      })
    },
  }
}

export type QseLoad = { loadMs: number; fuseMs: number }
export async function qseEngine(opts: { lemma: boolean; root: boolean; semantic?: boolean; name: string }): Promise<{ engine: Engine; load: QseLoad }> {
  const t0 = performance.now()
  const [quranData, morphologyMap, wordMap, semanticMap, phoneticMap] = await Promise.all([
    loadQuranData(), loadMorphology(), loadWordMap(), loadSemanticData(), loadPhoneticData(),
  ])
  const invertedIndex = buildInvertedIndex(morphologyMap, quranData, semanticMap)
  const t1 = performance.now()
  const fuse = createArabicFuseSearch(Array.from(quranData.values()), ['standard', 'uthmani'])
  const t2 = performance.now()
  const context = { quranData, morphologyMap, wordMap, invertedIndex, semanticMap, phoneticMap }
  const key = (v: { sura_id?: number; aya_id?: number }) => `${v.sura_id}:${v.aya_id}`
  return {
    load: { loadMs: t1 - t0, fuseMs: t2 - t1 },
    engine: {
      name: opts.name,
      search(q, k) {
        try {
          const res = qseSearch(q, context, { lemma: opts.lemma, root: opts.root, semantic: opts.semantic ?? false }, { page: 1, limit: Math.max(k, 20) }, fuse)
          return res.results.map(key)
        } catch {
          return []
        }
      },
    },
  }
}
