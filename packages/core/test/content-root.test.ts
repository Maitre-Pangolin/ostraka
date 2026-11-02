import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locateContentRoot, resolveContentRoot } from '../src/index.ts'

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

describe('resolveContentRoot', () => {
  it('defaults to ~/ostraka-content', async () => {
    expect(await resolveContentRoot({ env: {}, homeDir: home })).toBe(join(home, 'ostraka-content'))
  })

  it('uses contentDir from ~/.config/ostraka/config.yml', async () => {
    await writeConfig('contentDir: /data/my-content\n')
    expect(await resolveContentRoot({ env: {}, homeDir: home })).toBe('/data/my-content')
  })

  it('expands ~ in contentDir', async () => {
    await writeConfig('contentDir: ~/notes-and-todos\n')
    expect(await resolveContentRoot({ env: {}, homeDir: home })).toBe(join(home, 'notes-and-todos'))
  })

  it('ignores config keys it does not know', async () => {
    await writeConfig('gitlab:\n  base_url: https://gitlab.com\n')
    expect(await resolveContentRoot({ env: {}, homeDir: home })).toBe(join(home, 'ostraka-content'))
  })

  it('prefers OSTRAKA_HOME over the config file', async () => {
    await writeConfig('contentDir: /data/my-content\n')
    expect(await resolveContentRoot({ env: { OSTRAKA_HOME: '/tmp/elsewhere' }, homeDir: home })).toBe('/tmp/elsewhere')
  })

  it.each([
    ['default', {}, ''],
    ['config', {}, 'contentDir: /data/my-content\n'],
    ['env', { OSTRAKA_HOME: '/tmp/elsewhere' }, 'contentDir: /data/my-content\n'],
  ] as const)('says the root comes from %s', async (source, env, yaml) => {
    if (yaml) await writeConfig(yaml)
    expect((await locateContentRoot({ env, homeDir: home })).source).toBe(source)
  })

  it('reports a config file whose contentDir is not a path', async () => {
    await writeConfig('contentDir: 42\n')
    await expect(resolveContentRoot({ env: {}, homeDir: home })).rejects.toThrow(/config\.yml.*contentDir/s)
  })
})
