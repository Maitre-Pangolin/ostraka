// Round-trip samples from the rich-markdown-editor research (#14), shared by core's serializer test and the web
// app's Milkdown round-trip test.

/** An agent-style Note body: every construct the house style rewrites, plus content an editor tends to lose. */
export const AGENT_STYLE = `Intro with __strong__, _emphasis_ and a bare URL https://example.com.

Release plan
------------

* first
    * nested four spaces
* [ ] a task

1) one
2) two

| Name | Done |
|:--|---|
| ship | yes |

***

<!-- kept as written -->
Press <kbd>⌘K</kbd> to search.[^1]

[^1]: A footnote.

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`

/** The same body in house style: what one save through the serializer writes. */
export const HOUSE_STYLE_BODY = `Intro with **strong**, *emphasis* and a bare URL <https://example.com>.

## Release plan

- first
  - nested four spaces
- [ ] a task

1. one
2. two

| Name | Done |
| :--- | ---- |
| ship | yes  |

---

<!-- kept as written -->

Press <kbd>⌘K</kbd> to search.[^1]

[^1]: A footnote.

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`
