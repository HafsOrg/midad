import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'

type Layout = {
  start: number
  end: number
  cursor: number
  emptyAbove: number
  deleteFrom: number
  emptyBelow: number
  textBelow: boolean
}
type Plan = { lines: number; edits: [number, number, string][]; after: Layout }

const SRC = readFileSync(new URL('../../device/qml/move.js', import.meta.url), 'utf8')

// Loaded the way QML's engine sees it: a classic script whose top-level declarations are the API.
const Move = new Function(`${SRC}\n;return { isInsert, insertAt, layoutAround, planMove };`)() as {
  isInsert(p: string): boolean
  insertAt(t: string, cursor: number): { start: number; end: number } | null
  layoutAround(t: string, start: number, end: number, cursor: number): Layout
  planMove(m: Layout, k: number, keepBelow: boolean): Plan
}

const AYAH = '⁡ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ'
const HADITH = '⁢إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ'
const USER = 'ملاحظة'

test('move.js parses as an ES2017 classic script with no host APIs', () => {
  expect(() => parse(SRC, { ecmaVersion: 2017, sourceType: 'script' })).not.toThrow()
  for (const g of ['require(', 'process.', 'Bun.', 'console.', 'import ', 'export ', 'async ', 'await ']) {
    expect(SRC.includes(g)).toBe(false)
  }
})

describe('which paragraphs are inserts', () => {
  test('the same rule as the font shim', () => {
    expect(Move.isInsert(AYAH)).toBe(true)
    expect(Move.isInsert(HADITH)).toBe(true)
    expect(Move.isInsert('ab⁡c')).toBe(true) // a tag near the start
    expect(Move.isInsert('abcde⁡')).toBe(false)
    expect(Move.isInsert('ٱلْحَمْدُ')).toBe(true) // an ayah from before the tags (alef wasla)
    expect(Move.isInsert(USER)).toBe(false)
    expect(Move.isInsert('')).toBe(false)
  })
  test('insertAt finds the paragraph holding the cursor', () => {
    const t = `${AYAH}\n${USER}\n\n${HADITH}`
    const h = t.indexOf('⁢')
    expect(Move.insertAt(t, 0)).toEqual({ start: 0, end: AYAH.length })
    expect(Move.insertAt(t, AYAH.length)).toEqual({ start: 0, end: AYAH.length }) // at its end
    expect(Move.insertAt(t, AYAH.length + 1)).toBe(null) // start of the user's line
    expect(Move.insertAt(t, h - 1)).toBe(null) // the empty line
    expect(Move.insertAt(t, h)).toEqual({ start: h, end: t.length })
    expect(Move.insertAt(t, t.length + 1)).toBe(null)
  })
})

// Paragraphs of a page: '' for an empty line.
const paragraphs = (t: string) => t.split('\n')
const nonEmpty = (t: string) => paragraphs(t).filter((p) => p !== '')
const indexAt = (t: string, pos: number) => t.slice(0, pos).split('\n').length - 1

function apply(text: string, edits: [number, number, string][]) {
  let t = text
  let limit = Infinity
  for (const [from, to, ins] of edits) {
    expect(from <= to && to <= t.length).toBe(true)
    expect(to <= limit).toBe(true) // each edit lies before the ones already applied
    expect(/^\n*$/.test(t.slice(from, to))).toBe(true) // only newlines are ever removed
    expect(/^\n*$/.test(ins)).toBe(true) // and only newlines added
    t = t.slice(0, from) + ins + t.slice(to)
    limit = from
  }
  return t
}

function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
}

test('every move keeps the text, moves the insert the planned lines, and holds the text below', () => {
  const r = random(42)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  let cases = 0
  for (let n = 0; n < 1500; n++) {
    const ps = Array.from({ length: 1 + Math.floor(r() * 8) }, () => (r() < 0.45 ? '' : pick([AYAH, HADITH, USER])))
    const text = ps.join('\n')
    let pos = 0
    for (const p of ps) {
      const start = pos
      pos += p.length + 1
      if (!Move.isInsert(p)) continue
      const end = start + p.length
      const cursor = start + Math.floor(r() * (p.length + 1))
      expect(Move.insertAt(text, cursor)).toEqual({ start, end })
      const m = Move.layoutAround(text, start, end, cursor)
      const k = pick([-6, -3, -2, -1, 1, 2, 3, 6])
      const keepBelow = r() < 0.7
      const plan = Move.planMove(m, k, keepBelow)
      const t = apply(text, plan.edits)
      cases++

      // Newlines inserted at an insert's start would split it, and xochitl gives the split-off
      // text the Paragraph style; that is only allowed for the page's first paragraph.
      for (const [from, to, ins] of plan.edits) {
        if (ins === '') continue
        expect(to).toBe(from)
        expect(from > start && from < end).toBe(false)
        if (from === start) expect(start).toBe(0)
      }

      expect(plan.lines).toBe(Math.max(k, -m.emptyAbove)) // up stops at the text above
      expect(nonEmpty(t)).toEqual(nonEmpty(text)) // no text changed, none reordered
      expect(t.slice(plan.after.start, plan.after.end)).toBe(p) // the insert itself is untouched
      expect(indexAt(t, plan.after.start)).toBe(indexAt(text, start) + plan.lines)
      expect(plan.after.cursor - plan.after.start).toBe(cursor - start)
      expect(Move.layoutAround(t, plan.after.start, plan.after.end, plan.after.cursor)).toEqual(plan.after)
      expect(t.slice(0, m.deleteFrom)).toBe(text.slice(0, m.deleteFrom)) // everything above is as it was

      if (m.textBelow) {
        const y = text.slice(end).search(/[^\n]/) + end
        const shift = indexAt(t, y + t.length - text.length) - indexAt(text, y)
        if (plan.lines > 0) expect(shift).toBe(plan.lines - Math.min(plan.lines, m.emptyBelow))
        else if (plan.lines < 0) expect(shift).toBe(keepBelow ? 0 : plan.lines)
        else expect(shift).toBe(0)
      }
    }
  }
  expect(cases).toBeGreaterThan(1000)
})

const MoveP = new Function(
  `${SRC}\n;return { tagIndex, placementOf, placementRun, planPlacement, planMoveTo, layoutAround, isInsert };`,
)() as {
  tagIndex(p: string): number
  placementOf(p: string): { right: number; left: number; run: boolean }
  placementRun(right: number, left: number): string
  planPlacement(t: string, start: number, end: number, right: number, left: number): { edit: [number, number, string]; grow: number }
  planMoveTo(t: string, m: Layout, k: number, keepBelow: boolean, right: number, left: number): Plan
  layoutAround(t: string, start: number, end: number, cursor: number): Layout
  isInsert(p: string): boolean
}

// What a reader sees: tags and placement runs are invisible.
const visible = (t: string) => t.replace(/[⁡⁢︀-️]/g, '')

describe('placement', () => {
  test('runs round-trip and stay invisible', () => {
    for (const [r, l] of [[0, 0], [300, 0], [0, 300], [1144, 0], [-150, 2047], [-2048, 17]]) {
      const run = MoveP.placementRun(r, l)
      expect(run).toMatch(/^[︀-️]{6}$/)
      expect(MoveP.placementOf(`⁡${run}${AYAH.slice(1)}`)).toEqual({ right: r, left: l, run: true })
    }
    expect(MoveP.placementOf(AYAH)).toEqual({ right: 0, left: 0, run: false })
    expect(MoveP.placementOf(`⁡︀︁`)).toEqual({ right: 0, left: 0, run: false })
  })

  test('every 2D move keeps what a reader sees and lands the planned placement', () => {
    const r = random(7)
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    const LEGACY = 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'
    const placed = (p: string) => `${p[0]}${MoveP.placementRun(pick([0, 120, 400]), pick([0, 80]))}${p.slice(1)}`
    let cases = 0
    for (let n = 0; n < 1200; n++) {
      const ps = Array.from({ length: 1 + Math.floor(r() * 7) }, () =>
        r() < 0.4 ? '' : pick([AYAH, HADITH, USER, LEGACY, placed(AYAH), placed(HADITH)]),
      )
      const text = ps.join('\n')
      let pos = 0
      for (const p of ps) {
        const start = pos
        pos += p.length + 1
        if (!MoveP.isInsert(p)) continue
        const end = start + p.length
        const cursor = start + Math.floor(r() * (p.length + 1))
        const m = MoveP.layoutAround(text, start, end, cursor)
        const k = pick([-3, -1, 0, 0, 1, 2, 4])
        const right = pick([0, 0, 150, 333, 600])
        const left = pick([0, 0, 90, 250])
        const plan = MoveP.planMoveTo(text, m, k, r() < 0.7, right, left)
        let t = text
        let limit = Infinity
        for (const [from, to, ins] of plan.edits) {
          expect(to <= limit).toBe(true)
          const gone = t.slice(from, to)
          // Only newlines, tags and runs change hands, plus a pre-tag ayah's first letter,
          // which goes back in right behind its new tag.
          expect(visible(gone).replace(/\n/g, '')).toBe(visible(ins).replace(/\n/g, ''))
          t = t.slice(0, from) + ins + t.slice(to)
          limit = from
        }
        cases++
        expect(nonEmpty(visible(t))).toEqual(nonEmpty(visible(text)))
        const moved = t.slice(plan.after.start, plan.after.end)
        expect(visible(moved)).toBe(visible(p))
        const now = MoveP.placementOf(moved)
        expect([now.right, now.left]).toEqual([right, left])
        if (right !== 0 || left !== 0) expect(MoveP.tagIndex(moved)).toBeGreaterThanOrEqual(0)
        expect(indexAt(t, plan.after.start)).toBe(indexAt(text, start) + plan.lines)
        expect(MoveP.layoutAround(t, plan.after.start, plan.after.end, plan.after.cursor)).toEqual(plan.after)
        expect(plan.after.cursor >= plan.after.start && plan.after.cursor <= plan.after.end).toBe(true)
      }
    }
    expect(cases).toBeGreaterThan(800)
  })
})

test('firstInsert finds the first ayah or hadith on the page', () => {
  const F = new Function(`${SRC}\n;return { firstInsert };`)() as { firstInsert(t: string): { start: number; end: number } | null }
  expect(F.firstInsert('')).toBe(null)
  expect(F.firstInsert(`${USER}\n\n${USER}`)).toBe(null)
  const t = `${USER}\n\n${HADITH}\n${AYAH}`
  const h = t.indexOf('⁢')
  expect(F.firstInsert(t)).toEqual({ start: h, end: h + HADITH.length })
  expect(F.firstInsert(AYAH)).toEqual({ start: 0, end: AYAH.length })
})
