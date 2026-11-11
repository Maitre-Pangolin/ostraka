import {
  addPerson,
  FileLockedError,
  getPerson,
  listPeople,
  NewPersonSchema,
  PeopleFileError,
  PersonExistsError,
  PersonNotFoundError,
  type PeopleOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'

function onPeopleError(error: Error, c: Context) {
  if (error instanceof PersonNotFoundError) return c.json({ error: error.message }, 404)
  // The file is broken, another writer holds it, or the id or email is taken.
  if (error instanceof PeopleFileError || error instanceof FileLockedError || error instanceof PersonExistsError) {
    return c.json({ error: error.message }, 409)
  }
  throw error
}

/** `/api/people`: the People directory, for Mentions and their contact cards, and adding a Person. Writes go through core. */
export function peopleRoutes(options: PeopleOptions) {
  const routes = new Hono()
  routes.onError(onPeopleError)

  routes.get('/', async (c) => c.json(await listPeople(options)))
  routes.get('/:id', async (c) => c.json(await getPerson(c.req.param('id'), options)))
  routes.post('/', async (c) => {
    const body = await readBody(c, NewPersonSchema)
    if (!body.ok) return body.response
    return c.json(await addPerson(body.data, options), 201)
  })

  return routes
}
