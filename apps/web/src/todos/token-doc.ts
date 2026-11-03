// The chip editor's model, free of the DOM: a ProseMirror document of plain text with an atomic chip per Reference
// and per Mention of a known Person. Text opens with those as chips and saves back as plain text (`joinPieces` from
// core). While typing, `settle` turns completed References and Mentions into chips and pulls completed `#tag`,
// `*prio` and `^date` out of the text. A Mention of an id not in the People directory stays text.
import { completedMentions } from '@ostraka/core/mentions'
import { completedReferences, joinPieces, parseReference, splitChips, type TextPiece } from '@ostraka/core/references'
import { pullCompletedTokens, type TokenProps } from '@ostraka/core/todo-tokens'
import { Schema, type Node } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, type Plugin, type Transaction } from '@milkdown/kit/prose/state'

export const chipSchema = new Schema({
  nodes: {
    doc: { content: 'para+' },
    para: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    reference: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { token: {} },
      // Copied or read as text, a chip is its token.
      leafText: (node) => node.attrs.token as string,
      toDOM: (node) => ['span', { 'data-reference': node.attrs.token }, node.attrs.token],
      parseDOM: [{ tag: 'span[data-reference]', getAttrs: (dom) => ({ token: (dom as HTMLElement).dataset.reference }) }],
    },
    mention: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { id: {} },
      // Copied or read as text, a Mention is `@<person id>`.
      leafText: (node) => `@${node.attrs.id as string}`,
      toDOM: (node) => ['span', { 'data-mention': node.attrs.id }, `@${node.attrs.id as string}`],
      parseDOM: [{ tag: 'span[data-mention]', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.mention }) }],
    },
  },
})

/** A chip for a Reference token. */
export const referenceNode = (token: string) => chipSchema.nodes.reference!.create({ token })

/** A chip for a Mention of the Person `id`. */
export const mentionNode = (id: string) => chipSchema.nodes.mention!.create({ id })

const pieceNode = (piece: TextPiece) =>
  piece.kind === 'text' ? chipSchema.text(piece.text) : piece.kind === 'mention' ? mentionNode(piece.id) : referenceNode(piece.token)

/** Which ids are Persons in the People directory: only their Mentions become chips. */
export type PeopleOptions = { isPerson?: (id: string) => boolean }

const nobody = () => false

/** Plain text as a document: one paragraph per line, a chip per Reference and per Mention of a known Person. */
export function textToDoc(text: string, { isPerson = nobody }: PeopleOptions = {}): Node {
  const para = chipSchema.nodes.para!
  return chipSchema.nodes.doc!.create(
    null,
    text.split('\n').map((line) => para.create(null, splitChips(line, { isPerson }).map(pieceNode))),
  )
}

function pieces(para: Node): TextPiece[] {
  const found: TextPiece[] = []
  para.forEach((node) => {
    if (node.isText) found.push({ kind: 'text', text: node.text ?? '' })
    else if (node.type.name === 'mention') found.push({ kind: 'mention', token: `@${node.attrs.id as string}`, id: node.attrs.id })
    else found.push({ kind: 'reference', token: node.attrs.token, reference: parseReference(node.attrs.token)! })
  })
  return found
}

/** The document as plain text to save: chips as their tokens, a space wherever a word touches one. */
export function docToText(doc: Node): string {
  const lines: string[] = []
  doc.forEach((para) => lines.push(joinPieces(pieces(para))))
  return lines.join('\n')
}

/** A fresh state for `text`, the caret at its end. */
export function chipEditorState(text: string, plugins: readonly Plugin[] = [], people: PeopleOptions = {}): EditorState {
  const doc = textToDoc(text, people)
  return EditorState.create({ doc, plugins, selection: TextSelection.atEnd(doc) })
}

export type SettleOptions = {
  today: string
  /** My open MRs' tokens, so a typed `!<iid>` finds its one MR. */
  openMergeRequests: string[]
  /** Whether completed `#tag`, `*prio` and `^date` leave the text (they do in Todos). */
  pullProps: boolean
} & PeopleOptions

const hasProps = (props: TokenProps) => props.tags.length > 0 || props.priority !== undefined || props.due !== undefined

/**
 * After an edit: completed property tokens leave the text and completed References become chips, the caret staying
 * where it was in the text. Undefined when nothing completed; otherwise the change and the properties pulled out.
 */
export function settle(state: EditorState, options: SettleOptions): { tr: Transaction; props?: TokenProps } | undefined {
  const tr = state.tr
  const caret = state.selection.empty ? state.selection.from : undefined
  let caretAfter: number | undefined
  let props: TokenProps | undefined

  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    let text = node.text ?? ''
    const inNode = caret !== undefined && caret >= pos && caret <= pos + text.length
    let at = inNode ? caret - pos : text.length

    if (options.pullProps) {
      const { text: rest, caret: moved, ...pulled } = pullCompletedTokens(text, { today: options.today, caret: at })
      if (hasProps(pulled)) {
        props = {
          tags: [...new Set([...(props?.tags ?? []), ...pulled.tags])],
          ...((pulled.priority ?? props?.priority) && { priority: pulled.priority ?? props?.priority }),
          ...((pulled.due ?? props?.due) && { due: pulled.due ?? props?.due }),
        }
        text = rest
        at = moved
      }
    }

    const chips = [
      ...completedReferences(text, { openMergeRequests: options.openMergeRequests }).map((found) => ({ ...found, node: referenceNode(found.token) })),
      ...completedMentions(text, options.isPerson ?? nobody).map((found) => ({ ...found, node: mentionNode(found.id) })),
    ].toSorted((a, b) => a.start - b.start)
    if (text === node.text && !chips.length) return

    const nodes: Node[] = []
    let last = 0
    let shrink = 0
    let caretInToken: number | undefined
    for (const found of chips) {
      if (found.start < last) continue
      if (found.start > last) nodes.push(chipSchema.text(text.slice(last, found.start)))
      nodes.push(found.node)
      if (at >= found.end) shrink += found.end - found.start - 1
      else if (at > found.start) caretInToken = found.start - shrink + 1
      last = found.end
    }
    if (last < text.length) nodes.push(chipSchema.text(text.slice(last)))

    const from = tr.mapping.map(pos)
    tr.replaceWith(from, tr.mapping.map(pos + node.nodeSize), nodes)
    if (inNode) caretAfter = from + (caretInToken ?? at - shrink)
  })

  if (!tr.docChanged) return undefined
  if (caretAfter !== undefined) tr.setSelection(TextSelection.create(tr.doc, caretAfter))
  return { tr, ...(props && { props }) }
}
