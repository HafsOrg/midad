// bun run src/search/compare/table.ts -> markdown table from out/compare/*.json
import { existsSync, readFileSync } from 'node:fs'
const rd = (f: string) => (existsSync(`out/compare/${f}`) ? JSON.parse(readFileSync(`out/compare/${f}`, 'utf8')) : null)
const cols: [string, any, any][] = [
  ['ours (full)', rd('ours.acc.json'), rd('ours.lat.json')],
  ['qse lemma+root (full C7; sample C8/C9)', rd('qse.acc.json') ?? rd('qse.s.acc.json'), rd('qse.lat.json')],
  ['qse lemma/root off (sample)', rd('qse-exact.s.acc.json'), null],
]
const classes = ['C7', 'C8', 'C9', 'C10', 'C11', 'X-root', 'X-lemma', 'X-phonetic']
console.log(['class', ...cols.map((c) => c[0]), 'ours p50/p95 ms', 'qse p50/p95 ms'].join(' | '))
for (const c of classes) {
  const cells = cols.map(([, a]) => (a?.out?.[c] ? `${(100 * a.out[c].score).toFixed(1)}% (n=${a.out[c].n})` : 'n/a'))
  const l = (x: any) => (x?.lat?.[c] ? `${x.lat[c].p50.toFixed(2)} / ${x.lat[c].p95.toFixed(2)}` : 'n/a')
  console.log([c, ...cells, l(cols[0][2]), l(cols[1][2])].join(' | '))
}
