// The Markdown kinds (Notes, Dev logs, Sketches) on disk: `<folder>/<id>.md`, a YAML header then a body. Each kind
// brings the Zod schema of its header. Files are read leniently (a broken header is reported, never hidden) and
// written strictly: under the file's lock, refused if it changed since it was loaded, the header kept byte-for-byte
// unless a field is set, the body in the house style, and nothing written when nothing changed.
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { isMap, isScalar, parseDocument, stringify } from 'yaml'
import { z } from 'zod'
import { contentPath, type ContentKind } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { assertCurrentVersion, contentVersion } from './content-version.ts'
import { withFileLock, writeFileAtomic, type LockOptions } from './locked-file.ts'
import { formatMarkdown, splitFrontmatter } from './markdown.ts'

export type MarkdownKind = Extract<ContentKind, 'notes' | 'devlogs' | 'sketches'>

export type MarkdownFileOptions = ContentRootOptions & { lock?: LockOptions }

/** For a change made from a loaded copy: the `version` of that copy. */
export type MarkdownChangeOptions = MarkdownFileOptions & { ifVersion?: string }

/** A file whose header reads and matches its kind's schema. `version` is a hash of the whole file. */
export type MarkdownFile<H> = { id: string; version: string; modifiedAt: string; header: H; body: string }

/** A file whose header is missing, isn't YAML or doesn't match its kind's schema, with the reason. */
export type BrokenMarkdownFile = { id: string; version: string; modifiedAt: string; error: string }

/** What a write changes: header fields to set (written in flow style, one line each), the body, or both. */
export type MarkdownChange = { header?: Record<string, unknown>; body?: string }

export class MarkdownFileNotFoundError extends Error {}
export class MarkdownFileExistsError extends Error {}
/** The file's header is broken, or a change would break it: it is refused, never written. */
export class MarkdownFileError extends Error {}

export const isBrokenFile = <H>(file: MarkdownFile<H> | BrokenMarkdownFile): file is BrokenMarkdownFile => 'error' in file

/** An id names one file in the kind's folder: no path separators, not hidden. */
const isFileId = (id: string) => /^[^/\\.][^/\\]*$/.test(id) && !id.endsWith('.md')

/** `key: value` for a header line: arrays and objects in flow style (`tags: [a, b]`). */
const headerLine = (key: string, value: unknown) =>
  `${stringify(key).trimEnd()}: ${stringify(value, { collectionStyle: 'flow', flowCollectionPadding: false, lineWidth: 0 }).trimEnd()}`

/** Sets fields in a YAML header's text, replacing only the lines that hold them; everything else stays as is. */
function setHeaderFields(yaml: string, fields: Record<string, unknown>, eol: string): string {
  let text = yaml
  for (const [key, value] of Object.entries(fields)) {
    const line = headerLine(key, value).replaceAll('\n', eol)
    const doc = parseDocument(text)
    const pair = isMap(doc.contents) ? doc.contents.items.find((item) => isScalar(item.key) && item.key.value === key) : undefined
    const start = isScalar(pair?.key) ? pair.key.range?.[0] : undefined
    const end = (pair?.value as { range?: [number, number, number] } | null | undefined)?.range?.[1]
    // A block value's range takes in its last line end; a flow value's stops at the value, before any comment.
    const lineEnd = start !== undefined && end !== undefined ? (/\r?\n$/.exec(text.slice(start, end))?.[0] ?? '') : ''
    if (start !== undefined && end !== undefined) text = text.slice(0, start) + line + lineEnd + text.slice(end)
    else text = `${text}${text && !text.endsWith('\n') ? eol : ''}${line}${eol}`
  }
  return text
}

/** The file's text in parts: the header as written, the blank lines after it, and the body. */
function parts(text: string) {
  const { header, yaml, body } = splitFrontmatter(text)
  const gap = /^(?:\r?\n)*/.exec(body)![0]
  return { header, yaml, gap, body: body.slice(gap.length) }
}

/** Reads a header against its schema, or says why it can't be. */
function readHeader<H>(yaml: string | undefined, schema: z.ZodType<H>): { header: H } | { error: string } {
  if (yaml === undefined) return { error: 'No YAML header: the file must start with a --- line, the header, then another --- line.' }
  const doc = parseDocument(yaml)
  if (doc.errors.length) return { error: `Broken YAML header: ${doc.errors[0]!.message.split('\n')[0]}` }
  const result = schema.safeParse(doc.toJS() ?? {})
  if (!result.success) return { error: `Invalid header: ${z.prettifyError(result.error).replaceAll('\n', ' ')}` }
  return { header: result.data }
}

/** The files of one Markdown kind, read and written through its header schema. */
export function markdownFiles<H>(kind: MarkdownKind, schema: z.ZodType<H>) {
  const folder = (options: MarkdownFileOptions) => contentPath(kind, options)

  async function fileOf(id: string, options: MarkdownFileOptions): Promise<string> {
    if (!isFileId(id)) throw new MarkdownFileNotFoundError(`No ${kind}/${id}.md`)
    return join(await folder(options), `${id}.md`)
  }

  function parse(id: string, text: string, modifiedAt: Date): MarkdownFile<H> | BrokenMarkdownFile {
    const { yaml, body } = parts(text)
    const meta = { id, version: contentVersion(text), modifiedAt: modifiedAt.toISOString() }
    const header = readHeader(yaml, schema)
    return 'error' in header ? { ...meta, error: header.error } : { ...meta, header: header.header, body }
  }

  async function readText(file: string, id: string): Promise<{ text: string; modifiedAt: Date }> {
    try {
      const [text, stats] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      return { text, modifiedAt: stats.mtime }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MarkdownFileNotFoundError(`No ${kind}/${id}.md`)
      throw error
    }
  }

  return {
    /** Every file of the kind, broken ones included, most recently changed first. */
    async list(options: MarkdownFileOptions = {}): Promise<(MarkdownFile<H> | BrokenMarkdownFile)[]> {
      const dir = await folder(options)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const ids = names.filter((name) => extname(name) === '.md' && !name.startsWith('.')).map((name) => basename(name, '.md'))
      const files = await Promise.all(
        ids.map(async (id) => {
          try {
            const { text, modifiedAt } = await readText(join(dir, `${id}.md`), id)
            return parse(id, text, modifiedAt)
          } catch (error) {
            if (error instanceof MarkdownFileNotFoundError) return undefined // Removed while listing.
            throw error
          }
        }),
      )
      return files
        .filter((file) => file !== undefined)
        .toSorted((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id))
    },

    /** One file, or why its header can't be read. */
    async read(id: string, options: MarkdownFileOptions = {}): Promise<MarkdownFile<H> | BrokenMarkdownFile> {
      const { text, modifiedAt } = await readText(await fileOf(id, options), id)
      return parse(id, text, modifiedAt)
    },

    /** Writes a new file: the header fields given, one line each, then the body in house style. Never overwrites. */
    async create(id: string, { header = {}, body = '' }: MarkdownChange, options: MarkdownFileOptions = {}): Promise<MarkdownFile<H>> {
      const file = await fileOf(id, options)
      await mkdir(dirname(file), { recursive: true })
      const formatted = formatMarkdown(body)
      const text = `---\n${setHeaderFields('', header, '\n')}---\n${formatted && `\n${formatted}`}`
      return withFileLock(
        file,
        async () => {
          const created = parse(id, text, new Date())
          if (isBrokenFile(created)) throw new MarkdownFileError(`Refusing to write ${kind}/${id}.md: ${created.error}`)
          const exists = await stat(file).then(
            () => true,
            () => false,
          )
          if (exists) throw new MarkdownFileExistsError(`${kind}/${id}.md already exists`)
          await writeFileAtomic(file, text)
          return { ...created, modifiedAt: (await stat(file)).mtime.toISOString() }
        },
        options.lock,
      )
    },

    /**
     * Changes a file under its lock: refused if it changed since `ifVersion` or its header is broken. The header
     * stays byte-for-byte except for the fields set; the body is written in house style. When the result is the
     * file as it is, nothing is written.
     */
    async update(id: string, change: MarkdownChange, options: MarkdownChangeOptions = {}): Promise<MarkdownFile<H>> {
      const file = await fileOf(id, options)
      return withFileLock(
        file,
        async () => {
          const { text, modifiedAt } = await readText(file, id)
          assertCurrentVersion(options.ifVersion, contentVersion(text), `${kind}/${id}.md`)
          const current = parse(id, text, modifiedAt)
          if (isBrokenFile(current)) throw new MarkdownFileError(`${kind}/${id}.md has a broken header; fix it first. ${current.error}`)
          const { header, yaml, gap, body } = parts(text)
          const eol = header.includes('\r\n') ? '\r\n' : '\n'
          const yamlStart = header.indexOf('\n') + 1
          const nextHeader = change.header
            ? header.slice(0, yamlStart) + setHeaderFields(yaml!, change.header, eol) + header.slice(yamlStart + yaml!.length)
            : header
          const nextBody = change.body === undefined ? body : formatMarkdown(change.body)
          // The blank lines between header and body stay as they are; a first body gets one.
          const separator = nextBody ? (body ? gap : gap || eol) : body ? '' : gap
          const next = nextHeader + separator + nextBody
          if (next === text) return current
          const written = parse(id, next, new Date())
          if (isBrokenFile(written)) throw new MarkdownFileError(`Refusing to write ${kind}/${id}.md: ${written.error}`)
          await writeFileAtomic(file, next)
          return { ...written, modifiedAt: (await stat(file)).mtime.toISOString() }
        },
        options.lock,
      )
    },
  }
}
