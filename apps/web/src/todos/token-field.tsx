// A plain-text field (title or description) edited as a small ProseMirror editor, where References are atomic chips:
// typing next to one can't break it, Backspace removes it whole. Completed `#tag`, `*prio` and `^date` leave the text
// (picked from the suggestions with Tab or ↵, or followed by a space) and their values go to `onTokens`. A complete
// `pay/api!809`, `PAY-1432` or unique `!809` becomes a chip on a space or punctuation, and a pasted MR or Jira URL
// becomes its token. `@` suggests Persons from the People directory, and "Add Person" last for an id none matches; a
// Mention of one is a chip showing their name (a new one marked new, written when the text is saved).
// The value in and out is plain text; the model lives in `token-doc.ts`.
import { suggestPeople, type MentionSuggestion, type NewPersonSuggestion } from '@ostraka/core/mentions'
import { referenceFromUrl, suggestReferences, type ReferenceSuggestion } from '@ostraka/core/references'
import { suggestTokens, type TokenProps, type TokenSuggestion } from '@ostraka/core/todo-tokens'
import { baseKeymap, splitBlock } from '@milkdown/kit/prose/commands'
import { history, redo, undo } from '@milkdown/kit/prose/history'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { Node } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { usePeopleIndex } from '@/people/api'
import { MentionChip, MentionSuggestionLabel } from '@/people/mention-chip'
import { markNewPerson, useNewPeople } from '@/people/new-people'
import { useReferenceIndex, useReferenceSites } from '@/references/api'
import { ReferenceChip, ReferenceSuggestionLabel } from '@/references/reference-chip'
import { longDate, useToday } from './due'
import { PRIORITY_LABEL } from './priority'
import { PriorityFlag, TagPill } from './properties'
import { chipEditorState, docToText, mentionNode, referenceNode, settle } from './token-doc'

export type TokenFieldProps = {
  value: string
  onChange: (text: string) => void
  /** Properties set by tokens that just left the text. */
  onTokens: (props: TokenProps) => void
  /** ↵ (`shift: false`) or ⇧↵ (`shift: true`). Return true when handled; an unhandled ⇧↵ in a multiline field is a new line. */
  onEnter?: (key: { shift: boolean }) => boolean
  onBlur?: () => void
  /** Tags in use, for `#` suggestions; `exclude` those the Todo already has. */
  tags: string[]
  exclude?: string[]
  multiline?: boolean
  autoFocus?: boolean
  placeholder?: string
  'aria-label': string
  className?: string
}

type Suggestion = TokenSuggestion | ReferenceSuggestion | MentionSuggestion | NewPersonSuggestion

/** The word before the caret: back to a space, a line start or a chip. */
function fragmentAt(state: EditorState): string {
  const { $from, empty } = state.selection
  if (!empty) return ''
  return /[^\s￼]*$/.exec($from.parent.textBetween(0, $from.parentOffset, undefined, '￼'))?.[0] ?? ''
}

/** A chip's DOM, filled by React through a portal so it shows live status (or a Person's name) and its hover card. */
type ChipView = { id: number; dom: HTMLElement } & ({ kind: 'reference'; token: string } | { kind: 'mention'; person: string })

let nextChipId = 0

export function TokenField({
  value,
  onChange,
  onTokens,
  onEnter,
  onBlur,
  tags,
  exclude,
  multiline,
  autoFocus,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: TokenFieldProps) {
  const mount = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const emitted = useRef(value)
  const [chips, setChips] = useState<ChipView[]>([])
  const [fragment, setFragment] = useState('')
  const typing = useRef('')
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const listId = useId()

  const today = useToday()
  const index = useReferenceIndex()
  const sites = useReferenceSites()
  const people = usePeopleIndex()
  const newPeople = useNewPeople()
  // New Persons picked in this window count as Persons until they are saved: suggested again and kept as chips.
  const candidates = useMemo(
    () => [...people.people, ...newPeople.filter((person) => !people.byId.has(person.id)).map((person) => ({ ...person, aliases: [] }))],
    [people, newPeople],
  )
  const isPerson = useMemo(() => {
    const ids = new Set(candidates.map((person) => person.id))
    return (id: string) => ids.has(id)
  }, [candidates])
  const suggestions: Suggestion[] =
    dismissed || !focused || !fragment
      ? []
      : [
          ...suggestTokens(fragment, { today, tags, exclude }),
          ...suggestReferences(fragment, index.candidates),
          ...suggestPeople(fragment, candidates, { offerNew: people.loaded }),
        ].slice(0, 8)
  const active = Math.min(selected, suggestions.length - 1)

  // The editor is made once; its handlers read the latest props and state through this ref.
  const latest = useRef({ onChange, onTokens, onEnter, onBlur, today, index, sites, isPerson, suggestions, active, multiline })
  useLayoutEffect(() => {
    latest.current = { onChange, onTokens, onEnter, onBlur, today, index, sites, isPerson, suggestions, active, multiline }
  })

  const pick = (suggestion: Suggestion) => {
    const editor = view.current
    if (!editor) return
    const { from } = editor.state.selection
    const start = from - fragmentAt(editor.state).length
    const tr = editor.state.tr
    if (suggestion.kind === 'reference') tr.replaceWith(start, from, [referenceNode(suggestion.token), editor.state.schema.text(' ')])
    else if (suggestion.kind === 'mention' || suggestion.kind === 'new-person') {
      if (suggestion.kind === 'new-person') markNewPerson({ id: suggestion.id, name: suggestion.name })
      tr.replaceWith(start, from, [mentionNode(suggestion.id), editor.state.schema.text(' ')])
    } else tr.insertText(`${suggestion.token} `, start, from)
    editor.dispatch(tr)
    setSelected(0)
  }
  const pickRef = useRef(pick)
  useLayoutEffect(() => {
    pickRef.current = pick
  })

  useEffect(() => {
    const popupOpen = () => latest.current.suggestions.length > 0
    const keys = keymap({
      Enter: () => {
        if (popupOpen()) return (pickRef.current(latest.current.suggestions[latest.current.active]!), true)
        latest.current.onEnter?.({ shift: false })
        return true
      },
      'Shift-Enter': (state, dispatch) =>
        latest.current.onEnter?.({ shift: true }) || !latest.current.multiline || splitBlock(state, dispatch),
      Tab: () => {
        if (!popupOpen()) return false
        pickRef.current(latest.current.suggestions[latest.current.active]!)
        return true
      },
      ArrowDown: () => {
        if (!popupOpen()) return false
        setSelected((latest.current.active + 1) % latest.current.suggestions.length)
        return true
      },
      ArrowUp: () => {
        if (!popupOpen()) return false
        const count = latest.current.suggestions.length
        setSelected((latest.current.active - 1 + count) % count)
        return true
      },
      Escape: (_state, _dispatch, editor) => {
        if (popupOpen()) setDismissed(true)
        else (editor?.dom as HTMLElement | undefined)?.blur()
        return true
      },
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
    })

    const chipView = (node: Node): NodeView => {
      const dom = document.createElement('span')
      dom.contentEditable = 'false'
      const chip: ChipView =
        node.type.name === 'mention'
          ? { id: nextChipId++, dom, kind: 'mention', person: node.attrs.id as string }
          : { id: nextChipId++, dom, kind: 'reference', token: node.attrs.token as string }
      setChips((current) => [...current, chip])
      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: () => false,
        destroy: () => setChips((current) => current.filter((other) => other !== chip)),
      }
    }

    const editor: EditorView = new EditorView(mount.current!, {
      state: chipEditorState(emitted.current, [history(), keys, keymap(baseKeymap)], { isPerson: latest.current.isPerson }),
      nodeViews: { reference: chipView, mention: chipView },
      // A title stays on one line, pasted line breaks included.
      transformPastedText: (text) => (latest.current.multiline ? text : text.replace(/\r?\n/g, ' ')),
      handlePaste: (current, event) => {
        const found = referenceFromUrl(event.clipboardData?.getData('text/plain') ?? '', latest.current.sites)
        if (!found) return false
        const { from, to } = current.state.selection
        current.dispatch(current.state.tr.replaceWith(from, to, [referenceNode(found.token), current.state.schema.text(' ')]))
        return true
      },
      handleDOMEvents: {
        focus: () => {
          setFocused(true)
          return false
        },
        blur: () => {
          setFocused(false)
          setDismissed(false)
          latest.current.onBlur?.()
          return false
        },
      },
      dispatchTransaction(tr: Transaction) {
        let state = editor.state.apply(tr)
        if (tr.docChanged && !editor.composing) {
          const { today: day, index: known, isPerson: person } = latest.current
          const settled = settle(state, { today: day, openMergeRequests: known.openMergeRequests, pullProps: true, isPerson: person })
          if (settled) {
            state = state.apply(settled.tr)
            if (settled.props) latest.current.onTokens(settled.props)
          }
        }
        editor.updateState(state)
        const text = docToText(state.doc)
        if (text !== emitted.current) {
          emitted.current = text
          latest.current.onChange(text)
        }
        const next = fragmentAt(state)
        if (next !== typing.current) {
          typing.current = next
          setFragment(next)
          setSelected(0)
          setDismissed(false)
        }
      },
    })
    view.current = editor
    if (autoFocus) editor.focus()
    return () => {
      view.current = null
      editor.destroy()
    }
    // Made once per mount; `value` changes reach it through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A value set from outside (cleared after adding, the stored text refreshed) replaces what the editor holds.
  useEffect(() => {
    const editor = view.current
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.updateState(chipEditorState(value, [...editor.state.plugins], { isPerson: latest.current.isPerson }))
    typing.current = ''
    setFragment('')
  }, [value])

  // The People directory loaded or changed: Mentions of known Persons become chips, unless the field is being edited.
  useEffect(() => {
    const editor = view.current
    if (!editor || editor.hasFocus()) return
    editor.updateState(chipEditorState(emitted.current, [...editor.state.plugins], { isPerson }))
  }, [isPerson])

  // ARIA on ProseMirror's own element: a combobox whose listbox holds the suggestions.
  useLayoutEffect(() => {
    const dom = view.current?.dom
    if (!dom) return
    const attributes: Record<string, string | undefined> = {
      role: 'combobox',
      'aria-label': ariaLabel,
      'aria-multiline': String(Boolean(multiline)),
      'aria-autocomplete': 'list',
      'aria-expanded': String(suggestions.length > 0),
      'aria-controls': listId,
      'aria-activedescendant': suggestions.length ? `${listId}-${active}` : undefined,
    }
    for (const [name, attribute] of Object.entries(attributes)) {
      if (attribute === undefined) dom.removeAttribute(name)
      else dom.setAttribute(name, attribute)
    }
  })

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={mount}
        className={cn(
          'block w-full min-w-0 cursor-text [&_.ProseMirror]:wrap-break-word [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none',
          className,
        )}
      />
      {!value && placeholder && (
        <span
          aria-hidden
          className={cn(
            'text-muted-foreground pointer-events-none absolute inset-0 truncate whitespace-pre',
            className,
            'border-transparent bg-transparent',
          )}
        >
          {placeholder}
        </span>
      )}
      {chips.map((chip) =>
        createPortal(
          chip.kind === 'mention' ? <MentionChip id={chip.person} inEditor /> : <ReferenceChip token={chip.token} inEditor />,
          chip.dom,
          chip.id,
        ),
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!suggestions.length}
        className="bg-popover text-popover-foreground ring-foreground/10 absolute top-full left-0 z-30 mt-1 w-80 max-w-full rounded-lg p-1 shadow-md ring-1"
      >
        {suggestions.map((suggestion, at) => (
          <li
            key={suggestion.token}
            id={`${listId}-${at}`}
            role="option"
            aria-selected={at === active}
            // Keep focus in the field: pick on mouse down, before the field would blur.
            onMouseDown={(event) => {
              event.preventDefault()
              pick(suggestion)
            }}
            onMouseEnter={() => setSelected(at)}
            className={cn('flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm', at === active && 'bg-accent')}
          >
            <SuggestionLabel suggestion={suggestion} />
            {at === active && <kbd className="text-muted-foreground ml-auto text-[10px]">Tab</kbd>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SuggestionLabel({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.kind === 'mention' || suggestion.kind === 'new-person') return <MentionSuggestionLabel suggestion={suggestion} />
  if (suggestion.kind === 'reference') return <ReferenceSuggestionLabel suggestion={suggestion} />
  if (suggestion.kind === 'tag')
    return (
      <>
        <TagPill tag={suggestion.tag} />
        {'isNew' in suggestion && <span className="text-muted-foreground truncate text-xs">New Tag</span>}
      </>
    )
  if (suggestion.kind === 'priority')
    return (
      <>
        <PriorityFlag priority={suggestion.priority} />
        <span>{PRIORITY_LABEL[suggestion.priority]}</span>
        <span className="text-muted-foreground text-xs">{suggestion.token}</span>
      </>
    )
  return (
    <>
      <span>{suggestion.token}</span>
      <span className="text-muted-foreground truncate text-xs">{longDate(suggestion.due)}</span>
    </>
  )
}
