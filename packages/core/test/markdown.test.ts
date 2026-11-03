import { describe, expect, it } from 'vitest'
import { formatMarkdown, joinFrontmatter, splitFrontmatter } from '../src/markdown.ts'
import { AGENT_STYLE, HOUSE_STYLE_BODY } from './markdown-samples.ts'

describe('splitFrontmatter', () => {
  it('splits the YAML header from the body, and re-attaches it byte-for-byte', () => {
    const header = '---\ntitle:   Release plan   # odd spacing kept\ntags: [work,  idea]\n---\n'
    const body = '# Release plan\n\nShip it.\n'
    const parts = splitFrontmatter(header + body)
    expect(parts).toEqual({ header, yaml: 'title:   Release plan   # odd spacing kept\ntags: [work,  idea]\n', body })
    expect(joinFrontmatter(parts.header, parts.body)).toBe(header + body)
  })

  it('keeps CRLF line endings and blank lines after the header as they are', () => {
    const text = '---\r\ntags: []\r\n---\r\n\r\nBody\r\n'
    const parts = splitFrontmatter(text)
    expect(parts.yaml).toBe('tags: []\r\n')
    expect(parts.body).toBe('\r\nBody\r\n')
    expect(joinFrontmatter(parts.header, parts.body)).toBe(text)
  })

  it('reads an empty header and a header closing at the end of the file', () => {
    expect(splitFrontmatter('---\n---\nBody\n')).toEqual({ header: '---\n---\n', yaml: '', body: 'Body\n' })
    expect(splitFrontmatter('---\ntags: []\n---')).toEqual({ header: '---\ntags: []\n---', yaml: 'tags: []\n', body: '' })
  })

  it('has no header when the file does not start with one, or never closes it', () => {
    expect(splitFrontmatter('# Title\n\n---\n')).toEqual({ header: '', yaml: undefined, body: '# Title\n\n---\n' })
    expect(splitFrontmatter('---\ntags: []\nno end\n')).toEqual({ header: '', yaml: undefined, body: '---\ntags: []\nno end\n' })
  })
})

describe('formatMarkdown', () => {
  it('writes a body in the house style, losing no content', () => {
    expect(formatMarkdown(AGENT_STYLE)).toBe(HOUSE_STYLE_BODY)
  })

  it('leaves a body already in the house style byte-identical', () => {
    expect(formatMarkdown(HOUSE_STYLE_BODY)).toBe(HOUSE_STYLE_BODY)
  })

  it('ends a non-empty body with exactly one line end, and leaves an empty body empty', () => {
    expect(formatMarkdown('Text')).toBe('Text\n')
    expect(formatMarkdown('Text\n\n\n')).toBe('Text\n')
    expect(formatMarkdown('')).toBe('')
    expect(formatMarkdown('\n\n')).toBe('')
  })
})
