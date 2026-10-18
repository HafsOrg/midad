// bun run src/search/bench.ts  -- per-query latency on the host (single thread, warm).
import { readFileSync } from 'node:fs'
import { loadCorpus, rng } from '../../test/search/helpers.ts'
import { IMLAI_FIXTURE } from '../../test/search/imlai-fixture.ts'

const dir = new URL('../../dist/search/', import.meta.url)
const src = readFileSync(new URL('search.js', dir), 'utf8')
const indexText = readFileSync(new URL('index.json', dir), 'utf8')
const lib = new Function(`${src}\n;return { createSearcher: createSearcher };`)()
const t0 = performance.now()
const parsed = JSON.parse(indexText)
const t1 = performance.now()
const s = lib.createSearcher(parsed)
const t2 = performance.now()
console.log(`index.json ${(Buffer.byteLength(indexText) / 1024).toFixed(0)} KiB (gzip n/a); JSON.parse ${(t1 - t0).toFixed(1)} ms; createSearcher ${(t2 - t1).toFixed(1)} ms; search.js ${(src.length / 1024).toFixed(1)} KiB`)

const corpus = loadCorpus()
const r = rng(7)
const snip = () => {
  const a = corpus[Math.floor(r() * corpus.length)]
  const n = Math.min(a.words.length, 3 + Math.floor(r() * 3))
  const st = Math.floor(r() * (a.words.length - n + 1))
  return a.words.slice(st, st + n).join(' ')
}
const typo = (q: string) => { const c = [...q]; const i = Math.floor(r() * c.length); c.splice(i, 1); return c.join('') }
const sets: Record<string, string[]> = {
  'snippet 3-5w (2000)': Array.from({ length: 2000 }, snip),
  'snippet+typo (2000)': Array.from({ length: 2000 }, () => typo(snip())),
  'imlai fixture (42)': IMLAI_FIXTURE.map((f) => f.q),
  'full ayah (all 6236)': corpus.map((a) => a.text),
  'reference (5)': ['2:255', 'البقرة ٢٥٥', 'البقرة 255', 'baqarah 255', '2:1-5'],
  'worst: longest ayah 2:282': [corpus.find((a) => a.key === '2:282')!.text],
}
for (const [name, qs] of Object.entries(sets)) {
  for (const q of qs.slice(0, 50)) s.search(q, 10) // warm
  const ts: number[] = []
  for (const q of qs) { const a = performance.now(); s.search(q, 10); ts.push(performance.now() - a) }
  ts.sort((x, y) => x - y)
  const pct = (p: number) => ts[Math.min(ts.length - 1, Math.floor(p * ts.length))]
  console.log(`${name.padEnd(28)} p50 ${pct(0.5).toFixed(2)} ms  p95 ${pct(0.95).toFixed(2)} ms  max ${ts[ts.length - 1].toFixed(2)} ms`)
}
