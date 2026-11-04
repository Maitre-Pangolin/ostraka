import { describe, expect, it } from 'vitest'
import { findMatches } from '../src/search-match.ts'

/** The matched text, in order. */
const matched = (text: string, query: string) => findMatches(text, query).map(({ start, end }) => text.slice(start, end))

describe('findMatches', () => {
  it('finds each word as the start of a word, ignoring case and accents', () => {
    expect(matched('The Café opened, then cafés closed', 'cafe')).toEqual(['Café', 'café'])
    expect(matched('Reprise du déploiement', 'DEPLOI')).toEqual(['déploi'])
  })

  it('does not find a word inside another word', () => {
    expect(matched('redeploy', 'deploy')).toEqual([])
  })

  it('finds every word typed, wherever each is', () => {
    expect(matched('Kafka lag on the billing consumer', 'consumer kafka')).toEqual(['Kafka', 'consumer'])
  })

  it('finds a "phrase" only as those whole words in order', () => {
    expect(matched('rate limit, limit rate, rate limiting', '"rate limit"')).toEqual(['rate limit'])
  })

  it('finds a Reference or Mention typed whole as that whole token', () => {
    expect(matched('PAY-1432 and PAY-14320', 'pay-1432')).toEqual(['PAY-1432'])
    expect(matched('Asked @alice, not @alice-b', '@alice')).toEqual(['@alice'])
  })

  it('finds nothing for nothing searchable', () => {
    expect(matched('anything', '  "" - ')).toEqual([])
  })

  it('gives each place once, in order, without overlaps', () => {
    expect(findMatches('deploy deployment', 'deploy deploym')).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 14 },
    ])
  })
})
