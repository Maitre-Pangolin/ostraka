import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addPerson,
  findPeople,
  getPerson,
  listPeople,
  PeopleFileError,
  PersonExistsError,
  PersonNotFoundError,
  refreshPerson,
  type ContentRootOptions,
} from '../src/index.ts'

let contentRoot: string
let options: ContentRootOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const peopleFile = () => join(contentRoot, 'people.json')

describe('addPerson', () => {
  it('writes a Person to people.json, its id from the name when none is given', async () => {
    const added = await addPerson(
      { name: 'Ilse Vantongeren', email: 'ilse.vantongeren@corp.example', slackHandle: 'ilse', gitlabUsername: 'ivantongeren' },
      options,
    )
    expect(added).toEqual({
      id: 'ilse-vantongeren',
      name: 'Ilse Vantongeren',
      aliases: [],
      email: 'ilse.vantongeren@corp.example',
      slackHandle: 'ilse',
      gitlabUsername: 'ivantongeren',
    })
    expect(JSON.parse(await readFile(peopleFile(), 'utf8'))).toEqual({ people: [added] })
    expect(await listPeople(options)).toEqual([added])
  })

  it('slugs accents and punctuation out of the name', async () => {
    const added = await addPerson({ name: "Zoé O'Brannagh-Sénac" }, options)
    expect(added.id).toBe('zoe-o-brannagh-senac')
  })

  it('keeps a given id, aliases and the ignore mark', async () => {
    const added = await addPerson({ id: 'bram', name: 'Bram Okonkwo', aliases: ['Brammie'], ignored: true }, options)
    expect(added).toEqual({ id: 'bram', name: 'Bram Okonkwo', aliases: ['Brammie'], ignored: true })
  })

  it('refuses an id already taken, and an email another Person has', async () => {
    await addPerson({ name: 'Ilse Vantongeren', email: 'ilse@corp.example' }, options)
    await expect(addPerson({ name: 'Ilse Vantongeren' }, options)).rejects.toThrow(PersonExistsError)
    await expect(addPerson({ id: 'ilse-v', name: 'Ilse V', email: 'ILSE@corp.example' }, options)).rejects.toThrow(
      /ilse-vantongeren already has/,
    )
  })

  it('refuses an invalid id or email', async () => {
    await expect(addPerson({ id: 'Not A Slug', name: 'X' }, options)).rejects.toThrow(/id is lowercase/)
    await expect(addPerson({ name: 'Ilse', email: 'not-an-email' }, options)).rejects.toThrow(/one company email/)
  })

  it('keeps people.json sorted by id with a stable key order', async () => {
    await addPerson({ name: 'Zeno Pallas' }, options)
    await addPerson({ jiraAccountId: '5f1a00c2', name: 'Ada Brennholt', email: 'ada@corp.example', id: 'ada' }, options)
    expect(await readFile(peopleFile(), 'utf8')).toBe(
      `${JSON.stringify(
        {
          people: [
            { id: 'ada', name: 'Ada Brennholt', aliases: [], email: 'ada@corp.example', jiraAccountId: '5f1a00c2' },
            { id: 'zeno-pallas', name: 'Zeno Pallas', aliases: [] },
          ],
        },
        null,
        2,
      )}\n`,
    )
  })

  it('refuses to overwrite an invalid people.json', async () => {
    await writeFile(peopleFile(), '{"people": [{"id": "Bad Id"}]}')
    await expect(addPerson({ name: 'Ilse' }, options)).rejects.toThrow(PeopleFileError)
    expect(await readFile(peopleFile(), 'utf8')).toBe('{"people": [{"id": "Bad Id"}]}')
  })
})

describe('listPeople', () => {
  it('is empty without a people.json', async () => {
    expect(await listPeople(options)).toEqual([])
  })
})

describe('findPeople', () => {
  beforeEach(async () => {
    await addPerson(
      { name: 'Ilse Vantongeren', aliases: ['Ilsa'], email: 'ilse.v@corp.example', slackHandle: 'ilsev', gitlabUsername: 'ivant' },
      options,
    )
    await addPerson({ name: 'Zoé Sénac', email: 'zoe.senac@corp.example' }, options)
  })

  it('finds by any part of the name, ignoring case and accents', async () => {
    expect((await findPeople('senac', options)).map((person) => person.id)).toEqual(['zoe-senac'])
    expect((await findPeople('ZOÉ', options)).map((person) => person.id)).toEqual(['zoe-senac'])
  })

  it('finds by id, alias, email, Slack handle and GitLab username', async () => {
    for (const query of ['ilse-vantongeren', 'ilsa', 'ilse.v@corp.example', '@ilsev', 'ivant']) {
      expect((await findPeople(query, options)).map((person) => person.id)).toEqual(['ilse-vantongeren'])
    }
  })

  it('finds nobody for an unknown name', async () => {
    expect(await findPeople('Quentin', options)).toEqual([])
  })
})

describe('getPerson', () => {
  it('reads one Person by id, and says when there is none', async () => {
    const added = await addPerson({ name: 'Ilse Vantongeren' }, options)
    expect(await getPerson('ilse-vantongeren', options)).toEqual(added)
    await expect(getPerson('nobody', options)).rejects.toThrow(PersonNotFoundError)
  })
})

describe('refreshPerson', () => {
  it('replaces the identities given, keeping the others', async () => {
    await addPerson({ name: 'Ilse Vantongeren', email: 'ilse@corp.example', slackId: 'U01OLD', gitlabUsername: 'ivant' }, options)
    const refreshed = await refreshPerson(
      'ilse-vantongeren',
      { slackId: 'U02NEW', slackHandle: 'ilse', jiraAccountId: '712020:ab' },
      options,
    )
    expect(refreshed).toEqual({
      id: 'ilse-vantongeren',
      name: 'Ilse Vantongeren',
      aliases: [],
      email: 'ilse@corp.example',
      slackId: 'U02NEW',
      slackHandle: 'ilse',
      gitlabUsername: 'ivant',
      jiraAccountId: '712020:ab',
    })
    expect(await getPerson('ilse-vantongeren', options)).toEqual(refreshed)
  })

  it('refuses an unknown id', async () => {
    await expect(refreshPerson('nobody', { slackId: 'U1' }, options)).rejects.toThrow(PersonNotFoundError)
  })
})
