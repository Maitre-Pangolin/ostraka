// @vitest-environment jsdom
// The Milkdown round-trip harness from the rich-markdown-editor research (#14), run on the Notes editor as the app
// configures it: a body already in core's house style opens and serializes back byte-identical, so an editor save
// of an unchanged Note writes nothing new.
import { formatMarkdown } from '@ostraka/core/markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_STYLE, HOUSE_STYLE_BODY } from '../../../packages/core/test/markdown-samples.ts'
import { createNoteEditor, type NoteEditor } from '../src/notes/note-editor-setup.ts'

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

let editor: NoteEditor | undefined

afterEach(async () => {
  await editor?.destroy()
  editor = undefined
})

async function roundTrip(markdown: string): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  editor = createNoteEditor({ root, markdown })
  await editor.create()
  return editor.getMarkdown()
}

describe('Notes editor round trip', () => {
  it('serializes a house-style body back byte-identical', async () => {
    expect(await roundTrip(HOUSE_STYLE_BODY)).toBe(HOUSE_STYLE_BODY)
  })

  it('loses no content from an agent-style body, and core writes what it serializes in the house style', async () => {
    expect(formatMarkdown(await roundTrip(AGENT_STYLE))).toBe(HOUSE_STYLE_BODY)
  })
})
