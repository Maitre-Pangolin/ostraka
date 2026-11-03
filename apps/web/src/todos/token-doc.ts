// The chip editor's model, free of the DOM: a ProseMirror document of plain text with an atomic chip per Reference.
// Text opens with every Reference as a chip and saves back as plain text (`joinPieces` from core). While typing,
// `settle` turns completed References into chips and pulls completed `#tag`, `*prio` and `^date` out of the text.
// Mentions (#47) become one more chip node here, and one more kind in core's `TextPiece`.
import { completedReferences, joinPieces, parseReference, splitReferences, type TextPiece } from '@ostraka/core/references'
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
  },
})

/** A chip for a Reference token. */
export const referenceNode = (token: string) => chipSchema.nodes.reference!.create({ token })

const pieceNode = (piece: TextPiece) => (piece.kind === 'text' ? chipSchema.text(piece.text) : referenceNode(piece.token))

/** Plain text as a document: one paragraph per line, a chip per Reference. */
export function textToDoc(text: string): Node {
  const para = chipSchema.nodes.para!
  return chipSchema.nodes.doc!.create(
    null,
    text.split('\n').map((line) => para.create(null, splitReferences(line).map(pieceNode))),
  )
}

function pieces(para: Node): TextPiece[] {
  const found: TextPiece[] = []
  para.forEach((node) => {
    if (node.isText) found.push({ kind: 'text', text: node.text ?? '' })
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
export function chipEditorState(text: string, plugins: Plugin[] = []): EditorState {
  const doc = textToDoc(text)
  return EditorState.create({ doc, plugins, selection: TextSelection.atEnd(doc) })
}

export type SettleOptions = {
  today: string
  /** My open MRs' tokens, so a typed `!<iid>` finds its one MR. */
  openMergeRequests: string[]
  /** Whether completed `#tag`, `*prio` and `^date` leave the text (they do in Todos). */
  pullProps: boolean
}

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

    const references = completedReferences(text, { openMergeRequests: options.openMergeRequests })
    if (text === node.text && !references.length) return

    const nodes: Node[] = []
    let last = 0
    let shrink = 0
    let caretInToken: number | undefined
    for (const found of references) {
      if (found.start > last) nodes.push(chipSchema.text(text.slice(last, found.start)))
      nodes.push(referenceNode(found.token))
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
