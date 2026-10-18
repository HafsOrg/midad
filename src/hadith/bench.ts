// bun run src/hadith/bench.ts  -- per-query latency of the hadith search on the host (single thread, warm).
import { readFileSync } from 'node:fs'
import { loadHadithSearcher, sample } from '../../test/hadith/helpers.ts'

const { hadith } = loadHadithSearcher()
const dir = new URL('../../dist/device/midad/', import.meta.url)
const src = readFileSync(new URL('qml/hadith-search.js', dir), 'utf8')
const indexText = readFileSync(new URL('data/hadith-index.json', dir), 'utf8')
const lib = new Function(`${src}\n;return { createHadithSearcher: createHadithSearcher };`)()
const t0 = performance.now()
const parsed = JSON.parse(indexText)
const t1 = performance.now()
const s = lib.createHadithSearcher(parsed)
const t2 = performance.now()
console.log(`hadith-index.json ${(Buffer.byteLength(indexText) / 1024).toFixed(0)} KiB; JSON.parse ${(t1 - t0).toFixed(0)} ms; createHadithSearcher ${(t2 - t1).toFixed(0)} ms; hadith-search.js ${(src.length / 1024).toFixed(1)} KiB`)

const sets: Record<string, string[]> = {
  'snippet 3-6w (2000)': sample(hadith, false).map((x) => x.q),
  'snippet+typo (2000)': sample(hadith, true).map((x) => x.q),
  'unfiltered snippets (2000)': sample(hadith, false, false).map((x) => x.q),
  'reference (5)': ['البخاري ١', 'bukhari 1', 'مسلم ٨', 'muslim 2564', 'muslim 8a'],
  'worst: frequent words': ['رسول الله صلى الله عليه', 'قال رسول الله', 'عن النبي صلى الله عليه وسلم قال'],
}
for (const [name, qs] of Object.entries(sets)) {
  for (const q of qs.slice(0, 50)) s.search(q, 10)
  const ts: number[] = []
  for (const q of qs) { const a = performance.now(); s.search(q, 10); ts.push(performance.now() - a) }
  ts.sort((x, y) => x - y)
  const pct = (p: number) => ts[Math.min(ts.length - 1, Math.floor(p * ts.length))]
  console.log(`${name.padEnd(28)} p50 ${pct(0.5).toFixed(2)} ms  p95 ${pct(0.95).toFixed(2)} ms  max ${ts[ts.length - 1].toFixed(2)} ms`)
}
