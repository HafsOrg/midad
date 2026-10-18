// bun run src/search/compare/run.ts <engine> [acc|lat]
//   engines: ours | qse | qse-exact   (qse = lemma+root on, qse-exact = lemma/root off; fuzzy+phonetic on in both)
//   acc: accuracy on the shared eval queries -> out/compare/<engine>.acc.json
//   lat: per-query latency on a 200-query subset of each class, run alone -> out/compare/<engine>.lat.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadCorpus } from '../../../test/search/helpers.ts'
import { sample } from '../../../test/search/queries.ts'
import { IMLAI_FIXTURE } from '../../../test/search/imlai-fixture.ts'
import { EXTRAS, judgeFold } from '../../../test/search/extras-fixture.ts'
import { oursEngine, qseEngine, type Engine } from './adapters.ts'

const [which, mode = 'acc'] = process.argv.slice(2)
const corpus = loadCorpus()
const byKey = new Map(corpus.map((a) => [a.key, a]))
const folded = new Map(corpus.map((a) => [a.key, judgeFold(a.text)]))

let engine: Engine
let load: unknown = null
if (which === 'ours') engine = oursEngine()
else {
  const r = await qseEngine({ lemma: which === 'qse', root: which === 'qse', name: which })
  engine = r.engine
  load = r.load
}

const sameText = (k: string, src: string) => k === src || byKey.get(k)?.text === byKey.get(src)?.text
const C11: [string, string[]][] = [
  ['2:255', ['2:255']],
  ['البقرة ٢٥٥', ['2:255']],
  ['البقرة 255', ['2:255']],
  ['baqarah 255', ['2:255']],
  ['2:1-5', ['2:1', '2:2', '2:3', '2:4', '2:5']],
]

type Query = { cls: string; q: string }
const classes: Record<string, { q: string; hit: (top: string[]) => number }[]> = {
  C7: corpus.map((a) => ({ q: a.text, hit: (t) => (t[0] && sameText(t[0], a.key) ? 1 : 0) })),
  C8: sample(corpus, false).map(({ source, q }) => ({ q, hit: (t) => (t.slice(0, 5).some((k) => sameText(k, source.key)) ? 1 : 0) })),
  C9: sample(corpus, true).map(({ source, q }) => ({ q, hit: (t) => (t.slice(0, 5).some((k) => sameText(k, source.key)) ? 1 : 0) })),
  C10: IMLAI_FIXTURE.map((f) => ({ q: f.q, hit: (t) => (t[0] && sameText(t[0], f.expect) ? 1 : 0) })),
  C11: C11.map(([q, exp]) => ({ q, hit: (t) => (exp.every((k, i) => t[i] === k) ? 1 : 0) })),
  // extras: precision@5 over relevant ayat (empty result slots count as irrelevant)
  'X-root': EXTRAS.filter((e) => e.kind === 'root').map((e) => ({ q: e.q, hit: (t) => t.slice(0, 5).filter((k) => e.ok(folded.get(k)!)).length / 5 })),
  'X-lemma': EXTRAS.filter((e) => e.kind === 'lemma').map((e) => ({ q: e.q, hit: (t) => t.slice(0, 5).filter((k) => e.ok(folded.get(k)!)).length / 5 })),
  'X-phonetic': EXTRAS.filter((e) => e.kind === 'phonetic').map((e) => ({ q: e.q, hit: (t) => t.slice(0, 5).filter((k) => e.ok(folded.get(k)!)).length / 5 })),
}

// QSAMPLE=1: QSE needs ~0.5 s per long query, so the full suites take hours; score a deterministic subset instead.
if (process.env.QSAMPLE) {
  classes.C7 = classes.C7.filter((_, i) => i % 10 === 0)
  classes.C8 = classes.C8.slice(0, 500)
  classes.C9 = classes.C9.slice(0, 500)
}
const SUF = process.env.QSAMPLE ? '.s' : ''
mkdirSync('out/compare', { recursive: true })
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

if (mode === 'acc') {
  const out: Record<string, { n: number; score: number; failures: string[] }> = {}
  for (const [cls, qs] of Object.entries(classes)) {
    let sum = 0
    const failures: string[] = []
    const t0 = performance.now()
    for (const { q, hit } of qs) {
      const top = engine.search(q, 5)
      const h = hit(top)
      sum += h
      if (h < 1 && failures.length < 15) failures.push(`${q} -> ${top.slice(0, 5).join(',')}`)
    }
    out[cls] = { n: qs.length, score: sum / qs.length, failures }
    console.error(`${which} ${cls}: ${(100 * sum / qs.length).toFixed(2)}% of ${qs.length} (${((performance.now() - t0) / 1000).toFixed(0)}s)`)
  }
  writeFileSync(`out/compare/${which}${SUF}.acc.json`, JSON.stringify({ engine: which, load, out }, null, 1))
} else {
  const lat: Record<string, { n: number; p50: number; p95: number; max: number }> = {}
  for (const [cls, qs] of Object.entries(classes)) {
    const sub = qs.filter((_, i) => i % Math.max(1, Math.floor(qs.length / 200)) === 0).slice(0, 200)
    for (const { q } of sub.slice(0, 10)) engine.search(q, 5) // warm
    const ts: number[] = []
    for (const { q } of sub) { const a = performance.now(); engine.search(q, 5); ts.push(performance.now() - a) }
    lat[cls] = { n: sub.length, p50: pct(ts, 0.5), p95: pct(ts, 0.95), max: Math.max(...ts) }
    console.error(`${which} ${cls} latency p50 ${lat[cls].p50.toFixed(2)} p95 ${lat[cls].p95.toFixed(2)} ms`)
  }
  writeFileSync(`out/compare/${which}.lat.json`, JSON.stringify({ engine: which, lat }, null, 1))
}
