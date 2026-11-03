// The chip editor's rules, on its ProseMirror state without a view: plain text in, chips while editing, plain text out.
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { chipEditorState, docToText, settle, textToDoc } from '../src/todos/token-doc.ts'

// Monday 2 November 2026.
const today = '2026-11-02'
const openMergeRequests = ['pay/api!809', 'pay/web!77', 'ops/infra!77']
// The People directory: only these ids are Persons.
const isPerson = (id: string) => ['bram', 'ilse-vantongeren'].includes(id)

/** The doc's inline content per paragraph: text as is, a chip as [token], a Mention chip as [@id]. */
function shape(state: EditorState): string[] {
  const lines: string[] = []
  state.doc.forEach((para) => {
    let line = ''
    para.forEach((node) => (line += node.isText ? node.text : `[${node.attrs.token ?? `@${node.attrs.id}`}]`))
    lines.push(line)
  })
  return lines
}

/** Types `text` at the caret, one character at a time, settling after each like the editor does. */
function type(state: EditorState, text: string, { pullProps = true, isPerson = (_id: string) => false } = {}) {
  const props: object[] = []
  for (const char of text) {
    const typed = state.apply(state.tr.insertText(char))
    const settled = settle(typed, { today, openMergeRequests, pullProps, isPerson })
    state = settled ? typed.apply(settled.tr) : typed
    if (settled && settled.props) props.push(settled.props)
  }
  return { state, props }
}

const caretText = (state: EditorState) => {
  const text = docToText(state.doc)
  const before = docToText(state.doc.cut(0, state.selection.from))
  return `${text.slice(0, before.length)}|${text.slice(before.length)}`
}

describe('textToDoc and docToText', () => {
  it('opens References as chips and saves them as their tokens', () => {
    const doc = textToDoc('Rebase pay/api!809 for PAY-1432\nthen ship')
    expect(shape(EditorState.create({ doc }))).toEqual(['Rebase [pay/api!809] for [PAY-1432]', 'then ship'])
    expect(docToText(doc)).toBe('Rebase pay/api!809 for PAY-1432\nthen ship')
  })

  it('opens Mentions of known Persons as chips, keeps the others as text, and saves them as @<person id>', () => {
    const doc = textToDoc('Ask @bram and @quentin about PAY-1', { isPerson })
    expect(shape(EditorState.create({ doc }))).toEqual(['Ask [@bram] and @quentin about [PAY-1]'])
    expect(docToText(doc)).toBe('Ask @bram and @quentin about PAY-1')
  })

  it('gives a word touching a Mention chip a space on save', () => {
    let state = chipEditorState('@bram', [], { isPerson })
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)).insertText('ok'))
    expect(shape(state)).toEqual(['[@bram]ok'])
    expect(docToText(state.doc)).toBe('@bram ok')
  })

  it('gives a word touching a chip a space on save, so the token parses back', () => {
    let state = chipEditorState('PAY-1432')
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)).insertText('fix'))
    state = state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)).insertText('Do'))
    expect(shape(state)).toEqual(['Do[PAY-1432]fix'])
    expect(docToText(state.doc)).toBe('Do PAY-1432 fix')
  })
})

describe('settle', () => {
  it('turns a complete token into a chip once a space or punctuation follows', () => {
    const { state } = type(chipEditorState(''), 'Rebase pay/api!809, then PAY-1432 now')
    expect(shape(state)).toEqual(['Rebase [pay/api!809], then [PAY-1432] now'])
    expect(caretText(state)).toBe('Rebase pay/api!809, then PAY-1432 now|')
  })

  it('leaves a token being typed as text', () => {
    expect(shape(type(chipEditorState(''), 'For PAY-14').state)).toEqual(['For PAY-14'])
  })

  it('turns !<iid> into the one open MR with that iid, and leaves an ambiguous one', () => {
    expect(shape(type(chipEditorState(''), 'Rebase !809 and !77 ').state)).toEqual(['Rebase [pay/api!809] and !77 '])
  })

  it('pulls completed #tag, *prio and ^date out of the text, keeping the caret in place', () => {
    const { state, props } = type(chipEditorState(''), 'Fix #auth PAY-1 *high now')
    expect(shape(state)).toEqual(['Fix [PAY-1] now'])
    expect(props).toEqual([{ tags: ['auth'] }, { tags: [], priority: 'high' }])
    expect(caretText(state)).toBe('Fix PAY-1 now|')
  })

  it('leaves property tokens in the text when told not to pull them', () => {
    expect(shape(type(chipEditorState(''), 'Fix #auth ', { pullProps: false }).state)).toEqual(['Fix #auth '])
  })

  it('turns a known @<person id> into a Mention chip on a space, and leaves an unknown one as text', () => {
    const { state } = type(chipEditorState(''), 'Ask @bram, @quentin and @bram-x ', { isPerson })
    expect(shape(state)).toEqual(['Ask [@bram], @quentin and @bram-x '])
    expect(docToText(state.doc)).toBe('Ask @bram, @quentin and @bram-x ')
  })

  it('changes nothing when nothing completed', () => {
    const state = chipEditorState('Rebase PAY-1')
    expect(settle(state, { today, openMergeRequests, pullProps: true })).toBeUndefined()
  })
})
