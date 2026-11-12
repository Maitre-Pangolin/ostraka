// Rewrites everything drawn from the mark in src/shell/logo-mark.ts: the favicon and the PNG app icons
// in public/, and the README banner in docs/brand/. Run by hand after changing the mark or the banner
// (`pnpm --filter @ostraka/web brand`) and commit the result: the build never runs it.
import { mkdir, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'
import { markSvg } from '../src/shell/logo-mark.ts'
import { bannerSvg } from './banner.ts'

const PUBLIC = new URL('../public/', import.meta.url)
const DOCS = new URL('../../../docs/brand/', import.meta.url)

const PNGS = [
  { file: 'icon-192.png', shape: 'rounded', size: 192 },
  { file: 'icon-512.png', shape: 'rounded', size: 512 },
  { file: 'icon-maskable-512.png', shape: 'square', size: 512 },
  { file: 'apple-touch-icon.png', shape: 'square', size: 180 },
] as const

await writeFile(new URL('favicon.svg', PUBLIC), markSvg('rounded'))
console.log('apps/web/public/favicon.svg')

for (const { file, shape, size } of PNGS) {
  const png = new Resvg(markSvg(shape), { fitTo: { mode: 'width', value: size } }).render().asPng()
  await writeFile(new URL(file, PUBLIC), png)
  console.log(`apps/web/public/${file} (${size}×${size})`)
}

await mkdir(DOCS, { recursive: true })
for (const theme of ['light', 'dark'] as const) {
  await writeFile(new URL(`banner-${theme}.svg`, DOCS), bannerSvg(theme))
  console.log(`docs/brand/banner-${theme}.svg`)
}
