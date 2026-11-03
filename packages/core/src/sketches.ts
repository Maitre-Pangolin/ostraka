// Sketches: `sketches/<id>.md`, read and written through the shared Markdown file type. The body holds one Mermaid
// block, which is what the app edits; anything else in the body is kept.
import { randomInt } from 'node:crypto'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import {
  isBrokenFile,
  markdownFiles,
  MarkdownFileError,
  MarkdownFileExistsError,
  type BrokenMarkdownFile,
  type MarkdownChangeOptions,
  type MarkdownFile,
  type MarkdownFileOptions,
} from './markdown-files.ts'
import {
  NewSketchSchema,
  SketchChangeSchema,
  SketchHeaderSchema,
  type BrokenSketch,
  type NewSketch,
  type Sketch,
  type SketchChange,
  type SketchHeader,
  type SketchListing,
} from './sketch-schema.ts'

export type SketchOptions = MarkdownFileOptions
/** For a change made from a loaded copy: the `version` of that copy. */
export type SketchChangeOptions = MarkdownChangeOptions

const sketches = markdownFiles('sketches', SketchHeaderSchema)

/** What a new Sketch starts with, so the preview has something to draw. */
export const STARTER_MERMAID = 'flowchart LR\n  start([Start]) --> done([Done])'

const NO_MERMAID = 'No Mermaid block: the body must hold a ```mermaid fenced code block.'

type MdNode = {
  type: string
  lang?: string | null
  value?: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** The body's first Mermaid code block: its text and where the whole block sits in the body. */
function mermaidBlock(body: string): { text: string; start: number; end: number } | undefined {
  const visit = (node: MdNode): MdNode | undefined =>
    node.type === 'code' && node.lang?.toLowerCase() === 'mermaid' ? node : node.children?.map(visit).find(Boolean)
  const block = visit(parser.parse(body) as MdNode)
  const start = block?.position?.start.offset
  const end = block?.position?.end.offset
  if (!block || start === undefined || end === undefined) return undefined
  return { text: block.value ?? '', start, end }
}

/** A Mermaid fence around the text, longer than any run of backticks in it. */
function mermaidFence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}mermaid\n${text.replace(/\n+$/, '')}\n${fence}`
}

function toSketch(file: MarkdownFile<SketchHeader> | BrokenMarkdownFile): Sketch | BrokenSketch {
  if (isBrokenFile(file)) return file
  const { id, version, modifiedAt, header, body } = file
  const block = mermaidBlock(body)
  if (!block) return { id, version, modifiedAt, error: NO_MERMAID }
  return { id, version, modifiedAt, title: header.title, tags: header.tags, mermaid: block.text }
}

/** Every Sketch, most recently changed first; a broken one is listed with its error. `tag` narrows to a Tag. */
export async function listSketches(options: SketchOptions & { tag?: string } = {}): Promise<SketchListing[]> {
  const listed = (await sketches.list(options)).map(toSketch)
  return listed
    .filter((sketch) => options.tag === undefined || ('tags' in sketch && sketch.tags.includes(options.tag)))
    .map((sketch) => {
      if (!('mermaid' in sketch)) return sketch
      const { mermaid: _mermaid, ...summary } = sketch
      return summary
    })
}

/** One Sketch with its Mermaid text, or why it can't be read. */
export async function readSketch(id: string, options: SketchOptions = {}): Promise<Sketch | BrokenSketch> {
  return toSketch(await sketches.read(id, options))
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newId = () => Array.from({ length: 5 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')

/** Starts a Sketch with a short random id: title and Tags in its header, a starter diagram as its Mermaid block. */
export async function createSketch(input: NewSketch, options: SketchOptions = {}): Promise<Sketch> {
  const { title, tags = [] } = NewSketchSchema.parse(input)
  for (;;) {
    try {
      return toSketch(
        await sketches.create(newId(), { header: { title, tags }, body: `${mermaidFence(STARTER_MERMAID)}\n` }, options),
      ) as Sketch
    } catch (error) {
      if (!(error instanceof MarkdownFileExistsError)) throw error
    }
  }
}

/**
 * Changes a Sketch's Mermaid text, title, Tags, or any of them. The header stays byte-for-byte but for the lines
 * set, only the Mermaid block of the body is replaced, and nothing is written when nothing changed.
 */
export async function updateSketch(id: string, input: SketchChange, options: SketchChangeOptions = {}): Promise<Sketch> {
  const { mermaid, title, tags } = SketchChangeSchema.parse(input)
  const current = await sketches.read(id, options)
  const ifVersion = options.ifVersion ?? current.version
  let body: string | undefined
  if (mermaid !== undefined && !isBrokenFile(current)) {
    const block = mermaidBlock(current.body)
    if (!block) throw new MarkdownFileError(`sketches/${id}.md has no Mermaid block; fix it first. ${NO_MERMAID}`)
    body = current.body.slice(0, block.start) + mermaidFence(mermaid) + current.body.slice(block.end)
  }
  const header = { ...(title !== undefined && { title }), ...(tags !== undefined && { tags }) }
  const written = await sketches.update(id, { body, ...(Object.keys(header).length && { header }) }, { ...options, ifVersion })
  return toSketch(written) as Sketch
}
