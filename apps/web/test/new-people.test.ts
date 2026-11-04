// A Person picked from "Add Person" waits in the window until something mentioning them is saved.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewPerson, markNewPerson, saveNewPeople } from '../src/people/new-people.ts'

afterEach(() => vi.unstubAllGlobals())

describe('new People', () => {
  it('writes a Stub Person only when a saved text mentions them, once', async () => {
    const posted: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (_url, init) => {
        posted.push(JSON.parse(init.body as string))
        return new Response('{}', { status: 201 })
      }),
    )
    markNewPerson({ id: 'milena-s', name: 'Milena S' })
    markNewPerson({ id: 'abandoned-draft', name: 'Abandoned Draft' })
    expect(isNewPerson('milena-s')).toBe(true)

    await saveNewPeople('Ask @milena-s', undefined)
    await saveNewPeople('Ask @milena-s again')

    expect(posted).toEqual([{ id: 'milena-s', name: 'Milena S' }])
    expect(isNewPerson('abandoned-draft')).toBe(true)
  })

  it('takes a Person someone added meanwhile as saved', async () => {
    const fetch = vi.fn<() => Promise<Response>>(async () => new Response('{"error":"taken"}', { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    markNewPerson({ id: 'bram-o', name: 'Bram O' })
    await saveNewPeople('@bram-o')
    await saveNewPeople('@bram-o')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
