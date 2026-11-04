// The repo's agent skills run in Claude Code and in Cursor, so each sticks to the Agent Skills format both read:
// `<name>/SKILL.md`, `name` equal to the folder, and only the frontmatter both editors document.
import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { splitFrontmatter } from '../src/index.ts'

const skillsDir = new URL('../../../.claude/skills/', import.meta.url)
const skills = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
const SHARED_KEYS = ['name', 'description', 'disable-model-invocation', 'paths', 'metadata']

describe('the repo’s skills', () => {
  it('include the Dev log skill and the Briefing', () => {
    expect(skills).toEqual(expect.arrayContaining(['devlog', 'whats-up']))
  })

  it.each(skills)('%s is an Agent Skill named after its folder, with shared frontmatter only', async (skill) => {
    const { yaml } = splitFrontmatter(await readFile(new URL(`${skill}/SKILL.md`, skillsDir), 'utf8'))
    const header = parse(yaml ?? '') as Record<string, unknown>
    expect(header.name).toBe(skill)
    expect(header.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(typeof header.description).toBe('string')
    expect((header.description as string).length).toBeLessThanOrEqual(1024)
    expect(Object.keys(header).filter((key) => !SHARED_KEYS.includes(key))).toEqual([])
  })

  it.each(skills)('%s names MCP tools by server key and tool name, never by an editor’s own form', async (skill) => {
    const text = await readFile(new URL(`${skill}/SKILL.md`, skillsDir), 'utf8')
    expect(text).not.toMatch(/mcp__|\b(?:gitlab|atlassian|slack):[a-z]/i)
  })
})
