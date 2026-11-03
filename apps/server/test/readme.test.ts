import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { KEYCHAIN_ITEMS } from '../src/index.ts'

const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8')

describe('README', () => {
  // `-w` with no value prompts and silently truncates long tokens (Atlassian's are ~190 chars), hence `read -rs`.
  it.each(Object.values(KEYCHAIN_ITEMS))('shows how to create %s so every read prompts, without truncating the token', (item) => {
    expect(readme).toContain(`read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`)
  })

  it('documents backup and the whole restore path on a new machine', () => {
    const restore = readme.slice(readme.indexOf('## Restore on a new machine'))
    expect(readme).toContain('## Back it up')
    expect(readme).toContain('pnpm ostraka backup')
    const steps = ['pnpm install', 'pnpm build', 'pnpm ostraka init --from', 'pnpm ostraka install']
    const at = steps.map((step) => restore.indexOf(step))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect(at).toEqual(at.toSorted((a, b) => a - b))
  })
})
