// bun run build:search
//   dist/search/search.js  the core as one standalone classic script (QML `.pragma library` friendly)
//   dist/search/index.json the prebuilt search index (folded corpus, trigram postings, surah names)
//   dist/search/text.json  Uthmani display text per ayah (with marks), for result lists; not part of the index budget
// Corpus: quran-png's own bundle (index/words.json), the KFGQPC Hafs text it renders from.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BUNDLE = new URL('../../vendor/quran-png/.data/quran-svg-hafs-kfgqpc/index/', import.meta.url)
const DIST = new URL('../../dist/search/', import.meta.url)
const CORE = new URL('./core.js', import.meta.url)

const EXTRA_LATIN: Record<number, string[]> = {
  1: ['fatiha', 'fatihah', 'opener', 'umm al kitab'],
  2: ['baqara', 'cow'],
  3: ['al imran', 'ale imran', 'ali imran', 'imran'],
  9: ['tawba', 'tawbah', 'taubah', 'bara ah', 'baraah'],
  12: ['yusuf', 'yousef'],
  17: ['isra', 'israa', 'bani israel', 'bani israil'],
  18: ['kahf', 'cave'],
  36: ['yasin', 'yaseen', 'ya sin', 'ya seen'],
  40: ['ghafir', 'mumin', 'al mumin'],
  41: ['fussilat', 'ha mim sajdah'],
  55: ['rahman', 'rehman', 'ar rahman'],
  56: ['waqia', 'waqiah'],
  67: ['mulk', 'tabarak'],
  93: ['duha', 'dhuha', 'dhuhaa'],
  108: ['kawthar', 'kauthar', 'kausar'],
  109: ['kafirun', 'kafiroon'],
  111: ['masad', 'lahab', 'tabbat'],
  112: ['ikhlas', 'ikhlaas', 'tawhid', 'tauheed'],
  113: ['falaq'],
  114: ['nas', 'naas'],
}
const EXTRA_ARABIC: Record<number, string[]> = {
  1: ['أم الكتاب', 'السبع المثاني'],
  9: ['براءة'],
  17: ['بني إسرائيل'],
  40: ['المؤمن'],
  67: ['تبارك'],
  111: ['اللهب', 'تبت'],
  112: ['التوحيد'],
}

/** Load the core exactly as a classic-script consumer would: only its globals are visible. */
export function loadCore(src: string) {
  return new Function(
    `${src}\n;return { foldText: foldText, latinKeys: latinKeys, arabicKeys: arabicKeys, INDEX_VERSION: INDEX_VERSION };`,
  )() as {
    foldText(s: string): string
    latinKeys(s: string): string[]
    arabicKeys(s: string): string[]
    INDEX_VERSION: number
  }
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')

export function build() {
  const coreSrc = readFileSync(CORE, 'utf8')
  const core = loadCore(coreSrc)
  mkdirSync(DIST, { recursive: true })

  const words = JSON.parse(readFileSync(new URL('words.json', BUNDLE), 'utf8'))
  const col = Object.fromEntries(words.fields.map((f: string, i: number) => [f, i]))
  const surahs = JSON.parse(readFileSync(new URL('surahs.json', BUNDLE), 'utf8')).surahs as any[]

  const sur = surahs.map((s) => s.ayah_count as number)
  const start: number[] = [0]
  for (const n of sur) start.push(start[start.length - 1] + n)
  const N = start[start.length - 1]

  const imlai: string[][] = Array.from({ length: N }, () => [])
  const uth: string[][] = Array.from({ length: N }, () => [])
  const disp: string[][] = Array.from({ length: N }, () => [])
  for (const r of words.rows) {
    const [s, a] = (r[col.word_key] as string).split(':').map(Number)
    const id = start[s - 1] + a - 1
    imlai[id].push(r[col.search])
    uth[id].push(r[col.rasm_uthmani])
    disp[id].push(r[col.rasm_uthmani])
  }

  const a: string[] = [], u: string[] = []
  const post = new Map<string, number[]>()
  const addTris = (id: number, t: string) => {
    for (let k = 0; k + 3 <= t.length; k++) {
      const g = t.substr(k, 3)
      let p = post.get(g)
      if (!p) post.set(g, (p = []))
      if (p[p.length - 1] !== id) p.push(id)
    }
  }
  for (let id = 0; id < N; id++) {
    const fa = core.foldText(imlai[id].join(' '))
    const fu = core.foldText(uth[id].join(' '))
    a.push(fa)
    u.push(fu === fa ? '' : fu)
    addTris(id, fa)
    if (fu !== fa) addTris(id, fu)
  }
  const g: Record<string, string> = {}
  for (const [tri, ids] of [...post].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    let prev = 0
    g[tri] = ids.map((id) => { const d = id - prev; prev = id; return d.toString(36) }).join(',')
  }

  const names = surahs.map((s) => {
    const lat = [s.name_latin, s.name_english, ...(EXTRA_LATIN[s.number] ?? [])].map(ascii)
    const lset = new Set<string>(), aset = new Set<string>()
    for (const n of lat) for (const k of core.latinKeys(n)) if (k) lset.add(k)
    for (const n of [s.name_arabic, ...(EXTRA_ARABIC[s.number] ?? [])]) for (const k of core.arabicKeys(n)) if (k) aset.add(k)
    return { l: [...lset], a: [...aset] }
  })

  const index = { v: core.INDEX_VERSION, n: N, sur, a, u, g, names }
  const indexJson = JSON.stringify(index)
  const footer = `\n// CommonJS shim for bun/node consumers; ignored by QML (guarded by typeof).\nif (typeof module !== "undefined" && module.exports) { module.exports = { createSearcher: createSearcher, foldText: foldText }; }\n`
  writeFileSync(new URL('search.js', DIST), coreSrc + footer)
  writeFileSync(new URL('index.json', DIST), indexJson)
  writeFileSync(new URL('text.json', DIST), JSON.stringify(disp.map((w) => w.join(' '))))
  return { indexBytes: Buffer.byteLength(indexJson), triCount: post.size, N }
}

if (import.meta.main) {
  const r = build()
  console.log(`dist/search/search.js, dist/search/index.json (${(r.indexBytes / 1024).toFixed(0)} KiB, ${r.triCount} trigrams, ${r.N} ayat), dist/search/text.json`)
}
