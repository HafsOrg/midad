import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'acorn'
import { build } from '../../src/hadith/build.ts'

// The core must stay loadable by QML's JS engine: ES2017 syntax, no module
// syntax, and no host globals beyond the language built-ins.
test('dist hadith-search.js parses as an ES2017 classic script', () => {
  build()
  const src = readFileSync(new URL('../../dist/device/ayah-toolbar/qml/hadith-search.js', import.meta.url), 'utf8')
  expect(() => parse(src, { ecmaVersion: 2017, sourceType: 'script' })).not.toThrow()
})

test('hadith core uses no host APIs', () => {
  const core = readFileSync(new URL('../../src/search/hadith-core.js', import.meta.url), 'utf8')
  for (const g of ['require(', 'process.', 'Buffer', 'Bun.', 'window.', 'document.', 'console.', 'import ', 'export ', 'async ', 'await ']) {
    expect(core.includes(g)).toBe(false)
  }
})
