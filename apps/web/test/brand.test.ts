import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { bannerSvg } from '../scripts/banner.ts'

// The README banner is drawn from the mark and the tagline by `pnpm --filter @ostraka/web brand`.
const DOCS = new URL('../../../docs/brand/', import.meta.url)

describe('README banner', () => {
  it.each(['light', 'dark'] as const)('is current in its %s version (run `pnpm --filter @ostraka/web brand`)', async (theme) => {
    expect(await readFile(new URL(`banner-${theme}.svg`, DOCS), 'utf8')).toBe(bannerSvg(theme))
  })
})
