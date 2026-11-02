import { describe, expect, it } from 'vitest'
import { createApp } from '../src/index.ts'

const app = createApp({ webDist: '/nonexistent' })

const get = (host: string, headers: Record<string, string> = {}) => app.request('/api/health', { headers: { host, ...headers } })

const send = (method: string, origin?: string) =>
  app.request('/api/anything', { method, headers: { host: '127.0.0.1:4747', ...(origin ? { origin } : {}) } })

describe('Host lockdown', () => {
  it.each(['127.0.0.1:4747', 'localhost:4747'])('accepts Host %s', async (host) => {
    const res = await get(host)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it.each(['evil.example', 'evil.example:4747', '127.0.0.1:5173', '0.0.0.0:4747'])('rejects Host %s', async (host) => {
    expect((await get(host)).status).toBe(403)
  })

  it('rejects a request with no Host', async () => {
    expect((await app.request('/api/health')).status).toBe(403)
  })
})

describe('Origin lockdown', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s from a foreign Origin', async (method) => {
    expect((await send(method, 'https://evil.example')).status).toBe(403)
  })

  it.each(['null', 'http://127.0.0.1:5173', 'http://localhost:4747.evil.example'])('rejects a POST from Origin %s', async (origin) => {
    expect((await send('POST', origin)).status).toBe(403)
  })

  it.each(['http://127.0.0.1:4747', 'http://localhost:4747'])('lets a POST from the app itself (%s) through', async (origin) => {
    expect((await send('POST', origin)).status).not.toBe(403)
  })

  it('lets a POST with no Origin (CLI, agents) through', async () => {
    expect((await send('POST')).status).not.toBe(403)
  })

  it('lets a GET from a foreign Origin through to the route', async () => {
    expect((await get('127.0.0.1:4747', { origin: 'https://evil.example' })).status).toBe(200)
  })
})
