// A Dev log is read, not edited, by default: its Markdown renders as plain HTML, and a Todo link shows whatever the
// app passes for it (the Todo's current title), never the stale text stored in the file.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from '../src/devlogs/markdown-view.tsx'

const render = (markdown: string, todoLink = (id: string, text: string) => <b data-todo={id}>{text}</b>) =>
  renderToStaticMarkup(<MarkdownView markdown={markdown} todoLink={todoLink} />)

const mention = (id: string) => <i data-person={id}>{id}</i>

describe('MarkdownView', () => {
  it('renders sections, lists and inline formatting', () => {
    expect(render('## Done\n\n- Shipped *it* with **care** and `code`\n')).toBe(
      '<h2>Done</h2><ul><li>Shipped <em>it</em> with <strong>care</strong> and <code>code</code></li></ul>',
    )
  })

  it('hands a Todo link to the app with its id and stored text', () => {
    expect(render('- [Old title](todo:k3f9x)\n', (id) => <b data-todo={id}>New title</b>)).toBe(
      '<ul><li><b data-todo="k3f9x">New title</b></li></ul>',
    )
  })

  it('opens web links in a new tab, and shows raw HTML and script links as text', () => {
    expect(render('[docs](https://example.com) <img src=x onerror=alert(1)> [bad](javascript:alert(1))\n')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noreferrer">docs</a> &lt;img src=x onerror=alert(1)&gt; bad</p>',
    )
  })

  it('renders tables, task lists and code blocks', () => {
    expect(render('| A |\n| - |\n| 1 |\n\n- [x] done\n\n```ts\nconst a = 1\n```\n')).toBe(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>' +
        '<ul><li><input type="checkbox" disabled="" checked=""/> done</li></ul>' +
        '<pre><code>const a = 1</code></pre>',
    )
  })

  it('hands each Mention in the text to the app, and leaves code and emails alone', () => {
    expect(
      renderToStaticMarkup(
        <MarkdownView
          markdown={'- 1:1 with @ilse-vantongeren and **@bram**, mailed bram@corp.example `@bram`\n'}
          todoLink={() => null}
          mention={mention}
        />,
      ),
    ).toBe(
      '<ul><li>1:1 with <i data-person="ilse-vantongeren">ilse-vantongeren</i> and <strong><i data-person="bram">bram</i></strong>, ' +
        'mailed <a href="mailto:bram@corp.example" target="_blank" rel="noreferrer">bram@corp.example</a> <code>@bram</code></li></ul>',
    )
  })

  it('keeps Mentions as text without a renderer', () => {
    expect(render('Ask @bram\n')).toBe('<p>Ask @bram</p>')
  })
})
