// Thin wrapper over the vendored quran-png composer. Same code path as
// apps/api/server.mjs: parseOptions -> resolveRange -> compose -> toPNG.
// @ts-nocheck (vendor is untyped .mjs)
import { parseOptions, parseRange } from '../../vendor/quran-png/apps/api/params.mjs'
import { compose, resolveRange } from '../../vendor/quran-png/packages/composer/compose.mjs'
import { toPNG } from '../../vendor/quran-png/packages/composer/render.mjs'
import { loadIndex } from '../../vendor/quran-png/packages/composer/store.mjs'

export { loadIndex, parseRange }

export const DEFAULT_PNG_WIDTH = 1600

export async function renderRange(
  surah: number,
  from: number,
  to: number,
  opts: { width?: number; query?: Record<string, string> } = {},
): Promise<{ svg: string; png: (width?: number) => Buffer; width: number; height: number }> {
  const q: Record<string, string> = { ...(opts.query ?? {}) }
  if (opts.width) q.width = String(opts.width)
  const options = parseOptions({ ...q, format: 'svg' }, { surah, from, to })
  await resolveRange(options)
  const result = await compose(options)
  return {
    svg: result.svg,
    width: result.width,
    height: result.height,
    png: (w = opts.width ?? DEFAULT_PNG_WIDTH) => toPNG(result.svg, { width: w }),
  }
}
