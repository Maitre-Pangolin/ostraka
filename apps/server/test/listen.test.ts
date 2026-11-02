import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { startServer } from '../src/index.ts'
import { fakeKeychain } from './fake-keychain.ts'

describe('startServer', () => {
  it('listens on the loopback interface only', async () => {
    const server = await startServer({ port: 0, webDist: '/nonexistent', keychain: fakeKeychain({}).keychain })
    try {
      expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
