import { describe, expect, it } from 'vitest'
import {
  completedReferences,
  findReferences,
  joinPieces,
  referenceFromUrl,
  referenceUrl,
  splitReferences,
  suggestReferences,
  type TextPiece,
} from '../src/references.ts'

const tokens = (text: string) => findReferences(text).map((found) => found.token)

describe('findReferences', () => {
  it('finds MR and Jira References in plain text, where they are', () => {
    expect(findReferences('Rebase pay/api!809 for PAY-1432')).toEqual([
      { token: 'pay/api!809', start: 7, end: 18, reference: { kind: 'mr', project: 'pay/api', iid: 809 } },
      { token: 'PAY-1432', start: 23, end: 31, reference: { kind: 'jira', key: 'PAY-1432' } },
    ])
  })
})

describe('findReferences: merge requests', () => {
  it.each([
    ['pay/api!809', { kind: 'mr', project: 'pay/api', iid: 809 }],
    ['acme/payments/backend/api!12', { kind: 'mr', project: 'acme/payments/backend/api', iid: 12 }],
    ['My-Group/my_project.js!3', { kind: 'mr', project: 'My-Group/my_project.js', iid: 3 }],
  ])('reads %s, nested group paths included', (token, reference) => {
    expect(findReferences(`see ${token}.`)).toEqual([{ token, start: 4, end: 4 + token.length, reference }])
  })

  it.each(['!809', 'api!809', 'pay/api!', 'pay/api!80x', '/pay/api!809', 'https://gitlab.com/pay/api!809', 'pay/api!809abc'])(
    'leaves %s alone',
    (word) => {
      expect(tokens(`see ${word} now`)).toEqual([])
    },
  )

  it('ends at punctuation and brackets', () => {
    expect(tokens('(pay/api!809), pay/web!1; pay/web!2!')).toEqual(['pay/api!809', 'pay/web!1', 'pay/web!2'])
  })
})

describe('findReferences: Jira issues', () => {
  it.each(['PAY-1432', 'AB-1', 'P2P-7', 'MY_PROJ-12'])('reads %s', (key) => {
    expect(findReferences(`${key}: fix`)).toEqual([{ token: key, start: 0, end: key.length, reference: { kind: 'jira', key } }])
  })

  it.each(['pay-1432', 'P-1', 'PAY-', 'PAY-14x', 'XPAY-1432-2', 'browse/PAY-1432', 'PAY-1432-fix', '2PAY-1'])('leaves %s alone', (word) => {
    expect(tokens(`see ${word} now`)).toEqual([])
  })
})

describe('referenceFromUrl', () => {
  const sites = { gitlab: 'https://gitlab.com', jira: 'https://acme.atlassian.net' }

  it.each([
    ['https://gitlab.com/pay/api/-/merge_requests/809', 'pay/api!809'],
    ['https://gitlab.com/acme/payments/api/-/merge_requests/12/diffs?commit_id=abc#note_5', 'acme/payments/api!12'],
    ['  http://GitLab.com/pay/api/-/merge_requests/809/  ', 'pay/api!809'],
    ['https://acme.atlassian.net/browse/PAY-1432', 'PAY-1432'],
    ['https://acme.atlassian.net/browse/PAY-1432?focusedCommentId=1', 'PAY-1432'],
  ])('turns %s into %s', (url, token) => {
    expect(referenceFromUrl(url, sites)?.token).toBe(token)
  })

  it('reads MR URLs under a base URL with a path', () => {
    expect(referenceFromUrl('https://code.acme.io/gitlab/pay/api/-/merge_requests/3', { gitlab: 'https://code.acme.io/gitlab/' })).toEqual({
      token: 'pay/api!3',
      reference: { kind: 'mr', project: 'pay/api', iid: 3 },
    })
  })

  it.each([
    'https://gitlab.example.com/pay/api/-/merge_requests/809',
    'https://gitlab.com/pay/api/-/issues/809',
    'https://gitlab.com/-/merge_requests/809',
    'https://other.atlassian.net/browse/PAY-1432',
    'https://acme.atlassian.net/browse/pay-1432',
    'see https://gitlab.com/pay/api/-/merge_requests/809',
    'not a url',
  ])('leaves %s alone', (url) => {
    expect(referenceFromUrl(url, sites)).toBeUndefined()
  })

  it('needs the site it is under', () => {
    expect(referenceFromUrl('https://gitlab.com/pay/api/-/merge_requests/809', {})).toBeUndefined()
    expect(referenceFromUrl('https://acme.atlassian.net/browse/PAY-1432', { gitlab: 'https://gitlab.com' })).toBeUndefined()
  })
})

describe('referenceUrl', () => {
  it('opens an MR under gitlab.base_url and a Jira issue under jira.site', () => {
    const sites = { gitlab: 'https://code.acme.io/gitlab/', jira: 'https://acme.atlassian.net' }
    expect(referenceUrl({ kind: 'mr', project: 'pay/api', iid: 3 }, sites)).toBe('https://code.acme.io/gitlab/pay/api/-/merge_requests/3')
    expect(referenceUrl({ kind: 'jira', key: 'PAY-1' }, sites)).toBe('https://acme.atlassian.net/browse/PAY-1')
    expect(referenceUrl({ kind: 'jira', key: 'PAY-1' }, {})).toBeUndefined()
  })
})

describe('completedReferences', () => {
  const openMergeRequests = ['pay/api!809', 'pay/web!810', 'pay/web!77', 'ops/infra!77']

  it.each([' ', ',', '.', ';', ':', ')', '?', '!', '\n'])('takes a token followed by %j', (after) => {
    expect(completedReferences(`Rebase pay/api!809${after}`, { openMergeRequests }).map((found) => found.token)).toEqual(['pay/api!809'])
    expect(completedReferences(`For PAY-1432${after}`, { openMergeRequests }).map((found) => found.token)).toEqual(['PAY-1432'])
  })

  it('waits while the token may still be typed', () => {
    expect(completedReferences('Rebase pay/api!809', { openMergeRequests })).toEqual([])
    expect(completedReferences('For PAY-14', { openMergeRequests })).toEqual([])
  })

  it('takes any MR or Jira token, open or not', () => {
    expect(completedReferences('old/repo!1 OPS-9 ', { openMergeRequests }).map((found) => found.token)).toEqual(['old/repo!1', 'OPS-9'])
  })

  it('reads !<iid> as the one open MR with that iid', () => {
    expect(completedReferences('Rebase !809 now', { openMergeRequests })).toEqual([
      { token: 'pay/api!809', start: 7, end: 11, reference: { kind: 'mr', project: 'pay/api', iid: 809 } },
    ])
  })

  it('leaves !<iid> alone when no open MR, or several, have it', () => {
    expect(completedReferences('Rebase !5 and !77 now', { openMergeRequests })).toEqual([])
  })

  it('leaves !<iid> alone inside a word', () => {
    expect(completedReferences('wow!809 now', { openMergeRequests })).toEqual([])
  })
})

describe('suggestReferences', () => {
  const mergeRequests = [
    { reference: 'pay/api!809', title: 'Payment retry backoff' },
    { reference: 'pay/web!810', title: 'Checkout copy' },
    { reference: 'ops/infra!81', title: 'Bump runners' },
  ]
  const tickets = [
    { key: 'PAY-1432', summary: 'Retry failed payments', category: 'indeterminate' as const },
    { key: 'PAY-1500', summary: 'Refund emails', category: 'new' as const },
    { key: 'PAY-1401', summary: 'Old one', category: 'done' as const },
    { key: 'OPS-12', summary: 'Runner disk', category: 'new' as const },
  ]
  const suggest = (fragment: string) => suggestReferences(fragment, { mergeRequests, tickets }).map((suggestion) => suggestion.token)

  it('suggests every open MR after !', () => {
    expect(suggest('!')).toEqual(['pay/api!809', 'pay/web!810', 'ops/infra!81'])
  })

  it('matches an MR by the start of its iid', () => {
    expect(suggest('!81')).toEqual(['pay/web!810', 'ops/infra!81'])
  })

  it('matches an MR by a word of its title or its project, ignoring case', () => {
    expect(suggest('!retry')).toEqual(['pay/api!809'])
    expect(suggest('!INFRA')).toEqual(['ops/infra!81'])
  })

  it('says what each suggestion is', () => {
    expect(suggestReferences('!809', { mergeRequests, tickets })).toEqual([
      { kind: 'reference', token: 'pay/api!809', title: 'Payment retry backoff', reference: { kind: 'mr', project: 'pay/api', iid: 809 } },
    ])
  })

  it('suggests open sprint tickets after KEY-', () => {
    expect(suggest('PAY-')).toEqual(['PAY-1432', 'PAY-1500'])
    expect(suggest('PAY-14')).toEqual(['PAY-1432'])
    expect(suggestReferences('OPS-', { mergeRequests, tickets })).toEqual([
      { kind: 'reference', token: 'OPS-12', title: 'Runner disk', reference: { kind: 'jira', key: 'OPS-12' } },
    ])
  })

  it.each(['PAY', 'pay-', 'hello', '#pay', '', 'x!8'])('suggests nothing for %j', (fragment) => {
    expect(suggest(fragment)).toEqual([])
  })

  it('lists an MR once when I both review and authored it', () => {
    expect(suggestReferences('!809', { mergeRequests: [...mergeRequests, mergeRequests[0]!], tickets })).toHaveLength(1)
  })
})

const mr = (token: string): TextPiece => ({ kind: 'reference', token, reference: findReferences(token)[0]!.reference })
const text = (value: string): TextPiece => ({ kind: 'text', text: value })

describe('splitReferences and joinPieces', () => {
  it('splits a text into text and References', () => {
    expect(splitReferences('Rebase pay/api!809 for PAY-1432')).toEqual([text('Rebase '), mr('pay/api!809'), text(' for '), mr('PAY-1432')])
  })

  it.each(['Rebase pay/api!809 for PAY-1432', '(PAY-1), PAY-2.', 'PAY-1\nPAY-2 then pay/api!1!', 'nothing here', ''])(
    'joins %j back as it was',
    (value) => {
      expect(joinPieces(splitReferences(value))).toBe(value)
    },
  )

  it('gives a word touching a chip a space, so the token parses back', () => {
    expect(joinPieces([text('Rebase'), mr('pay/api!809'), text('now')])).toBe('Rebase pay/api!809 now')
    expect(joinPieces([mr('PAY-1'), mr('PAY-2'), mr('pay/api!3'), mr('pay/api!4')])).toBe('PAY-1 PAY-2 pay/api!3 pay/api!4')
    expect(joinPieces([text('a/'), mr('PAY-1'), text('-b')])).toBe('a/ PAY-1 -b')
  })

  it('keeps punctuation touching a chip as typed', () => {
    expect(joinPieces([text('('), mr('PAY-1'), text('), '), mr('pay/api!3'), text('.')])).toBe('(PAY-1), pay/api!3.')
  })
})
