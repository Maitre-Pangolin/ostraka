import { describe, expect, it } from 'vitest'
import { completedMentions, findMentions, mentionedPeople, personLinks, suggestPeople, type MentionCandidate } from '../src/mentions.ts'
import { joinPieces, splitChips, type TextPiece } from '../src/references.ts'

describe('findMentions', () => {
  it('finds @<person id> in plain text, where it is', () => {
    expect(findMentions('Ask @ilse-vantongeren and @bram.')).toEqual([
      { token: '@ilse-vantongeren', id: 'ilse-vantongeren', start: 4, end: 21 },
      { token: '@bram', id: 'bram', start: 26, end: 31 },
    ])
  })

  it('ends at punctuation and brackets', () => {
    expect(findMentions('(@bram), @zoe: @ilse!').map((found) => found.id)).toEqual(['bram', 'zoe', 'ilse'])
  })

  it('leaves emails, capitals, trailing hyphens and words run on alone', () => {
    for (const text of ['ilse@corp.example', '@Ilse', '@ilse-', '@ilse_v', 'a@bram', '@bram/x', '@@bram']) {
      expect(findMentions(text)).toEqual([])
    }
  })
})

describe('mentionedPeople', () => {
  it('lists each Person mentioned once, in order', () => {
    expect(mentionedPeople('@bram, then @ilse and @bram again')).toEqual(['bram', 'ilse'])
  })
})

const people: MentionCandidate[] = [
  { id: 'ilse-vantongeren', name: 'Ilse Vantongeren', aliases: ['Ilsa'] },
  { id: 'zoe-senac', name: 'Zoé Sénac', aliases: [] },
  { id: 'bram', name: 'Bram Okonkwo', aliases: [] },
  { id: 'quinn', name: 'Quinn Ignored', aliases: [], ignored: true },
]

const ids = (fragment: string) => suggestPeople(fragment, people).map((suggestion) => suggestion.token)

describe('suggestPeople', () => {
  it('suggests every Person after @, by name, leaving out the ignored', () => {
    expect(ids('@')).toEqual(['@bram', '@ilse-vantongeren', '@zoe-senac'])
  })

  it('matches by the start of the id, of a word of the name, or of an alias, ignoring case and accents', () => {
    expect(ids('@ilse')).toEqual(['@ilse-vantongeren'])
    expect(ids('@van')).toEqual(['@ilse-vantongeren'])
    expect(ids('@sén')).toEqual(['@zoe-senac'])
    expect(ids('@Zoe')).toEqual(['@zoe-senac'])
    expect(ids('@ilsa')).toEqual(['@ilse-vantongeren'])
    expect(ids('@zoe-se')).toEqual(['@zoe-senac'])
  })

  it('puts id matches before name matches', () => {
    const more = [...people, { id: 'okonkwo-jr', name: 'Junior Okonkwo', aliases: [] }]
    expect(suggestPeople('@okon', more).map((suggestion) => suggestion.token)).toEqual(['@okonkwo-jr', '@bram'])
  })

  it('says who each suggestion is', () => {
    expect(suggestPeople('@bram', people)).toEqual([{ kind: 'mention', token: '@bram', id: 'bram', name: 'Bram Okonkwo' }])
  })

  it('suggests nothing outside a Mention or for no match', () => {
    expect(ids('bram')).toEqual([])
    expect(ids('@quentin')).toEqual([])
  })
})

const known = (id: string) => people.some((person) => person.id === id)

describe('completedMentions', () => {
  it('takes a known @<person id> once a space or punctuation follows', () => {
    expect(completedMentions('Ask @bram, then @ilse-vantongeren ', known).map((found) => found.token)).toEqual([
      '@bram',
      '@ilse-vantongeren',
    ])
  })

  it('waits while the id may still be typed, and leaves unknown ids as text', () => {
    expect(completedMentions('Ask @bram', known)).toEqual([])
    expect(completedMentions('Ask @quentin ', known)).toEqual([])
  })
})

describe('personLinks', () => {
  it('opens a Slack DM, an email, and GitLab and Jira profiles under the configured sites', () => {
    const person = { email: 'ilse.v@corp.example', slackId: 'U02ABC', gitlabUsername: 'ivant', jiraAccountId: '712020:ab' }
    expect(personLinks(person, { gitlab: 'https://gitlab.example/', jira: 'https://acme.atlassian.net' })).toEqual({
      slack: 'https://slack.com/app_redirect?channel=U02ABC',
      email: 'mailto:ilse.v@corp.example',
      gitlab: 'https://gitlab.example/ivant',
      jira: 'https://acme.atlassian.net/jira/people/712020%3Aab',
    })
  })

  it('leaves out what is unknown or has no configured site', () => {
    expect(personLinks({ gitlabUsername: 'ivant', jiraAccountId: '1' }, {})).toEqual({})
  })
})

const text = (value: string): TextPiece => ({ kind: 'text', text: value })
const mention = (id: string): TextPiece => ({ kind: 'mention', token: `@${id}`, id })

describe('splitChips and joinPieces', () => {
  it('splits Mentions out next to References', () => {
    expect(splitChips('Ask @bram about PAY-1')).toEqual([
      text('Ask '),
      mention('bram'),
      text(' about '),
      { kind: 'reference', token: 'PAY-1', reference: { kind: 'jira', key: 'PAY-1' } },
    ])
  })

  it('keeps a Mention of an unknown Person as text when told who is known', () => {
    expect(splitChips('Ask @bram and @quentin', { isPerson: (id) => id === 'bram' })).toEqual([
      text('Ask '),
      mention('bram'),
      text(' and @quentin'),
    ])
  })

  it.each(['Ask @bram, @ilse!', '(@bram) PAY-1', 'mail ilse@corp.example', ''])('joins %j back as it was', (value) => {
    expect(joinPieces(splitChips(value))).toBe(value)
  })

  it('gives a word touching a Mention a space, so the id parses back', () => {
    expect(joinPieces([text('Ask'), mention('bram'), text('now')])).toBe('Ask @bram now')
    expect(joinPieces([mention('bram'), mention('ilse')])).toBe('@bram @ilse')
    expect(joinPieces([mention('bram'), text('-x, '), mention('ilse'), text('.')])).toBe('@bram -x, @ilse.')
  })
})
