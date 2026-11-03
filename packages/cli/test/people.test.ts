import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

async function ostraka(...argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: contentRoot },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

describe('ostraka people', () => {
  it('adds, finds, shows and refreshes a Person through core', async () => {
    const added = await ostraka(
      'people',
      'add',
      'Ilse Vantongeren',
      '--email',
      'ilse.v@corp.example',
      '--alias',
      'Ilsa',
      '--slack-handle',
      '@ilsev',
    )
    expect(added).toEqual({ code: 0, stdout: 'Added ilse-vantongeren  Ilse Vantongeren  ilse.v@corp.example\n', stderr: '' })

    expect(await ostraka('people', 'find', 'ilsa')).toEqual({
      code: 0,
      stdout: 'ilse-vantongeren  Ilse Vantongeren  ilse.v@corp.example\n',
      stderr: '',
    })
    expect(await ostraka('people', 'find', 'Quentin')).toEqual({ code: 0, stdout: 'No Person matches Quentin.\n', stderr: '' })

    const refreshed = await ostraka('people', 'refresh', 'ilse-vantongeren', '--slack-id', 'U02ABC', '--gitlab', 'ivant', '--jira', '712020:ab')
    expect(refreshed.code).toBe(0)

    expect(await ostraka('people', 'show', 'ilse-vantongeren')).toEqual({
      code: 0,
      stdout: [
        'ilse-vantongeren  Ilse Vantongeren',
        '  Aliases  Ilsa',
        '  Email    ilse.v@corp.example',
        '  Slack    @ilsev (U02ABC)',
        '  GitLab   ivant',
        '  Jira     712020:ab',
        '',
      ].join('\n'),
      stderr: '',
    })

    const file = JSON.parse(await readFile(join(contentRoot, 'people.json'), 'utf8'))
    expect(file.people).toEqual([
      {
        id: 'ilse-vantongeren',
        name: 'Ilse Vantongeren',
        aliases: ['Ilsa'],
        email: 'ilse.v@corp.example',
        slackId: 'U02ABC',
        slackHandle: 'ilsev',
        gitlabUsername: 'ivant',
        jiraAccountId: '712020:ab',
      },
    ])
  })

  it('prints JSON with --json', async () => {
    const added = JSON.parse((await ostraka('people', 'add', 'Bram Okonkwo', '--id', 'bram', '--ignored', '--json')).stdout)
    expect(added).toEqual({ id: 'bram', name: 'Bram Okonkwo', aliases: [], ignored: true })
    expect(JSON.parse((await ostraka('people', 'find', 'bram', '--json')).stdout)).toEqual([added])
    expect(JSON.parse((await ostraka('people', 'show', 'bram', '--json')).stdout)).toEqual(added)
  })

  it('fails on an unknown id, a taken id and missing arguments', async () => {
    expect(await ostraka('people', 'show', 'nobody')).toMatchObject({ code: 1, stderr: 'No Person nobody in the People directory.\n' })
    await ostraka('people', 'add', 'Bram Okonkwo')
    expect(await ostraka('people', 'add', 'Bram Okonkwo')).toMatchObject({ code: 1, stderr: expect.stringMatching(/already/) })
    expect((await ostraka('people', 'refresh', 'bram-okonkwo')).code).toBe(1)
    expect((await ostraka('people')).stderr).toMatch(/ostraka people find/)
  })
})
