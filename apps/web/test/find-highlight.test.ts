// @vitest-environment jsdom
// Where a section search's matches are painted in a view: in its text, and on the chips that show a Mention or a
// Reference as something other than its token (a name, `!809`), matched by that token.
import { describe, expect, it } from 'vitest'
import { findRanges } from '../src/search/find-highlight.ts'

const view = (html: string) => {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

const found = (root: HTMLElement, query: string) => findRanges(root, query).map((range) => range.toString())

const ROW =
  'Ask <span data-mention-chip="jane-doe">Jane Doe</span> to rebase <span data-reference-chip="pay/api!809">!809</span> for PAY-1432'

describe('findRanges', () => {
  it('finds the query in the text shown', () => {
    expect(found(view(ROW), 'rebase pay-1432')).toEqual(['rebase', 'PAY-1432'])
  })

  it('finds a Mention typed whole on the chip showing the name, the whole chip', () => {
    expect(found(view(ROW), '@jane-doe')).toEqual(['Jane Doe'])
  })

  it('finds a Reference typed whole on the chip showing its number', () => {
    expect(found(view(ROW), 'pay/api!809')).toEqual(['!809'])
  })

  it('paints a chip matched by its token once, in document order with the text matches', () => {
    expect(found(view(ROW), 'jane ask')).toEqual(['Ask', 'Jane Doe'])
  })

  it('leaves a chip whose token does not match', () => {
    expect(found(view(ROW), '@john-smith web/app!809')).toEqual([])
  })

  it('leaves fields and the server’s own marks to themselves', () => {
    expect(found(view('<input value="jane"><mark>Jane</mark> <textarea>jane</textarea>'), 'jane')).toEqual([])
  })
})
