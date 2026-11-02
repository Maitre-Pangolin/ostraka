import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/index.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function writeConfig(yaml: string) {
  await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
  await writeFile(join(home, '.config', 'ostraka', 'config.yml'), yaml)
}

const FULL = `contentDir: ~/ostraka-content
gitlab:
  base_url: https://gitlab.com
jira:
  site: https://acme.atlassian.net
  cloud_id: 0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f
  board_id: 42
  my_tickets_jql: assignee = currentUser() AND statusCategory != Done
`

describe('loadConfig', () => {
  it('is empty when there is no config file', async () => {
    expect(await loadConfig({ homeDir: home })).toEqual({})
  })

  it('reads the content folder, GitLab and Jira settings', async () => {
    await writeConfig(FULL)
    expect(await loadConfig({ homeDir: home })).toEqual({
      contentDir: '~/ostraka-content',
      gitlab: { base_url: 'https://gitlab.com' },
      jira: {
        site: 'https://acme.atlassian.net',
        cloud_id: '0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f',
        board_id: 42,
        my_tickets_jql: 'assignee = currentUser() AND statusCategory != Done',
      },
    })
  })

  it('reads an empty file as no settings', async () => {
    await writeConfig('')
    expect(await loadConfig({ homeDir: home })).toEqual({})
  })

  it.each([
    ['gitlab.base_url', 'gitlab:\n  base_url: not a url\n'],
    ['jira.site', 'jira:\n  site: acme\n'],
    ['jira.cloud_id', 'jira:\n  cloud_id: nope\n'],
    ['jira.board_id', 'jira:\n  board_id: -3\n'],
  ])('reports an invalid %s with the file and the key', async (key, yaml) => {
    await writeConfig(yaml)
    const [section, field] = key.split('.')
    await expect(loadConfig({ homeDir: home })).rejects.toThrow(new RegExp(`config\\.yml[\\s\\S]*${section}[\\s\\S]*${field}`))
  })

  it.each([
    ['a token key', 'gitlab:\n  base_url: https://gitlab.com\n  token: s3cr3t-value\n', 'gitlab.token'],
    ['a password key', 'jira:\n  api_password: s3cr3t-value\n', 'jira.api_password'],
    ['a secret key at the top', 'secret: s3cr3t-value\n', 'secret'],
    ['a GitLab token as a value', 'gitlab:\n  base_url: https://gitlab.com\n  note: glpat-s3cr3tvalue\n', 'gitlab.note'],
    ['an Atlassian token as a value', 'jira:\n  extra: ATATTs3cr3tvalue\n', 'jira.extra'],
  ])('refuses %s and points to the Keychain without echoing the value', async (_, yaml, key) => {
    await writeConfig(yaml)
    const error = await loadConfig({ homeDir: home }).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(key)
    expect(error.message).toMatch(/Keychain/)
    expect(error.message).not.toMatch(/s3cr3t/)
  })
})
