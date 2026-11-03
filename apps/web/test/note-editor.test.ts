// @vitest-environment jsdom
// The Milkdown round-trip harness from the rich-markdown-editor research (#14), run on the Notes editor as the app
// configures it: a body already in core's house style opens and serializes back byte-identical, so an editor save
// of an unchanged Note writes nothing new.
import { formatMarkdown } from '@ostraka/core/markdown'
import { suggestReferences, type ReferenceCandidates, type ReferenceSuggestion } from '@ostraka/core/references'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_STYLE, HOUSE_STYLE_BODY } from '../../../packages/core/test/markdown-samples.ts'
import { createNoteEditor, type NoteEditor } from '../src/notes/note-editor-setup.ts'
import { tokenHighlight } from '../src/notes/token-highlight.ts'
import { pickSuggestion, tokenSuggest, type OpenSuggestions } from '../src/notes/token-suggest.ts'
import { referenceHighlighter } from '../src/references/highlight.ts'

// jsdom has no layout, so no observers; code blocks only use them to render lazily.
class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.IntersectionObserver ??= NoObserver as unknown as typeof IntersectionObserver
globalThis.ResizeObserver ??= NoObserver as unknown as typeof ResizeObserver
// Nor any boxes, which ProseMirror asks for when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

let editor: NoteEditor | undefined

afterEach(async () => {
  await editor?.destroy()
  editor = undefined
})

async function open(markdown: string, options: Partial<Parameters<typeof createNoteEditor>[0]> = {}): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  editor = createNoteEditor({ root, markdown, ...options })
  await editor.create()
  return root
}

async function roundTrip(markdown: string): Promise<string> {
  await open(markdown)
  return editor!.getMarkdown()
}

/** A Note with References everywhere they may sit, and where they stay plain (code, link text). */
const WITH_REFERENCES = `# PAY-1432 retry

Rebased pay/api!812 for PAY-1432, then web/front-end/app!7 (see \`PAY-9\` and [PAY-10](https://jira.test/browse/PAY-10)).

- **PAY-77** blocked by ops/infra!3
- [ ] review pay/api!815

\`\`\`text
PAY-11 in a code block
\`\`\`
`

// A status dot per token, so the test sees which dot went where.
const highlight = tokenHighlight(() => [referenceHighlighter((token) => `dot-${token}`)])

describe('Notes editor round trip', () => {
  it('serializes a house-style body back byte-identical', async () => {
    expect(await roundTrip(HOUSE_STYLE_BODY)).toBe(HOUSE_STYLE_BODY)
  })

  it('loses no content from an agent-style body, and core writes what it serializes in the house style', async () => {
    expect(formatMarkdown(await roundTrip(AGENT_STYLE))).toBe(HOUSE_STYLE_BODY)
  })
})

describe('References in the Notes editor', () => {
  it('leaves a Note with References byte-identical', async () => {
    await open(WITH_REFERENCES, { plugins: [highlight] })
    expect(editor!.getMarkdown()).toBe(WITH_REFERENCES)
  })

  it('highlights each Reference in place with its status dot after it, but not in code or link text', async () => {
    const root = await open(WITH_REFERENCES, { plugins: [highlight] })
    const highlighted = [...root.querySelectorAll<HTMLElement>('[data-reference]')]
    expect(highlighted.map((element) => element.textContent)).toEqual([
      'PAY-1432',
      'pay/api!812',
      'PAY-1432',
      'web/front-end/app!7',
      'PAY-77',
      'ops/infra!3',
      'pay/api!815',
    ])
    expect(highlighted.map((element) => element.nextElementSibling?.className)).toEqual(
      highlighted.map((element) => expect.stringContaining(`dot-${element.textContent}`)),
    )
  })
})

const CANDIDATES: ReferenceCandidates = {
  mergeRequests: [
    { reference: 'pay/api!812', title: 'Retry failed payments' },
    { reference: 'pay/api!815', title: 'Refund webhooks' },
    { reference: 'web/app!90', title: 'Checkout page' },
  ],
  tickets: [
    { key: 'PAY-1432', summary: 'Retry payments', category: 'indeterminate' },
    { key: 'PAY-1500', summary: 'Shipped', category: 'done' },
  ],
}

/** Opens `markdown` with suggestions on, the caret at its end, and types `typed`. */
async function typeAtEnd(markdown: string, typed: string) {
  let offered: OpenSuggestions<ReferenceSuggestion> | undefined
  const suggest = tokenSuggest<ReferenceSuggestion>({
    suggest: (fragment) => suggestReferences(fragment, CANDIDATES),
    onChange: (next) => (offered = next),
  })
  await open(markdown, { plugins: [suggest] })
  const view = editor!.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).insertText(typed))
  return { view, current: () => offered }
}

describe('Reference suggestions in the Notes editor', () => {
  it('offers my open MRs after ! and a number, and picking one writes its token', async () => {
    const { view, current } = await typeAtEnd('Rebased\n', ' !81')
    expect(current()?.suggestions.map((suggestion) => suggestion.token)).toEqual(['pay/api!812', 'pay/api!815'])
    pickSuggestion(view, current()!, current()!.suggestions[1]!)
    expect(editor!.getMarkdown()).toBe('Rebased pay/api!815 \n')
    expect(current()).toBeUndefined()
  })

  it('offers open sprint tickets after a Jira key prefix', async () => {
    const { current } = await typeAtEnd('- fix\n', ' (PAY-')
    expect(current()?.suggestions.map((suggestion) => suggestion.token)).toEqual(['PAY-1432'])
  })

  it('offers nothing in code', async () => {
    const { current } = await typeAtEnd('```\nx\n```\n', ' !81')
    expect(current()).toBeUndefined()
  })
})
