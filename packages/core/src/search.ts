// Search: a disposable SQLite FTS5 index built from the content files, which stay the source of truth. Notes,
// Dev logs (days and monthly summaries) and Todos (every state, Sub-todos too) are indexed in full text, Sketches by
// title and Tags. Matching ignores case and accents, takes each word as a prefix, `"a phrase"` exactly, and never
// stems. A Reference or Mention typed whole is found only as that whole token.
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ContentChange } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { isBrokenDevlog } from './devlog-schema.ts'
import { listDevlogs, readDevlog } from './devlogs.ts'
import { MarkdownFileNotFoundError } from './markdown-files.ts'
import { parseMarkdown, type MarkdownNode, type MarkdownTree } from './markdown.ts'
import { isBrokenNote } from './note-schema.ts'
import { listNotes, readNote } from './notes.ts'
import { findReferences } from './references.ts'
import { isBrokenSketch, type SketchSummary } from './sketch-schema.ts'
import { listSketches, readSketch } from './sketches.ts'
import { localDay } from './todo-order.ts'
import type { SubTodo, TodoStatus } from './todo-schema.ts'
import { listFinishedTodos, listTodos } from './todos.ts'
import { SEARCH_KINDS, type SearchHit, type SearchKind, type SearchQuery, type SnippetPiece } from './search-types.ts'

export {
  parseSearchParams,
  SEARCH_KINDS,
  SearchQuerySchema,
  searchParams,
  type SearchHit,
  type SearchKind,
  type SearchQuery,
  type SnippetPiece,
} from './search-types.ts'

export type SearchIndex = {
  /** Empties the index, then reads every content file into it. */
  rebuild(): Promise<void>
  /** Reads one change into the index: `todos.json` as a whole, or one Note, Dev log or Sketch (removed if gone). */
  refresh(change: ContentChange): Promise<void>
  /** Resolves once every rebuild and refresh asked for so far is in the index. */
  idle(): Promise<void>
  search(query: SearchQuery): SearchHit[]
  close(): void
}

/** Where the server keeps its index: in the user's cache folder, outside the content folder (never snapshotted). */
export const searchIndexPath = (homeDir = homedir()) => join(homeDir, 'Library', 'Caches', 'ostraka', 'search.db')

type Doc = {
  kind: SearchKind
  id: string
  title: string
  body: string
  day: string
  tags: string[]
  status?: TodoStatus
  parentId?: string
}

// --- Whole tokens: References and Mentions --------------------------------------------------------------------

/** A Mention: `@<person id>`, not part of an email address or a longer word. */
const MENTION = /(?<![\w@.])@[a-z0-9]+(?:-[a-z0-9]+)*(?![\w-])/gi

/**
 * References and Mentions in a text, lowercased: case is ignored, so a Jira key is recognised in any case. Each is
 * indexed as one opaque word (`r` + hex) in a column of its own, so it is found only whole.
 */
function wholeTokens(text: string): string[] {
  const references = findReferences(text.toUpperCase()).map((found) => found.token)
  const mentions = text.match(MENTION) ?? []
  return [...new Set([...references, ...mentions].map((token) => token.toLowerCase()))]
}

const tokenWord = (token: string) => `r${Buffer.from(token).toString('hex')}`

/** A query word that is one whole Reference or Mention. */
function isWholeToken(word: string): boolean {
  const [token] = wholeTokens(word)
  return token !== undefined && token === word.toLowerCase()
}

// --- Plain text -------------------------------------------------------------------------------------------------

const INLINE = new Set(['text', 'inlineCode', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'break'])

/** A Markdown body as the words a reader sees, without marks: what is indexed and what snippets show. */
function plainText(markdown: string): string {
  const visit = (node: MarkdownTree | MarkdownNode): string => {
    if ('value' in node && typeof node.value === 'string' && node.type !== 'html') return node.value
    if (node.type === 'image') return node.alt ?? ''
    if (!('children' in node)) return ''
    return node.children.map((child) => (INLINE.has(child.type) ? visit(child) : ` ${visit(child)} `)).join('')
  }
  return visit(parseMarkdown(markdown)).replace(/\s+/g, ' ').trim()
}

// --- Query ------------------------------------------------------------------------------------------------------

/** The words of a text as the index splits them: letters and digits. */
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? []

/** An FTS5 phrase of those words, quoted so nothing typed is read as query syntax. */
const phrase = (parts: string[]) => `"${parts.join(' ')}"`

/** The typed text as an FTS5 query: every term must match. Undefined when nothing searchable was typed. */
function ftsQuery(text: string): string | undefined {
  const terms: string[] = []
  for (const [, quoted, word] of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (quoted !== undefined) {
      const parts = words(quoted)
      if (parts.length) terms.push(`{title body} : ${phrase(parts)}`)
      continue
    }
    const bare = word!.replace(/^"+/, '')
    const parts = words(bare)
    if (!parts.length) continue
    // A whole Reference or Mention: its own word, plus the words it is written with, to highlight it in the text.
    if (isWholeToken(bare)) terms.push(`(refs : ${phrase([tokenWord(bare.toLowerCase())])} AND {title body} : ${phrase(parts)})`)
    else terms.push(`{title body} : ${phrase(parts)}*`)
  }
  return terms.length ? terms.join(' AND ') : undefined
}

// --- Index ------------------------------------------------------------------------------------------------------

const MARK_START = '\u{E000}'
const MARK_END = '\u{E001}'

function snippetPieces(text: string): SnippetPiece[] {
  const pieces: SnippetPiece[] = []
  for (const [, before, matched] of text.matchAll(new RegExp(`([^${MARK_START}]*)(?:${MARK_START}([^${MARK_END}]*)${MARK_END})?`, 'gu'))) {
    if (before) pieces.push({ text: before })
    if (matched) pieces.push({ text: matched, match: true })
  }
  return pieces
}

async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  // node:sqlite still warns that it is experimental when first loaded; the warning means nothing to a user.
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite is an experimental feature')) return
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    return await import('node:sqlite')
  } finally {
    process.emitWarning = emitWarning
  }
}

const SCHEMA = `
  CREATE TABLE docs (
    rowid INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    day TEXT NOT NULL,
    tags TEXT NOT NULL,
    status TEXT,
    parent_id TEXT,
    UNIQUE (kind, id)
  );
  CREATE VIRTUAL TABLE fts USING fts5(title, body, refs, tokenize = 'unicode61 remove_diacritics 2');
`

/**
 * Opens an empty index: in memory by default, or in `file`, which is removed first (the index is always rebuilt
 * from the files). Content is read through core from the content folder that `content` resolves to.
 */
export async function openSearchIndex({ file, content = {} }: { file?: string; content?: ContentRootOptions } = {}): Promise<SearchIndex> {
  const { DatabaseSync } = await loadSqlite()
  if (file) {
    await mkdir(dirname(file), { recursive: true })
    await Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(`${file}${suffix}`, { force: true })))
  }
  const db: DatabaseSync = new DatabaseSync(file ?? ':memory:')
  db.exec(SCHEMA)

  const insertDoc = db.prepare('INSERT INTO docs (kind, id, title, day, tags, status, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertText = db.prepare('INSERT INTO fts (rowid, title, body, refs) VALUES (?, ?, ?, ?)')
  const findRow = db.prepare('SELECT rowid FROM docs WHERE kind = ? AND id = ?')
  const deleteDoc = db.prepare('DELETE FROM docs WHERE rowid = ?')
  const deleteText = db.prepare('DELETE FROM fts WHERE rowid = ?')
  const rowsOfKind = db.prepare('SELECT rowid FROM docs WHERE kind = ?')

  const removeRow = (rowid: number | bigint) => {
    deleteText.run(rowid)
    deleteDoc.run(rowid)
  }
  const remove = (kind: SearchKind, id: string) => {
    const row = findRow.get(kind, id) as { rowid: number } | undefined
    if (row) removeRow(row.rowid)
  }
  const put = (doc: Doc) => {
    remove(doc.kind, doc.id)
    const { lastInsertRowid } = insertDoc.run(
      doc.kind,
      doc.id,
      doc.title,
      doc.day,
      JSON.stringify(doc.tags),
      doc.status ?? null,
      doc.parentId ?? null,
    )
    insertText.run(lastInsertRowid, doc.title, doc.body, wholeTokens(`${doc.title}\n${doc.body}`).map(tokenWord).join(' '))
  }
  /** Replaces every item of a kind at once. */
  const replaceKind = (kind: SearchKind, docs: Doc[]) => {
    db.exec('BEGIN')
    try {
      for (const { rowid } of rowsOfKind.all(kind) as { rowid: number }[]) removeRow(rowid)
      for (const doc of docs) put(doc)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const contentOptions = content
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (work: () => Promise<void>) => {
    const next = queue.then(work)
    queue = next.catch(() => {})
    return next
  }

  return {
    rebuild: () =>
      enqueue(async () => {
        const [todos, notes, devlogs, sketches] = await Promise.all([
          todoDocs(contentOptions),
          noteDocs(contentOptions),
          devlogDocs(contentOptions),
          sketchDocs(contentOptions),
        ])
        replaceKind('todo', todos)
        replaceKind('note', notes)
        replaceKind('devlog', devlogs)
        replaceKind('sketch', sketches)
      }),

    refresh: (change) =>
      enqueue(async () => {
        if (change.kind === 'todos') return replaceKind('todo', await todoDocs(contentOptions))
        const kind = ({ notes: 'note', devlogs: 'devlog', sketches: 'sketch' } as const)[change.kind as 'notes' | 'devlogs' | 'sketches']
        if (!kind) return
        if (change.id === undefined) {
          const read = { note: noteDocs, devlog: devlogDocs, sketch: sketchDocs }[kind]
          return replaceKind(kind, await read(contentOptions))
        }
        const doc = await readDoc(kind, change.id, contentOptions)
        if (doc) put(doc)
        else remove(kind, change.id)
      }),

    idle: () => queue,

    search(query) {
      const match = ftsQuery(query.text ?? '')
      const tags = query.tags ?? []
      const kinds = query.kinds?.length ? query.kinds : [...SEARCH_KINDS]
      if (!match && !tags.length && !query.kinds?.length && !query.from && !query.to) return []
      const where = [
        `d.kind IN (${kinds.map(() => '?').join(', ')})`,
        ...(query.from ? ['d.day >= ?'] : []),
        ...(query.to ? ['d.day <= ?'] : []),
        ...(tags.length
          ? [
              query.tagMatch === 'any'
                ? `EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value IN (${tags.map(() => '?').join(', ')}))`
                : `(SELECT count(DISTINCT value) FROM json_each(d.tags) WHERE value IN (${tags.map(() => '?').join(', ')})) = ${new Set(tags).size}`,
            ]
          : []),
        ...(match ? ['fts MATCH ?'] : []),
      ]
      const params = [...kinds, ...(query.from ? [query.from] : []), ...(query.to ? [query.to] : []), ...tags, ...(match ? [match] : [])]
      // Ranked by bm25 (titles count double), newer first on a tie; with no text, newest first.
      const rank = match ? 'bm25(fts, 2.0, 1.0, 1.0)' : '0'
      const snippet = match ? `snippet(fts, 1, '${MARK_START}', '${MARK_END}', '…', 16)` : `substr(fts.body, 1, 160)`
      const rows = db
        .prepare(
          // bm25 and snippet can't sit in a window function's query, so each kind is cut to its limit outside.
          `WITH found AS MATERIALIZED (
             SELECT d.rowid, d.kind, d.id, d.title, d.day, d.tags, d.status, d.parent_id, ${snippet} AS snippet, ${rank} AS rank
             FROM fts JOIN docs d ON d.rowid = fts.rowid
             WHERE ${where.join(' AND ')}
           )
           SELECT * FROM (
             SELECT *, row_number() OVER (PARTITION BY kind ORDER BY rank, day DESC, rowid DESC) AS n FROM found
           ) WHERE n <= ? ORDER BY rank, day DESC, rowid DESC`,
        )
        .all(...params, query.limit ?? 20) as {
        kind: SearchKind
        id: string
        title: string
        day: string
        tags: string
        status: TodoStatus | null
        parent_id: string | null
        snippet: string
      }[]
      return rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        title: row.title,
        date: row.day,
        tags: JSON.parse(row.tags) as string[],
        snippet: snippetPieces(row.snippet),
        ...(row.status && { status: row.status }),
        ...(row.parent_id && { parentId: row.parent_id }),
      }))
    },

    close: () => db.close(),
  }
}

/** Searches a throwaway index built in memory from the content folder now: for when no server keeps one. */
export async function searchContent(query: SearchQuery, options: ContentRootOptions = {}): Promise<SearchHit[]> {
  const index = await openSearchIndex({ content: options })
  try {
    await index.rebuild()
    return index.search(query)
  } finally {
    index.close()
  }
}

// --- Content as documents ---------------------------------------------------------------------------------------

const todoDoc = (todo: SubTodo, parentId?: string): Doc => ({
  kind: 'todo',
  id: todo.id,
  title: todo.title,
  body: todo.description ?? '',
  day: localDay(new Date(todo.finishedAt ?? todo.createdAt)),
  tags: todo.tags,
  status: todo.status,
  ...(parentId && { parentId }),
})

async function todoDocs(options: ContentRootOptions): Promise<Doc[]> {
  const [open, finished] = await Promise.all([listTodos(options), listFinishedTodos({}, options)])
  return [...open, ...finished].flatMap((todo) => [todoDoc(todo), ...todo.subTodos.map((sub) => todoDoc(sub, todo.id))])
}

async function readDoc(kind: Exclude<SearchKind, 'todo'>, id: string, options: ContentRootOptions): Promise<Doc | undefined> {
  try {
    if (kind === 'note') {
      const note = await readNote(id, options)
      if (isBrokenNote(note)) return undefined
      return { kind, id, title: note.title, body: plainText(note.body), day: localDay(new Date(note.modifiedAt)), tags: note.tags }
    }
    if (kind === 'devlog') {
      const log = await readDevlog(id, options)
      if (isBrokenDevlog(log)) return undefined
      return { kind, id, title: id, body: plainText(log.body), day: log.kind === 'day' ? log.date : `${log.month}-01`, tags: log.tags }
    }
    const sketch = await readSketch(id, options)
    if (isBrokenSketch(sketch)) return undefined
    return { kind, id, title: sketch.title, body: '', day: localDay(new Date(sketch.modifiedAt)), tags: sketch.tags }
  } catch (error) {
    if (error instanceof MarkdownFileNotFoundError) return undefined
    throw error
  }
}

const readAll = async (kind: Exclude<SearchKind, 'todo'>, ids: string[], options: ContentRootOptions) =>
  (await Promise.all(ids.map((id) => readDoc(kind, id, options)))).filter((doc) => doc !== undefined)

const noteDocs = async (options: ContentRootOptions) =>
  readAll(
    'note',
    (await listNotes(options)).map((note) => note.id),
    options,
  )
const devlogDocs = async (options: ContentRootOptions) =>
  readAll(
    'devlog',
    (await listDevlogs(options)).map((log) => log.id),
    options,
  )
/** A Sketch is indexed by what its listing holds: title and Tags. */
const sketchDocs = async (options: ContentRootOptions): Promise<Doc[]> =>
  (await listSketches(options))
    .filter((sketch) => !isBrokenSketch(sketch))
    .map((sketch) => sketch as SketchSummary)
    .map(({ id, title, tags, modifiedAt }) => ({ kind: 'sketch', id, title, body: '', day: localDay(new Date(modifiedAt)), tags }))
