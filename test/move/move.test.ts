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
