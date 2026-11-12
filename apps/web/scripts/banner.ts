// The README banner (docs/brand/banner-{light,dark}.svg): the app icon, "ostraka" and the tagline,
// beside one large written shard in faint clay. GitHub shows README images without web fonts, so the
// text is drawn as Geist outlines (OFL, from @fontsource/geist).
import { fileURLToPath } from 'node:url'
import { openSync, type Font } from 'fontkit'
import { markSvg } from '../src/shell/logo-mark.ts'

export const TAGLINE = 'All your work in one place'

const W = 1280
const H = 320

/** Close to the app's tokens (`background`, `foreground`, `muted-foreground`, `border`, `primary`) per theme. */
const THEMES = {
  light: { bg: '#fbf8f3', fg: '#2a1f19', muted: '#7a6a5f', line: '#e6ded3', clay: '#b5532f', clayOpacity: 0.13 },
  dark: { bg: '#1f1915', fg: '#efe9e1', muted: '#a99c90', line: '#3a312b', clay: '#d27a55', clayOpacity: 0.18 },
} as const

export type BannerTheme = keyof typeof THEMES

/** A shard covered in lines of scratched writing, on the mark's 32-unit grid. */
const SHARD = {
  body: 'M4.5 11Q16 4.5 28 9L27 14.5L29 19L25 25.5L19.5 24.5L15 28L9.5 25L5.5 26L6.5 19.5L3.5 15.5Z',
  writing: 'M8.5 12.8L14 12.3M16 12.1L24.5 11.6M7.6 16.4L19.6 15.9M21.6 15.8L25.4 15.7M8.6 20.2L13 20M15 20L22.4 19.8M10.6 23.6L16.4 23.6',
}

function font(weight: 400 | 600): Font {
  const path = fileURLToPath(import.meta.resolve(`@fontsource/geist/files/geist-latin-${weight}-normal.woff2`))
  const f = openSync(path)
  if (!('layout' in f)) throw new Error(`${path} is a font collection`)
  return f
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** `text` as glyph outlines with its baseline starting at (x, y); `tracking` is in em. */
function outline(f: Font, text: string, size: number, x: number, y: number, fill: string, tracking = 0): string {
  const run = f.layout(text)
  let pen = 0
  let glyphs = ''
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.toSVG()
    if (d) glyphs += `<path transform="translate(${round(pen)} 0)" d="${d}"/>`
    pen += run.positions[i]!.xAdvance + tracking * f.unitsPerEm
  })
  const s = round(size / f.unitsPerEm)
  return `<g fill="${fill}" transform="translate(${x} ${y}) scale(${s} ${-s})">${glyphs}</g>`
}

export function bannerSvg(theme: BannerTheme): string {
  const t = THEMES[theme]
  const icon = markSvg('rounded').replace(/^<svg[^>]*>|<\/svg>\n$/g, '')
  const shard =
    `<g transform="translate(1050 165) rotate(-6) scale(16.875) translate(-16 -16)">` +
    `<path d="${SHARD.body}" fill="${t.clay}" fill-opacity="${t.clayOpacity}"/>` +
    `<path d="${SHARD.writing}" fill="none" stroke="${t.bg}" stroke-width="1.6" stroke-linecap="round"/></g>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ostraka: ${TAGLINE}">` +
    `<clipPath id="frame"><rect width="${W}" height="${H}" rx="16"/></clipPath>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.bg}" stroke="${t.line}"/>` +
    `<g clip-path="url(#frame)">${shard}</g>` +
    `<g transform="translate(88 102) scale(3.5)">${icon}</g>` +
    outline(font(600), 'ostraka', 104, 232, 178.8, t.fg, -0.035) +
    outline(font(400), TAGLINE, 26, 236, 228.2, t.muted) +
    `</svg>\n`
  )
}
