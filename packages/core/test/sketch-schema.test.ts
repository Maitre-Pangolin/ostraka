import { describe, expect, it } from 'vitest'
import { parseSketchesView } from '../src/sketch-schema.ts'

describe('parseSketchesView', () => {
  it('keeps the open Sketch and the editor mode, leaving out defaults (no Sketch open, split)', () => {
    expect(parseSketchesView({ sketch: 'k3f9x', mode: 'code' })).toEqual({ sketch: 'k3f9x', mode: 'code' })
    expect(parseSketchesView({ sketch: 'k3f9x', mode: 'preview' })).toEqual({ sketch: 'k3f9x', mode: 'preview' })
    expect(parseSketchesView({ sketch: '', mode: 'split' })).toEqual({})
    expect(parseSketchesView({ sketch: 42, mode: 'canvas', other: 1 })).toEqual({})
  })
})
