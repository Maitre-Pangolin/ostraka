// The People directory over the server API (`/api/people`). `people.json` changing elsewhere (the CLI, an agent)
// arrives as a live update of kind `people`, which refetches it.
import type { NewPerson, Person } from '@ostraka/core/person-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { post, request } from '@/lib/api'

export type { Person }

const PEOPLE = ['people'] as const

/** Every Person, by id. */
export function usePeople() {
  return useQuery({ queryKey: PEOPLE, queryFn: () => request<Person[]>('/people') })
}

export type PeopleIndex = {
  people: Person[]
  byId: Map<string, Person>
  /** Whether an id is in the directory: only its Mentions become chips. */
  isPerson: (id: string) => boolean
  /** Whether the directory has loaded, so an id missing from it is really unknown. */
  loaded: boolean
}

const NONE: Person[] = []

/** The directory as Mentions need it. */
export function usePeopleIndex(): PeopleIndex {
  const { data, isSuccess } = usePeople()
  const people = data ?? NONE
  return useMemo(() => {
    const byId = new Map(people.map((person) => [person.id, person]))
    return { people, byId, isPerson: (id: string) => byId.has(id), loaded: isSuccess }
  }, [people, isSuccess])
}

/** Adds a Person: the "add" offered on a Mention of an unknown id. */
export function useAddPerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (person: NewPerson) => post<Person>('/people', person),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PEOPLE }),
  })
}
