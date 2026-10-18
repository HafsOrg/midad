// Loads the Sahihayn matn corpus from vendor/hadith (LK-Hadith-Corpus CSVs for
// kitab/bab/matn, fawaz hadith-api for Muslim's Abd al-Baqi numbers) and cleans it.
// Shared by the index build and the evals; no index logic here.
import { readFileSync, readdirSync } from 'node:fs'

const VENDOR = new URL('../../vendor/hadith/', import.meta.url)

export type Item = { book: 0 | 1; number: string; kitab: string; bab: string; matn: string }
export type LoadReport = {
  rows: [number, number]
  dropped: { book: number; number: string; why: string; matn: string }[]
  muslimJoin: { exact: number; viaPrefix: number }
  gapsFilled: number
  blanked: number
  unnumbered: number
}

function csv(t: string): string[][] {
  const rows: string[][] = []
  let r: string[] = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c
    } else if (c === '"') q = true
    else if (c === ',') { r.push(f); f = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      r.push(f); f = ''; rows.push(r); r = []
    } else f += c
  }
  if (f || r.length) { r.push(f); rows.push(r) }
  return rows
}

type Row = Record<string, string>
function loadBook(dir: string): Row[] {
  const out: Row[] = []
  const files = readdirSync(new URL(`lk/${dir}/`, VENDOR)).filter((f) => f.endsWith('.csv'))
  files.sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))
  for (const f of files) {
    const rows = csv(readFileSync(new URL(`lk/${dir}/${f}`, VENDOR), 'utf8'))
    const h = rows[0]
    for (const r of rows.slice(1)) {
      if (r.length < h.length - 2) continue
      out.push(Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
    }
  }
  return out
}

/** Direction marks go; quote marks and the stray "." / "-" the corpus wraps matns in go; whitespace collapses. */
export function cleanMatn(s: string): string {
  s = s
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFC]/g, '')
    .replace(/[\u0640]/g, '')
    .replace(/["\u00AB\u00BB*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,\u060C\u061B:!?])/g, '$1')
    .trim()
  // leading/trailing junk punctuation (keep closing brackets/parens that balance)
  s = s.replace(/^[\s.,\u060C\u061B:\-\u2013]+/, '').replace(/[\s,\u060C\u061B:\-\u2013]+$/, '')
  return s.trim()
}

/** kitab/bab: the CSVs hold a literal "nan" where pandas had no value. */
const cleanField = (s: string) => { const c = cleanMatn(s); return c === 'nan' ? '' : c }

const norm = (s: string) => s.replace(/[^\u0621-\u064A]/g, '').replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')

function muslimNumber(a: number): string {
  const whole = Math.floor(a + 1e-9)
  const sub = Math.round((a - whole) * 100)
  if (!sub) return String(whole)
  let s = ''
  for (let n = sub; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s
  return whole + s
}

/** Blank every number outside the longest strictly increasing run: true order is monotone, so the rest are text collisions. */
function keepIncreasing(nums: (number | null)[]): number {
  const tails: number[] = [] // index of the smallest tail for each length
  const prevIdx: number[] = new Array(nums.length).fill(-1)
  nums.forEach((v, i) => {
    if (v === null) return
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nums[tails[mid]]! < v) lo = mid + 1; else hi = mid }
    if (lo > 0) prevIdx[i] = tails[lo - 1]
    tails[lo] = i
  })
  const keep = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prevIdx[i]) keep.add(i)
  let blanked = 0
  nums.forEach((v, i) => { if (v !== null && !keep.has(i)) { nums[i] = null; blanked++ } })
  return blanked
}

/**
 * Some LK rows have no Abd al-Baqi number (fawaz omits arabicnumber, or the text did not
 * join). Fill a gap only when its neighbours pin it down; leave the rest unnumbered.
 *   N.01 .. N.04          -> N.02, N.03
 *   N.0k then N+1 (.01|-) -> more subs of N
 *   N then N+r+1 (.01|-)  -> N+1 .. N+r
 */
function fillGaps(nums: (number | null)[]): number {
  let filled = 0
  const whole = (x: number) => Math.floor(x + 1e-9)
  const sub = (x: number) => Math.round((x - whole(x)) * 100)
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== null) continue
    let j = i; while (j < nums.length && nums[j] === null) j++
    const a = i > 0 ? nums[i - 1] : null, b = j < nums.length ? nums[j] : null
    const run = j - i
    if (a !== null && b !== null) {
      let fill: ((k: number) => number) | null = null
      if (whole(a) === whole(b) && sub(a) > 0 && sub(b) - sub(a) - 1 === run) fill = (k) => whole(a) + (sub(a) + k + 1) / 100
      else if (whole(b) === whole(a) + 1 && sub(a) > 0 && sub(b) <= 1) fill = (k) => whole(a) + (sub(a) + k + 1) / 100
      else if (sub(a) === 0 && sub(b) <= 1 && whole(b) - whole(a) - 1 === run) fill = (k) => whole(a) + k + 1
      if (fill) { for (let k = 0; k < run; k++) nums[i + k] = fill(k); filled += run }
    }
    i = j
  }
  return filled
}

/** A matn made only of these words is a cross-reference stub ("same chain, same wording"), not text. */
const STUB_WORDS = new Set('بهذا بذلك مثله نحوه بنحوه بمثله ومثله ونحوه وساق الحديث بمثل بنحو حديثه ذلك بهذه الاسناد بهذا الاسناد ح'.split(' '))

const foldWords = (s: string) => s.replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627').split(/[^\u0621-\u064A]+/).filter(Boolean)

function reason(matn: string): string {
  const letters = norm(matn)
  if (!letters) return 'empty matn (chain-only cross-reference)'
  const words = foldWords(matn)
  if (words.every((w) => STUB_WORDS.has(w))) return 'stub matn (cross-reference only)'
  if (letters.length < SAME_CHAIN_MAX_LETTERS && sameChainRemark(words)) return 'same-chain remark (no matn of its own)'
  return ''
}

const SAME_CHAIN_MAX_LETTERS = 160
const SAME_AS = new Set(['بمثله', 'بنحوه', 'مثله', 'نحوه'])
/** "[narrator of 0-3 words] بهذا الإسناد ..." or "[narrator] مثله/نحوه ...": a remark that the chain differs, not a hadith. */
function sameChainRemark(words: string[]): boolean {
  for (let k = 0; k <= 3 && k < words.length; k++) {
    if (words[k] === 'بهذا' && words[k + 1] === 'الاسناد') return true
    if (SAME_AS.has(words[k])) return true
  }
  return false
}

export function loadHadith(): { items: Item[]; report: LoadReport } {
  const dropped: LoadReport['dropped'] = []
  const items: Item[] = []

  const bk = loadBook('Bukhari')
  for (const r of bk) {
    const matn = cleanMatn(r.Arabic_Matn)
    const number = String(Math.floor(parseFloat(r.Hadith_number)))
    const why = reason(matn)
    if (why) { dropped.push({ book: 0, number, why, matn }); continue }
    items.push({ book: 0, number, kitab: cleanField(r.Chapter_Arabic), bab: cleanField(r.Section_Arabic), matn })
  }

   // Muslim: LK's Hadith_number is not fawaz's running sequence (and fawaz's own order is not
  // sorted by Abd al-Baqi number), so join on the full text (isnad + matn, letters only);
  // repeated texts take unused fawaz entries in order. Rows with no match stay unnumbered.
  const fz = JSON.parse(readFileSync(new URL('ara-muslim.min.json', VENDOR), 'utf8')).hadiths as {
    hadithnumber: number; arabicnumber: number; text: string
  }[]
  const byText = new Map<string, number[]>()
  fz.forEach((h, i) => {
    const k = norm(h.text)
    if (k) (byText.get(k) ?? byText.set(k, []).get(k)!).push(i)
  })
  const ms = loadBook('Muslim')
  const byPrefix = new Map<string, number[]>()
  fz.forEach((h, i) => {
    const k = norm(h.text).slice(0, 60)
    if (k) (byPrefix.get(k) ?? byPrefix.set(k, []).get(k)!).push(i)
  })
  const idx: number[] = new Array(ms.length).fill(-1)
  const used = new Set<number>()
  let prevNum = 0, exact = 0, viaPrefix = 0
  const numOf = (x: number) => (fz[x].arabicnumber === undefined ? null : Number(fz[x].arabicnumber))
  // repeated texts: take the unused entry whose number follows the previous row's most closely
  const take = (c: number[] | undefined) => {
    if (!c) return -1
    let best = -1, bestScore = Infinity
    for (const x of c) {
      if (used.has(x)) continue
      const n = numOf(x)
      const score = n === null ? 1e8 : n >= prevNum ? n - prevNum : 1e6 + (prevNum - n)
      if (score < bestScore) { best = x; bestScore = score }
    }
    return best
  }
  ms.forEach((r, i) => {
    const t = norm(r.Arabic_Hadith)
    let pick = take(byText.get(t))
    if (pick >= 0) exact++
    else if ((pick = take(byPrefix.get(t.slice(0, 60)))) >= 0) viaPrefix++
    if (pick < 0) return
    idx[i] = pick; used.add(pick); prevNum = numOf(pick) ?? prevNum
  })
  const rowNums = idx.map((j) => (j >= 0 && fz[j].arabicnumber !== undefined ? Number(fz[j].arabicnumber) : null))
  const blanked = keepIncreasing(rowNums)
  const gapsFilled = fillGaps(rowNums)
  let unnumbered = 0
  ms.forEach((r, i) => {
    const matn = cleanMatn(r.Arabic_Matn)
    const number = rowNums[i] !== null ? muslimNumber(rowNums[i]!) : ''
    const why = reason(matn)
    if (why) { dropped.push({ book: 1, number, why, matn }); return }
    if (!number) unnumbered++
    items.push({ book: 1, number, kitab: cleanField(r.Chapter_Arabic), bab: cleanField(r.Section_Arabic), matn })
  })

  return { items, report: { rows: [bk.length, ms.length], dropped, muslimJoin: { exact, viaPrefix }, gapsFilled, blanked, unnumbered } }
}
