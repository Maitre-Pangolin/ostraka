// A Dev log is read, not edited, by default: its Markdown renders as plain HTML, and a Todo link shows whatever the
// app passes for it (the Todo's current title), never the stale text stored in the file.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from '../src/devlogs/markdown-view.tsx'

const render = (markdown: string, todoLink = (id: string, text: string) => <b data-todo={id}>{text}</b>) =>
  renderToStaticMarkup(<MarkdownView markdown={markdown} todoLink={todoLink} />)

const bracketTickets = (text: string) => text.replaceAll(/PAY-\d+/g, (token) => `[${token}]`)

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

  it('hands plain text to the app, so References show as chips, but not code or link text', () => {
    expect(
      renderToStaticMarkup(
        <MarkdownView
          markdown={'## PAY-1\n\n- Fixed PAY-2 with `PAY-3`, see [PAY-4](https://x.test)\n\n```\nPAY-5\n```\n'}
          todoLink={() => null}
          text={bracketTickets}
        />,
      ),
    ).toBe(
      '<h2>[PAY-1]</h2><ul><li>Fixed [PAY-2] with <code>PAY-3</code>, see ' +
        '<a href="https://x.test" target="_blank" rel="noreferrer">PAY-4</a></li></ul><pre><code>PAY-5</code></pre>',
    )
  })
})
