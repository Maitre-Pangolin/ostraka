import type { Keychain } from '../src/index.ts'

/** An in-memory Keychain that counts reads per item. */
export function fakeKeychain(items: Record<string, string>) {
  const reads: string[] = []
  const keychain: Keychain = {
    async read(service) {
      reads.push(service)
      return items[service]
    },
    async has(service) {
      return items[service] !== undefined
    },
  }
  return { keychain, reads }
}

/** Token-shaped values, so a leak shows up whatever the encoding of the response. */
export const TOKENS = {
  'ostraka-gitlab': 'glpat-FAKEgitlabTOKEN0123456789',
  'ostraka-jira': `ATATT3xFAKEjiraTOKEN${'x'.repeat(170)}`,
}
