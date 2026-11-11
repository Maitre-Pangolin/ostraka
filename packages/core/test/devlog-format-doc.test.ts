// The Dev log format agents follow is documented next to the Dev log skill. Every example file in it must read as
// valid here, so the document and the app never disagree.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devlogSectionProblems, formatMarkdown, readDevlog, splitFrontmatter } from '../src/index.ts'

const doc = await readFile(new URL('../../../.claude/skills/devlog/format.md', import.meta.url), 'utf8')
// Example files are fenced as ```markdown and start with their YAML header.
const examples = [...doc.matchAll(/^```markdown\n(---\n[\s\S]*?)^```$/gm)].map((match) => match[1]!)
const idOf = (example: string) => /^(?:date|month): (\S+)$/m.exec(example)![1]!

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  await mkdir(join(contentRoot, 'devlogs'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

describe('the documented Dev log format', () => {
  it('has a day, an off day and a monthly summary as examples', () => {
    expect(examples.map((example) => /^(date|month|off): /gm.exec(example)?.[1])).toEqual(['date', 'date', 'month'])
    expect(examples.some((example) => /^off: true$/m.test(example))).toBe(true)
  })

  it.each(examples.map((example) => [idOf(example), example]))(
    'reads %s as valid, in house style and in section order',
    async (id, example) => {
      await writeFile(join(contentRoot, 'devlogs', `${id}.md`), example)
      const log = await readDevlog(id, { env: { OSTRAKA_HOME: contentRoot } })
      expect(log).not.toHaveProperty('error')
      const { body } = splitFrontmatter(example)
      expect(formatMarkdown(body)).toBe(body.replace(/^\n/, ''))
      expect(/^\d{4}-\d{2}-\d{2}$/.test(id) ? devlogSectionProblems(body) : []).toEqual([])
    },
  )

  it('tells agents where the files go', () => {
    expect(doc).toContain('ostraka path devlogs')
  })
})
