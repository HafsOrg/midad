// Seeded query generators shared by the eval tests and the engine comparison,
// so both score exactly the same queries.
import { rng, type Ayah } from './helpers.ts'

export const SEED = 42

export function snippet(a: Ayah, r: () => number): string {
  const n = Math.min(a.words.length, 3 + Math.floor(r() * 3))
  const start = Math.floor(r() * (a.words.length - n + 1))
  return a.words.slice(start, start + n).join(' ')
}

const LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'
export function mutate(s: string, r: () => number): string {
  const edits = 1 + Math.floor(r() * 2)
  const c = [...s]
  for (let e = 0; e < edits; e++) {
    const i = Math.floor(r() * c.length)
    const op = Math.floor(r() * 4)
    if (op === 0) c[i] = LETTERS[Math.floor(r() * LETTERS.length)] // substitute
    else if (op === 1) c.splice(i, 1) // delete
    else if (op === 2) c.splice(i, 0, LETTERS[Math.floor(r() * LETTERS.length)]) // insert
    else if (i + 1 < c.length) [c[i], c[i + 1]] = [c[i + 1], c[i]] // transpose
  }
  return c.join('')
}

export type Sample = { source: Ayah; q: string }

/** The seeded 2000-query samples behind C8 (typo=false) and C9 (typo=true). */
export function sample(corpus: Ayah[], typo: boolean, n = 2000): Sample[] {
  const r = rng(SEED)
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const source = corpus[Math.floor(r() * corpus.length)]
    const s = snippet(source, r)
    out.push({ source, q: typo ? mutate(s, r) : s })
  }
  return out
}
