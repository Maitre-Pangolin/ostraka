// The Markdown file type shared by Notes, Dev logs and Sketches: a YAML header the app keeps byte-for-byte, then
// a body written in one house style. No Node modules, so the web app can import it.
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify'
import { unified } from 'unified'

export type { Root as MarkdownTree, RootContent as MarkdownNode } from 'mdast'

/**
 * The house style every Markdown body is written in, by core (the app's saves, the CLI) and by the web editor's
 * serializer alike: `-` bullets and rules, `*` emphasis, `**` strong, fenced code, ATX headings, one space after
 * a list marker. Once a file is in this style, opening and saving it in the editor changes no byte.
 */
export const HOUSE_STYLE = {
  bullet: '-',
  bulletOrdered: '.',
  rule: '-',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  incrementListMarker: true,
  setext: false,
  closeAtx: false,
} as const satisfies StringifyOptions

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, HOUSE_STYLE)

/** A Markdown body written in the house style. An empty body stays empty; any other ends with one line end. */
export function formatMarkdown(body: string): string {
  if (!body.trim()) return ''
  return String(processor.processSync(body))
}

/** A Markdown body as a syntax tree (mdast, with GitHub tables, task lists and strikethrough), for rendering it. */
export function parseMarkdown(body: string) {
  return processor.parse(body)
}

export type Frontmatter = {
  /** The header exactly as in the file, delimiters and line endings included; empty when there is none. */
  header: string
  /** The YAML between the delimiters, or undefined when the file has no header. */
  yaml: string | undefined
  /** Everything after the header. */
  body: string
}

// `---` on the first line, then the YAML, then `---` on a line of its own (followed by a line end or the file's end).
const FRONTMATTER = /^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/

/** Splits a file into its YAML header and its body. A header that never closes is not one. */
export function splitFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER.exec(text)
  if (!match) return { header: '', yaml: undefined, body: text }
  return { header: match[0], yaml: match[1]!, body: text.slice(match[0].length) }
}

/** Puts a header back in front of a body, unchanged. */
export function joinFrontmatter(header: string, body: string): string {
  return header + body
}
