// New Persons picked from "Add Person" while a Mention is typed. They wait in this window, not in the People
// directory, until a Todo, Note or Dev log mentioning them is saved: only then is the Stub Person (id and guessed
// name) written, so an abandoned draft leaves no Person behind. Not server state: nothing of it is on the server yet.
import { findMentions } from '@ostraka/core/mentions'
import { useSyncExternalStore } from 'react'
import { ApiError, post } from '../lib/api'

export type NewPerson = { id: string; name: string }

const waiting = new Map<string, NewPerson & { saved: boolean }>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  for (const listener of listeners) listener()
}

/** Picking "Add Person": the chip shows them as new until a save writes them. */
export function markNewPerson(person: NewPerson) {
  if (waiting.get(person.id)?.name === person.name) return
  waiting.set(person.id, { ...person, saved: false })
  changed()
}

/** Whether `id` was picked as a new Person in this window (saved since or not). */
export const isNewPerson = (id: string) => waiting.has(id)

/** The new Persons picked in this window, for suggestions and chips; re-renders when one is picked. */
export function useNewPeople(): NewPerson[] {
  useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => version,
  )
  return [...waiting.values()]
}

/**
 * Before a save: writes a Stub Person for each new Person the saved texts mention, once. An id someone added
 * meanwhile counts as written. The People directory refetches through the live update of `people.json`.
 */
export async function saveNewPeople(...texts: (string | undefined)[]): Promise<void> {
  const ids = new Set(texts.flatMap((text) => (text ? findMentions(text).map((found) => found.id) : [])))
  for (const person of waiting.values()) {
    if (person.saved || !ids.has(person.id)) continue
    try {
      await post('/people', { id: person.id, name: person.name })
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error
    }
    person.saved = true
  }
}
