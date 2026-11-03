import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSketch,
  listSketches,
  listTags,
  MarkdownFileError,
  MarkdownFileNotFoundError,
  readSketch,
  StaleVersionError,
  updateSketch,
  type Sketch,
  type SketchOptions,
} from '../src/index.ts'

let contentRoot: string
let options: SketchOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const sketchFile = (id: string) => join(contentRoot, 'sketches', `${id}.md`)
const writeSketch = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'sketches'), { recursive: true })
  await writeFile(sketchFile(id), text)
}

describe('createSketch', () => {
  it('writes sketches/<id>.md: a header with the title and Tags, then a starter Mermaid block, and lists it', async () => {
    const sketch = await createSketch({ title: 'Login flow', tags: ['auth'] }, options)
    expect(sketch).toMatchObject({ id: expect.stringMatching(/^[a-z0-9]{5}$/), title: 'Login flow', tags: ['auth'] })
    expect(await readFile(sketchFile(sketch.id), 'utf8')).toBe(
      `---\ntitle: Login flow\ntags: [auth]\n---\n\n\`\`\`mermaid\n${sketch.mermaid}\n\`\`\`\n`,
    )
    expect(sketch.mermaid).toMatch(/^flowchart /)
    expect(await listSketches(options)).toEqual([
      { id: sketch.id, version: sketch.version, modifiedAt: expect.any(String), title: 'Login flow', tags: ['auth'] },
    ])
  })

  it('refuses a Sketch without a title', async () => {
    await expect(createSketch({ title: '  ' }, options)).rejects.toThrow(/title/)
  })
})

const FLOW = '```mermaid\nflowchart TD\n  a --> b\n```\n'

describe('listSketches', () => {
  it('lists no Sketches before there is a sketches folder', async () => {
    expect(await listSketches(options)).toEqual([])
  })

  it('lists a broken Sketch with its error beside the good ones: header unreadable, no title, bad Tag, no Mermaid block', async () => {
    await writeSketch('good', `---\ntitle: Good\ntags: [work]\n---\n\n${FLOW}`)
    await writeSketch('bad-yaml', `---\ntitle: [oops\n---\n\n${FLOW}`)
    await writeSketch('no-title', `---\ntags: []\n---\n\n${FLOW}`)
    await writeSketch('bad-tag', `---\ntitle: T\ntags: [Not A Tag]\n---\n\n${FLOW}`)
    await writeSketch('no-mermaid', '---\ntitle: T\n---\n\n```js\nnot mermaid\n```\n')
    await writeSketch('no-header', FLOW)
    const byId = Object.fromEntries((await listSketches(options)).map((sketch) => [sketch.id, sketch]))
    expect(byId.good).toEqual({ id: 'good', version: expect.any(String), modifiedAt: expect.any(String), title: 'Good', tags: ['work'] })
    expect(byId['bad-yaml']).toMatchObject({ error: expect.stringMatching(/header/i) })
    expect(byId['no-title']).toMatchObject({ error: expect.stringMatching(/title/i) })
    expect(byId['bad-tag']).toMatchObject({ error: expect.stringMatching(/tags/i) })
    expect(byId['no-mermaid']).toMatchObject({ error: expect.stringMatching(/no Mermaid block/i) })
    expect(byId['no-header']).toMatchObject({ error: expect.stringMatching(/no YAML header/i) })
  })

  it('lists the most recently changed Sketch first, and only those with a Tag when asked', async () => {
    await writeSketch('older', `---\ntitle: Older\ntags: [auth]\n---\n\n${FLOW}`)
    await writeSketch('newer', `---\ntitle: Newer\n---\n\n${FLOW}`)
    await utimes(sketchFile('older'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    expect((await listSketches(options)).map((sketch) => sketch.id)).toEqual(['newer', 'older'])
    expect((await listSketches({ ...options, tag: 'auth' })).map((sketch) => sketch.id)).toEqual(['older'])
  })
})

describe('readSketch', () => {
  it('reads the text of the Mermaid block, whatever else the body holds', async () => {
    await writeSketch('s', '---\ntitle: Login\n---\n\nWho talks to whom.\n\n```Mermaid\nsequenceDiagram\n  a->>b: hi\n```\n\nMore.\n')
    expect(await readSketch('s', options)).toEqual({
      id: 's',
      version: expect.any(String),
      modifiedAt: expect.any(String),
      title: 'Login',
      tags: [],
      mermaid: 'sequenceDiagram\n  a->>b: hi',
    })
  })

  it('finds no Sketch for an unknown id or one that leaves the sketches folder', async () => {
    await expect(readSketch('nope', options)).rejects.toThrow(MarkdownFileNotFoundError)
    await expect(readSketch('../todos', options)).rejects.toThrow(MarkdownFileNotFoundError)
  })
})

describe('updateSketch', () => {
  const HEADER = '---\ntitle: Login   # mine\ntags: [auth]\nextra: 1\n---\n\n'
  const BODY = 'Intro *kept*.\n\n```mermaid\nflowchart TD\n  a --> b\n```\n\nOutro.\n'

  it('replaces only the Mermaid block, keeping the header byte-for-byte and the rest of the body', async () => {
    await writeSketch('s', HEADER + BODY)
    const { version } = (await readSketch('s', options)) as Sketch
    const sketch = await updateSketch('s', { mermaid: 'flowchart TD\n  a --> c\n' }, { ...options, ifVersion: version })
    expect(await readFile(sketchFile('s'), 'utf8')).toBe(
      `${HEADER}Intro *kept*.\n\n\`\`\`mermaid\nflowchart TD\n  a --> c\n\`\`\`\n\nOutro.\n`,
    )
    expect(sketch).toMatchObject({ mermaid: 'flowchart TD\n  a --> c', title: 'Login', tags: ['auth'] })
  })

  it('keeps Mermaid text that does not parse: the text is never lost', async () => {
    await writeSketch('s', HEADER + BODY)
    const sketch = await updateSketch('s', { mermaid: 'flowchart TD\n  a -->' }, options)
    expect(sketch.mermaid).toBe('flowchart TD\n  a -->')
  })

  it('fences Mermaid text holding backticks with a longer fence', async () => {
    await writeSketch('s', HEADER + BODY)
    const sketch = await updateSketch('s', { mermaid: 'flowchart TD\n  a["```"] --> b' }, options)
    expect(sketch.mermaid).toBe('flowchart TD\n  a["```"] --> b')
    expect(await readFile(sketchFile('s'), 'utf8')).toContain('````mermaid\n')
  })

  it('renames a Sketch and changes its Tags by rewriting only those header lines', async () => {
    await writeSketch('s', HEADER + BODY)
    await updateSketch('s', { title: 'Sign in', tags: ['auth', 'web'] }, options)
    expect(await readFile(sketchFile('s'), 'utf8')).toBe(`---\ntitle: Sign in   # mine\ntags: [auth, web]\nextra: 1\n---\n\n${BODY}`)
  })

  it('writes nothing when the Mermaid text saved is the one on disk', async () => {
    await writeSketch('s', HEADER + BODY)
    await utimes(sketchFile('s'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    const before = (await readSketch('s', options)) as Sketch
    expect(await updateSketch('s', { mermaid: before.mermaid }, options)).toEqual(before)
    expect((await stat(sketchFile('s'))).mtime).toEqual(new Date(2026, 0, 1))
  })

  it('refuses a change made from a copy older than the file (an agent wrote since)', async () => {
    await writeSketch('s', HEADER + BODY)
    const { version } = (await readSketch('s', options)) as Sketch
    await writeSketch('s', `${HEADER}\`\`\`mermaid\nflowchart TD\n  agent --> edit\n\`\`\`\n`)
    await expect(updateSketch('s', { mermaid: 'flowchart TD\n  mine' }, { ...options, ifVersion: version })).rejects.toThrow(
      StaleVersionError,
    )
    expect(await readFile(sketchFile('s'), 'utf8')).toContain('agent --> edit')
  })

  it('refuses to change a Sketch that has no Mermaid block or a broken header, leaving the file as it is', async () => {
    await writeSketch('none', '---\ntitle: T\n---\n\nNo diagram\n')
    await expect(updateSketch('none', { mermaid: 'flowchart TD' }, options)).rejects.toThrow(MarkdownFileError)
    expect(await readFile(sketchFile('none'), 'utf8')).toBe('---\ntitle: T\n---\n\nNo diagram\n')
    await writeSketch('bad', `---\ntitle: [oops\n---\n\n${FLOW}`)
    await expect(updateSketch('bad', { mermaid: 'flowchart TD' }, options)).rejects.toThrow(MarkdownFileError)
  })
})

describe('Tags in use', () => {
  it('takes in the Tags of Sketches, skipping broken ones', async () => {
    await writeSketch('s', `---\ntitle: S\ntags: [diagrams, auth]\n---\n\n${FLOW}`)
    await writeSketch('bad', '---\ntitle: T\ntags: [ignored]\n---\n\nNo diagram\n')
    expect((await listTags(options)).map((tag) => tag.name)).toEqual(['auth', 'diagrams'])
  })
})
