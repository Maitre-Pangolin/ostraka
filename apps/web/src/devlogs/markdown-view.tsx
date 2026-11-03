// Markdown shown read-only, as plain elements styled by `.ostraka-md` in index.css. Parsed by core (the same parser
// the house style writes with); raw HTML shows as text, and only web and mail links become links. A Todo link,
// `[title](todo:<id>)`, is drawn by the app (`todoLink`), so it can show the Todo's current title. So is a Mention,
// `@<person id>` in the text (`mention`), so it can show the Person's current name; without one it stays text.
import { parseMarkdown, type MarkdownNode } from '@ostraka/core/markdown'
import { findMentions } from '@ostraka/core/mentions'
import { Fragment, type ReactNode } from 'react'

export type TodoLinkRenderer = (id: string, storedText: string) => ReactNode
export type MentionRenderer = (id: string) => ReactNode

/** What the app draws itself inside the Markdown. */
type AppRenderers = { todoLink: TodoLinkRenderer; mention?: MentionRenderer }

const TODO_LINK = /^todo:([a-z0-9]+)$/i
const SAFE_LINK = /^(https?:|mailto:)/i

/** The plain text of a node, for a Todo link's stored title. */
const textOf = (node: MarkdownNode): string =>
  'value' in node ? node.value : 'children' in node ? (node.children as MarkdownNode[]).map(textOf).join('') : ''

function render(nodes: MarkdownNode[], app: AppRenderers): ReactNode[] {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, app)}</Fragment>)
}

/** Text with each Mention drawn by the app. */
function renderText(text: string, mention: MentionRenderer | undefined): ReactNode {
  const found = mention ? findMentions(text) : []
  if (!found.length) return text
  const pieces: ReactNode[] = []
  let at = 0
  for (const { start, end, id } of found) {
    pieces.push(text.slice(at, start), <Fragment key={start}>{mention!(id)}</Fragment>)
    at = end
  }
  pieces.push(text.slice(at))
  return pieces
}

function renderNode(node: MarkdownNode, app: AppRenderers): ReactNode {
  const children = () => ('children' in node ? render(node.children as MarkdownNode[], app) : null)
  switch (node.type) {
    case 'heading': {
      const Heading = `h${node.depth}` as const
      return <Heading>{children()}</Heading>
    }
    case 'paragraph':
      return <p>{children()}</p>
    case 'text':
      return renderText(node.value, app.mention)
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
            <Fragment key={index}>{child.type === 'paragraph' ? render(child.children, app) : renderNode(child, app)}</Fragment>
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
      if (todo) return app.todoLink(todo, textOf(node))
      if (!SAFE_LINK.test(node.url)) return children()
      return (
        <a href={node.url} target="_blank" rel="noreferrer">
          {children()}
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
                  <th key={index}>{render(cell.children, app)}</th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>
                {row.children.map((cell, cellIndex) => (
                  <td key={cellIndex}>{render(cell.children, app)}</td>
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
export function MarkdownView({ markdown, ...app }: { markdown: string } & AppRenderers) {
  return <>{render(parseMarkdown(markdown).children, app)}</>
}
