// Rewrites the favicon and the PNG app icons in public/ from the mark in src/shell/logo-mark.ts.
// Run by hand after changing the mark (`pnpm --filter @ostraka/web icons`) and commit the result:
// the build never runs it.
import { writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'
import { markSvg } from '../src/shell/logo-mark.ts'

const PUBLIC = new URL('../public/', import.meta.url)

const PNGS = [
  { file: 'icon-192.png', shape: 'rounded', size: 192 },
  { file: 'icon-512.png', shape: 'rounded', size: 512 },
  { file: 'icon-maskable-512.png', shape: 'square', size: 512 },
  { file: 'apple-touch-icon.png', shape: 'square', size: 180 },
] as const

await writeFile(new URL('favicon.svg', PUBLIC), markSvg('rounded'))
console.log('public/favicon.svg')

for (const { file, shape, size } of PNGS) {
  const png = new Resvg(markSvg(shape), { fitTo: { mode: 'width', value: size } }).render().asPng()
  await writeFile(new URL(file, PUBLIC), png)
  console.log(`public/${file} (${size}×${size})`)
}
