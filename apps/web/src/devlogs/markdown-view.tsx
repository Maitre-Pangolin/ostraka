// Markdown shown read-only, as plain elements styled by `.ostraka-md` in index.css. Parsed by core (the same parser
// the house style writes with); raw HTML shows as text, and only web and mail links become links. A Todo link,
// `[title](todo:<id>)`, is drawn by the app (`todoLink`), so it can show the Todo's current title, and so is plain
// text (`text`), so References show as chips.
import { parseMarkdown, type MarkdownNode } from '@ostraka/core/markdown'
import { Fragment, type ReactNode } from 'react'

export type TodoLinkRenderer = (id: string, storedText: string) => ReactNode

/** Plain text as shown, outside code and link text: References as chips (`ReferenceText`), later Mentions. */
export type TextRenderer = (text: string) => ReactNode

type Renderers = { todoLink: TodoLinkRenderer; text: TextRenderer }

const asIs: TextRenderer = (text) => text

const TODO_LINK = /^todo:([a-z0-9]+)$/i
const SAFE_LINK = /^(https?:|mailto:)/i

/** The plain text of a node, for a Todo link's stored title. */
const textOf = (node: MarkdownNode): string =>
  'value' in node ? node.value : 'children' in node ? (node.children as MarkdownNode[]).map(textOf).join('') : ''

function render(nodes: MarkdownNode[], renderers: Renderers): ReactNode[] {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, renderers)}</Fragment>)
}

function renderNode(node: MarkdownNode, renderers: Renderers): ReactNode {
  const children = (inner = renderers) => ('children' in node ? render(node.children as MarkdownNode[], inner) : null)
  switch (node.type) {
    case 'heading': {
      const Heading = `h${node.depth}` as const
      return <Heading>{children()}</Heading>
    }
    case 'paragraph':
      return <p>{children()}</p>
    case 'text':
      return renderers.text(node.value)
    case 'html':
      return node.value
    case 'emphasis':
      return <em>{children()}</em>
    case 'strong':
      return <strong>{children()}</strong>
    case 'delete':
      return <del>{children()}</del>
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'code':
      return (
        <pre>
          <code>{node.value}</code>
        </pre>
      )
    case 'break':
      return <br />
    case 'thematicBreak':
      return <hr />
    case 'blockquote':
      return <blockquote>{children()}</blockquote>
    case 'list':
      return node.ordered ? <ol start={node.start ?? undefined}>{children()}</ol> : <ul>{children()}</ul>
    case 'listItem': {
      // A tight list item's paragraphs read as its text, without paragraph spacing.
      const content = node.spread
        ? children()
        : node.children.map((child, index) => (
            <Fragment key={index}>{child.type === 'paragraph' ? render(child.children, renderers) : renderNode(child, renderers)}</Fragment>
          ))
      if (node.checked === null || node.checked === undefined) return <li>{content}</li>
      return (
        <li>
          <input type="checkbox" disabled checked={node.checked} /> {content}
        </li>
      )
    }
    case 'link': {
      const todo = TODO_LINK.exec(node.url)?.[1]
      if (todo) return renderers.todoLink(todo, textOf(node))
      if (!SAFE_LINK.test(node.url)) return children()
      // A link's text stays text: a chip's hover card can't sit inside a link.
      return (
        <a href={node.url} target="_blank" rel="noreferrer">
          {children({ ...renderers, text: asIs })}
        </a>
      )
    }
    case 'image':
      return node.alt ?? ''
    case 'table': {
      const [head, ...body] = node.children
      return (
        <table>
          <thead>
            {head && (
              <tr>
                {head.children.map((cell, index) => (
                  <th key={index}>{render(cell.children, renderers)}</th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>
                {row.children.map((cell, cellIndex) => (
                  <td key={cellIndex}>{render(cell.children, renderers)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    default:
      return 'children' in node ? children() : 'value' in node ? String(node.value) : null
  }
}

/** A Markdown body rendered read-only. */
export function MarkdownView({ markdown, todoLink, text = asIs }: { markdown: string; todoLink: TodoLinkRenderer; text?: TextRenderer }) {
  return <>{render(parseMarkdown(markdown).children, { todoLink, text })}</>
}
