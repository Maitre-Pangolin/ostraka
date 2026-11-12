import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { markSvg } from '../src/shell/logo-mark.ts'

// Installable as a browser web app (own window, Dock icon): Chrome needs a standalone display, a start URL
// and 192 and 512 px icons; Safari's "Add to Dock" uses the apple-touch-icon.
const PUBLIC = new URL('../public/', import.meta.url)

type Manifest = {
  name: string
  start_url: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', PUBLIC), 'utf8')) as Manifest
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
async function pngSize(path: string): Promise<string> {
  const png = await readFile(new URL(path.replace(/^\//, ''), PUBLIC))
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
}

describe('web-app manifest', () => {
  it('opens Ostraka in its own window at the app root', () => {
    expect(manifest).toMatchObject({ name: 'Ostraka', start_url: '/', display: 'standalone' })
  })

  it.each(['192x192', '512x512'])('has a %s icon', async (size) => {
    const icon = manifest.icons.find((i) => i.sizes === size && i.type === 'image/png' && (i.purpose ?? 'any').includes('any'))
    expect(icon).toBeDefined()
    expect(await pngSize(icon!.src)).toBe(size)
  })

  it('has a maskable icon', async () => {
    const icon = manifest.icons.find((i) => i.purpose === 'maskable')
    expect(icon).toBeDefined()
    expect(await pngSize(icon!.src)).toBe(icon!.sizes)
  })

  it('has a favicon drawn from the current mark (run `pnpm --filter @ostraka/web icons` after changing it)', async () => {
    expect(await readFile(new URL('favicon.svg', PUBLIC), 'utf8')).toBe(markSvg('rounded'))
  })

  it('is linked from index.html, with an apple-touch-icon for Safari', async () => {
    expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(index).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(await pngSize('apple-touch-icon.png')).toBe('180x180')
  })
})
