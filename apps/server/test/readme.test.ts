import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { KEYCHAIN_ITEMS } from '../src/index.ts'

const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8')

describe('README', () => {
  // `-w` with no value prompts and silently truncates long tokens (Atlassian's are ~190 chars), hence `read -rs`.
  it.each(Object.values(KEYCHAIN_ITEMS))('shows how to create %s so every read prompts, without truncating the token', (item) => {
    expect(readme).toContain(`read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`)
  })
})
