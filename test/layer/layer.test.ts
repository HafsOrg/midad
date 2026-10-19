import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'

type Box = { x: number; y: number; w: number }
type Rect = { x: number; y: number; width: number; height: number }
type Doc = { rev: number; v: number; pages: Record<string, unknown[]> }

const SRC = readFileSync(new URL('../../device/qml/layer.js', import.meta.url), 'utf8')

// Loaded the way QML's engine sees it: a classic script whose top-level declarations are the API.
const L = new Function(
  `${SRC}\n;return { SIZES, DEFAULT_SIZE, MIN_WIDTH, emptyDoc, parseDoc, isInsert, storedPage, pageInserts, withPage, serialize, patchInsert, removeInsert, moved, widened, stepSize, placeNew, savedRev, newId };`,
)() as {
  SIZES: number[]
  DEFAULT_SIZE: Record<string, number>
  MIN_WIDTH: number
  emptyDoc(): Doc
  parseDoc(raw: unknown): { doc: Doc; ok: boolean }
  isInsert(o: unknown): boolean
  storedPage(d: Doc, page: string): unknown[]
  pageInserts(d: Doc, page: string): any[]
  withPage(d: Doc, page: string, list: unknown[]): Doc
  serialize(d: Doc): string
  patchInsert(list: unknown[], id: string, patch: object): unknown[]
  removeInsert(list: unknown[], id: string): unknown[]
  moved(from: Box, dx: number, dy: number, h: number, page: Rect): { x: number; y: number }
  widened(from: Box, dx: number, page: Rect): { x: number; w: number }
  stepSize(size: number, dir: number): number
  placeNew(page: Rect, view: Rect, boxes: { x: number; y: number; w: number; h: number }[], w: number, h: number): { x: number; y: number; w: number }
  savedRev(ini: string, docId: string): number
  newId(now: number, random: number): string
}

const ayah = (id: string, x = 0, y = 0) => ({ id, kind: 'ayah', text: 'قُلۡ هُوَ ٱللَّهُ أَحَدٌ ١', ref: '112:1-1', x, y, w: 800, size: 44 })

test('layer.js parses as an ES2017 classic script with no host APIs', () => {
  expect(() => parse(SRC, { ecmaVersion: 2017, sourceType: 'script' })).not.toThrow()
  for (const g of ['require(', 'process.', 'Bun.', 'console.', 'import ', 'export ', 'async ', 'await ']) {
    expect(SRC.includes(g)).toBe(false)
  }
})

describe('stored values', () => {
  test('an absent value is an empty layer; an unreadable one is flagged, never thrown', () => {
    for (const raw of [undefined, null, '']) expect(L.parseDoc(raw)).toEqual({ doc: L.emptyDoc(), ok: true })
    for (const raw of ['{', 'null', '[]', '{"pages":[]}', '{"v":1}', '"x"', '42', '{"pages":null}']) {
      expect(L.parseDoc(raw).ok).toBe(false)
    }
    const good = L.parseDoc('{"rev":7,"v":1,"pages":{"p":[]}}')
    expect(good).toEqual({ doc: { rev: 7, v: 1, pages: { p: [] } }, ok: true })
    expect(L.parseDoc('{"pages":{}}').doc.rev).toBe(0)
  })

  test('only well-formed inserts are drawn; the stored list keeps the rest', () => {
    const junk = [null, 3, { id: '' }, { ...ayah('a'), kind: 'tafsir' }, { ...ayah('b'), w: 0 }, { ...ayah('c'), x: Infinity }]
    const doc = { rev: 1, v: 1, pages: { p: [ayah('ok'), ...junk] } }
    expect(L.pageInserts(doc, 'p').map((o) => o.id)).toEqual(['ok'])
    expect(L.storedPage(doc, 'p')).toHaveLength(7)
    expect(L.storedPage(doc, 'other')).toEqual([])
    expect(L.storedPage({ rev: 0, v: 1, pages: { p: 'x' as any } }, 'p')).toEqual([])
  })

  test('writing a page bumps rev, keeps every other page, drops an emptied page, and copies', () => {
    const other = [ayah('o')]
    const doc = { rev: 4, v: 1, pages: { p: [ayah('a')], q: other } }
    const next = L.withPage(doc, 'p', [ayah('a'), ayah('b')])
    expect(next.rev).toBe(5)
    expect(next.pages.q).toBe(other)
    expect(next.pages.p).toHaveLength(2)
    expect(doc.pages.p).toHaveLength(1)
    const emptied = L.withPage(next, 'p', [])
    expect(Object.keys(emptied.pages)).toEqual(['q'])
    expect(L.serialize(emptied).startsWith('{"rev":6,')).toBe(true)
  })

  test('edits touch the target only and keep unreadable entries in place', () => {
    const list = [ayah('a'), null, { junk: true }, ayah('b')]
    const patched = L.patchInsert(list, 'b', { x: 5, size: 50 })
    expect(patched[0]).toBe(list[0])
    expect(patched[1]).toBe(null)
    expect(patched[2]).toBe(list[2])
    expect(patched[3]).toEqual({ ...ayah('b'), x: 5, size: 50 })
    expect(list[3]).toEqual(ayah('b'))
    expect(L.removeInsert(list, 'a')).toEqual([null, { junk: true }, ayah('b')])
  })

  test('ids differ for different times and draws', () => {
    const ids = new Set<string>()
    for (let t = 0; t < 50; t++) for (const r of [0, 0.25, 0.5, 0.999]) ids.add(L.newId(1760000000000 + t, r))
    expect(ids.size).toBe(200)
  })
})

// QSettings' INI escaping for a string value: backslash and quote escaped, whole value quoted when
// it holds a comma, semicolon or equals sign (qsettings.cpp, iniEscapedString).
const iniValue = (s: string) => {
  const e = s.replace(/[\\"]/g, (c) => `\\${c}`)
  return /[,;=]/.test(s) ? `"${e}"` : e
}

describe('finding a write in the saved file', () => {
  const id = '0f6a2b54-abf7-4f46-8787-a9b9935d7a58'
  test('reads the rev of the document\'s own line', () => {
    const doc = L.withPage({ rev: 11, v: 1, pages: {} }, 'p', [ayah('a')])
    const ini = `[layer]\n0aaa=${iniValue(L.serialize({ rev: 99, v: 1, pages: { p: [] } }))}\n${id}=${iniValue(L.serialize(doc))}\n`
    expect(L.savedRev(ini, id)).toBe(12)
    expect(L.savedRev(ini, '0aaa')).toBe(99)
    expect(L.savedRev(ini, 'missing')).toBe(-1)
    expect(L.savedRev('', id)).toBe(-1)
    expect(L.savedRev(`${id}=${iniValue(L.serialize(doc))}`, id)).toBe(12) // a line at the very start
  })
  test('matches the format the tablet wrote', () => {
    // As written by xochitl's QSettings (Qt 6.8.2) for the first test insert, 2026-10-19.
    const ini = '[layer]\n' + id + '="{\\"rev\\":1,\\"v\\":1,\\"pages\\":{\\"53f6db17-26ca-4162-b269-3d0e908b49cb\\":[{\\"id\\":\\"mvei94o8-627k\\",\\"kind\\":\\"ayah\\",\\"text\\":\\"قُلۡ هُوَ ٱللَّهُ أَحَدٌ ١\\",\\"ref\\":\\"112:1-1\\",\\"x\\":-751,\\"y\\":172,\\"w\\":1501,\\"size\\":44}]}}"\n'
    expect(L.savedRev(ini, id)).toBe(1)
    expect(L.savedRev(ini, id.slice(1))).toBe(-1) // a document id is matched whole
  })
})

function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
}

describe('dragging', () => {
  const r = random(19)
  const between = (lo: number, hi: number) => lo + r() * (hi - lo)
  const page = () => ({ x: between(-1000, 0), y: between(-50, 50), width: between(800, 2000), height: between(1500, 3000) })

  test('a move follows the drag exactly while the box stays on the page, and never leaves it', () => {
    let exact = 0
    for (let n = 0; n < 4000; n++) {
      const p = page()
      const from = { x: between(p.x, p.x + p.width - 200), y: between(p.y, p.y + p.height - 100), w: between(200, p.width) }
      const h = between(40, 400)
      const dx = between(-1500, 1500), dy = between(-2000, 2000)
      const m = L.moved(from, dx, dy, h, p)
      expect(m.x).toBeGreaterThanOrEqual(p.x - 1e-9)
      expect(m.y).toBeGreaterThanOrEqual(p.y - 1e-9)
      if (from.w <= p.width) expect(m.x + from.w).toBeLessThanOrEqual(p.x + p.width + 1e-9)
      if (h <= p.height) expect(m.y + h).toBeLessThanOrEqual(p.y + p.height + 1e-9)
      const tx = from.x + dx, ty = from.y + dy
      if (tx >= p.x && tx + from.w <= p.x + p.width && ty >= p.y && ty + h <= p.y + p.height) {
        expect(m).toEqual({ x: tx, y: ty })
        exact++
      }
    }
    expect(exact).toBeGreaterThan(300)
  })

  test('the width handle moves the left edge only, down to the minimum width and the page edge', () => {
    for (let n = 0; n < 4000; n++) {
      const p = page()
      const from = { x: between(p.x, p.x + p.width - 200), y: 0, w: 0 }
      from.w = between(L.MIN_WIDTH, p.x + p.width - from.x)
      const dx = between(-2000, 2000)
      const m = L.widened(from, dx, p)
      expect(m.x + m.w).toBeCloseTo(from.x + from.w, 9) // the right edge stays
      expect(m.w).toBeGreaterThanOrEqual(L.MIN_WIDTH - 1e-9)
      expect(m.x).toBeGreaterThanOrEqual(p.x - 1e-9)
      const want = from.x + dx
      if (want >= p.x && from.x + from.w - want >= L.MIN_WIDTH) expect(m.x).toBeCloseTo(want, 9)
    }
  })

  test('sizes step through the list and stop at its ends', () => {
    const S = L.SIZES
    expect([...S].sort((a, b) => a - b)).toEqual(S)
    for (const k of Object.values(L.DEFAULT_SIZE)) expect(S).toContain(k)
    for (let i = 0; i < S.length; i++) {
      expect(L.stepSize(S[i], 1)).toBe(S[Math.min(i + 1, S.length - 1)])
      expect(L.stepSize(S[i], -1)).toBe(S[Math.max(i - 1, 0)])
    }
    expect(L.stepSize(45, 1)).toBe(50) // a size between steps goes to the next one
    expect(L.stepSize(45, -1)).toBe(44)
  })
})

describe('where a new insert goes', () => {
  const pageR = { x: -810, y: 0, width: 1620, height: 2160 }
  const view = { x: -810, y: 140, width: 1620, height: 1880 }

  test('centred on the page in view, near its top, when nothing is there', () => {
    const at = L.placeNew(pageR, view, [], 1296, 132)
    expect(at).toEqual({ x: -648, y: 140, w: 1296 })
  })

  test('under the lowest content in view when there is room, else at the top', () => {
    const typed = { x: -576, y: 234, w: 1152, h: 485 }
    expect(L.placeNew(pageR, view, [typed], 1296, 132).y).toBe(234 + 485 + 24)
    const below = { x: 0, y: 900, w: 300, h: 100 }
    expect(L.placeNew(pageR, view, [typed, below], 1296, 132).y).toBe(1024)
    const full = { x: -800, y: 150, w: 1600, h: 1800 }
    expect(L.placeNew(pageR, view, [full], 1296, 132).y).toBe(140)
    const offscreen = { x: -800, y: 2500, w: 1600, h: 100 }
    expect(L.placeNew(pageR, view, [offscreen], 1296, 132).y).toBe(140)
  })

  test('always on the page and no wider than the part in view', () => {
    const r = random(5)
    for (let n = 0; n < 3000; n++) {
      const p = { x: -900 + r() * 400, y: r() * 50, width: 900 + r() * 1200, height: 1500 + r() * 1500 }
      const v = { x: p.x + (r() - 0.3) * 600, y: p.y + (r() - 0.2) * 800, width: 600 + r() * 1400, height: 800 + r() * 1500 }
      const boxes = Array.from({ length: Math.floor(r() * 4) }, () => ({ x: p.x + r() * 500, y: p.y + r() * 2000, w: 200 + r() * 600, h: 50 + r() * 400 }))
      const h = 60 + r() * 300
      const at = L.placeNew(p, v, boxes, 0.8 * p.width, h)
      const seen = Math.min(p.x + p.width, v.x + v.width) - Math.max(p.x, v.x)
      expect(at.w).toBeLessThanOrEqual(Math.max(L.MIN_WIDTH, seen) + 1e-9)
      expect(at.x).toBeGreaterThanOrEqual(p.x - 1e-9)
      if (at.w <= p.width) expect(at.x + at.w).toBeLessThanOrEqual(p.x + p.width + 1)
      expect(at.y).toBeGreaterThanOrEqual(p.y - 1e-9)
      expect(at.y + h).toBeLessThanOrEqual(p.y + p.height + 1)
    }
  })
})
