import { describe, expect, it } from 'vitest'
import { parseNotesView } from '../src/note-schema.ts'

describe('parseNotesView', () => {
  it('keeps the open Note and the Ideas switch, leaving out defaults', () => {
    expect(parseNotesView({ note: 'k3f9x', ideas: true })).toEqual({ note: 'k3f9x', ideas: true })
    expect(parseNotesView({ ideas: false, note: '' })).toEqual({})
    expect(parseNotesView({ note: 42, ideas: 'yes', other: 1 })).toEqual({})
  })
})
