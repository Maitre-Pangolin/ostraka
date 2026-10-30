# Rich editor for Notes that saves Markdown

Research for [issue #14](https://github.com/Maitre-Pangolin/ostraka/issues/14). Date: 2026-10-29.

## Question

Which embeddable rich-text editor lets a Note be edited Notion-style (toolbar, `/` block menu, keyboard shortcuts) while saving Markdown faithfully? Notes are Markdown files with YAML frontmatter in `~/ostraka-content`. Coding agents edit the same files, and every change is snapshotted in git. An editor that reformats a file on save therefore makes noisy history. Sketches are Mermaid code blocks. The front end is React with shadcn/ui (Base UI) and Tailwind v4.

## Answer

**Use Milkdown, through its Crepe editor (`@milkdown/crepe` plus `@milkdown/react`, MIT).**

- **Frontmatter:** split the YAML header off before the editor sees the file and put it back unchanged on save.
- **Serializer settings:** set Milkdown's remark serializer options to a fixed house style, such as `bullet: '-'` and `rule: '-'`.
- **One-time normalisation:** run every existing file through that same serializer once, in a single commit.
- **Agent writes:** run the serializer again whenever an agent writes a file, through the `ostraka` CLI or the snapshot step. After that, opening and saving a file in the editor changes nothing.
- **Write only on user edits:** the app writes a file only after the user has actually edited it, never just because it was opened.

Milkdown was the only candidate tested that kept HTML comments, inline HTML and footnotes. It was also the only one with all of these built in for free: a `/` menu, a selection toolbar, CodeMirror code blocks and an in-place preview hook (`renderPreview`) where Mermaid can render.

Runner-up: Tiptap 3 with `@tiptap/markdown`, MIT. It has a better React and shadcn story, but in testing it dropped content, its table output was off by one, and its Notion-like template is paid.

## What was verified and what was only read

**Verified by running code** (Node 25 + jsdom, latest npm versions on 2026-10-29, scripts in a scratch folder, not committed):

- Open+save round trip of one agent-style sample file in Milkdown 7.23.0, Tiptap 3.32.1 (`@tiptap/markdown`), Lexical 0.53.0 (`@lexical/markdown`), BlockNote 0.56.0 (`@blocknote/server-util`), and plain remark (`remark-parse` + `remark-gfm` + `remark-stringify`).
- Whether a second save is a no-op (idempotence).
- What each editor does with frontmatter passed in directly.
- Loss of HTML comments, inline HTML and footnotes in Milkdown and Tiptap.
- Milkdown's `remarkStringifyOptionsCtx` house-style setting.
- Package licences and versions on npm, and recent repository activity through the GitHub API.
- Milkdown/Crepe and MDXEditor APIs, read from their installed type declarations.

**Not run, taken from docs or package source:**

- MDXEditor round trip. It uses Lexical plus `mdast-util-to-markdown`, the same serializer family as the remark row, and its own API documents an `initialMarkdownNormalize` flag on `onChange`.
- Any UI behaviour: toolbars, the `/` menu, keyboard shortcuts, Mermaid rendering.
- Styling fit with Tailwind.

## Round-trip test

The sample was an agent-style Note: frontmatter, `*` bullets with a 4-space nested item, `1)` ordered items, `__strong__`, an unaligned GFM table with a `:--` alignment, a task list, a Mermaid fence, a setext heading, `***` rule, a bare URL, and a link with a title. Frontmatter was stripped before the editor and re-attached afterwards.

| Change on first open+save | remark (defaults) | Milkdown | Tiptap | Lexical | BlockNote |
|---|---|---|---|---|---|
| `__strong__` → `**strong**` | yes | **kept** (stores the marker per node) | yes | yes | yes |
| `*` bullets → other marker | `-` tasks → `*` | `-` tasks → `*` (configurable) | `*` → `-` | kept | `-` tasks → `*` |
| 4-space nested list → 2 spaces | yes | yes | yes | kept | yes |
| `1)` → `1.` | yes | yes | yes | kept | yes |
| Table re-padded and aligned | yes | yes | yes, but separator **off by one** | **not parsed** (left as text) | yes, and **alignment lost** |
| Setext → `##` | yes | yes | yes | not parsed (left as text) | yes |
| `***` rule | kept | kept (configurable) | → `---` | **corrupted to `\*\*\*`** (rule lost) | kept |
| Bare URL | → `<url>` | → `<url>` | → `[url](url)` | kept | kept |
| Link title | kept | kept | kept | kept | **dropped** |
| Soft line break | kept | kept | kept | kept | **turned into a hard break `\`** |
| Blank lines and EOF | kept | kept | extra blank lines, **no final newline** | no final newline | kept |
| Mermaid fence | kept | kept | kept | kept | kept |
| Second save is a no-op | yes | yes | yes | yes | yes |

Content loss test, Milkdown and Tiptap only. Input: `<kbd>` inline HTML, an HTML comment and a footnote.

- **Milkdown** kept all three byte-for-byte.
- **Tiptap** removed the `<kbd>` tags and the comment, and escaped the footnote into literal text (`\[^1\]`). Tiptap's docs say comments are not supported ([Tiptap Markdown docs](https://tiptap.dev/docs/editor/markdown)).

Frontmatter passed straight into the editor:

- **Milkdown** turned it into a thematic break plus a setext heading, with the YAML escaped.
- **Tiptap** turned it into `## title: …` with escaped brackets.

Neither handles frontmatter natively, so it must be stripped before the editor.

Milkdown with `remarkStringifyOptionsCtx` set to `{ bullet: '-', rule: '-' }`: a file already in that house style came back **byte-identical**. This is the property the mitigation relies on.

### What the results mean

No editor here gives byte-faithful round trips. Every one rebuilds Markdown from a document tree. Lexical changed the fewest bytes, but only because it doesn't parse tables or setext headings and leaves them as plain text. It also destroyed a horizontal rule. That is a missing feature, not fidelity.

What matters is two properties. First, the editor **loses no content** (Milkdown passes; Tiptap, BlockNote and Lexical fail in different ways). Second, it **reaches a stable output that you can configure** (all of them are idempotent; Milkdown and MDXEditor expose the remark/mdast serializer options). With both properties, a normalise-once policy makes later editor saves no-ops.

## Candidates

### Milkdown (recommended)

- **Model:** ProseMirror editing, remark parsing and serializing. Versions: `@milkdown/kit` / `@milkdown/crepe` 7.23.0, MIT on npm. The GitHub repo had about 12k stars and a push on 2026-10-28.
- **Fidelity:** the best of the tested editors (see the table). Remark stringify options can be set through `remarkStringifyOptionsCtx`, exported from `@milkdown/core` (checked in the code). Emphasis and strong markers are stored per node and preserved.
- **Frontmatter:** no built-in support; nothing frontmatter-related was found in `@milkdown/*`. Strip it and re-attach it outside the editor. Optionally show the parsed fields in a separate shadcn form above the editor.
- **Mermaid:** the code-block component's config has `renderPreview(language, content, applyPreview)`, `previewOnlyByDefault` and a preview toggle button (`@milkdown/components/lib/code-block/config.d.ts`). Return a Mermaid-rendered SVG when `language === 'mermaid'`, and you get the diagram in place with the CodeMirror source one toggle away. That fits the [Mermaid editing decision](https://github.com/Maitre-Pangolin/ostraka/issues/7) (split text plus live preview). The rendering itself was not run.
- **UI:** Crepe features (`CrepeFeature` enum in the types): `block-edit` (`/` menu and block handle), `toolbar` (selection toolbar), `top-bar`, `code-mirror`, `table`, `list-item`, `link-tooltip`, `placeholder`, `latex`, `image-block`, `ai`. Keyboard shortcuts come from the presets. Not exercised in a browser.
- **React and shadcn fit:** `@milkdown/react` exports `Milkdown`, `MilkdownProvider` and `useEditor` (peer dependency `react: *`). Crepe ships its own CSS themes, not shadcn components. Expect to restyle with CSS variables mapped to the shadcn tokens. Crepe depends on `vue` internally for its components, which adds bundle weight but stays hidden behind the API. Inferred from the dependency list; not measured.
- **Licence:** MIT throughout. No paid tier found.

### Tiptap 3 + `@tiptap/markdown` (runner-up)

- 3.32.1, MIT. GitHub repo about 39k stars and very active. The docs call the Markdown extension an early release that may change ([docs](https://tiptap.dev/docs/editor/markdown)). It parses with MarkedJS and serializes through per-extension render handlers.
- **Fidelity:** it loses content (HTML comments, inline HTML, footnotes). The table separator came out one dash too long, and the output had extra blank lines and no final newline. Serializer settings such as the bullet marker were not found in the docs.
- **UI:** the Simple Editor template is MIT ([docs](https://tiptap.dev/docs/ui-components/templates/simple-editor)). The Notion-like template, which has the `/` menu, floating toolbar and drag handle, "requires at least a Start plan subscription" ([docs](https://tiptap.dev/docs/ui-components/templates/notion-like-editor)). A free `/` menu is possible with the Suggestion utility, but you build it yourself.
- **Fit:** the best headless React story. Easy to style with Tailwind and shadcn.

### MDXEditor

- 4.3.4, MIT, about 3.7k stars, active. Built on Lexical 0.48 and mdast (dependencies on npm). It has a `frontmatterPlugin` with a key-value form ([docs](https://mdxeditor.dev/editor/docs/front-matter)) and depends on `js-yaml`. That suggests the YAML is re-dumped and that comments or flow style like `[work, idea]` may not survive. **Not verified.**
- `toMarkdownOptions` is exposed. The `onChange` signature carries `initialMarkdownNormalize`, documented as firing when loading changes "bullet symbols different than the configured ones" and similar (`dist/index.d.ts`). In other words it normalises on load, by design.
- It has a toolbar and Markdown shortcuts, and CodeMirror code blocks with custom code-block editors for Mermaid. No `/` menu plugin was found in the plugin list. It ships its own Radix-based styling.
- Strong runner-up if frontmatter editing in the UI matters more than a `/` menu.

### BlockNote

- 0.56.0. Core and `@blocknote/shadcn` are MPL-2.0. `@blocknote/shadcn` has a Tailwind `^4.1.12` peer dependency, which is a very good UI fit. Some `xl-*` packages (AI, multi-column) are "GPL-3.0 OR PROPRIETARY".
- **Rejected on fidelity:** the API is named `blocksToMarkdownLossy`, and the docs say Markdown import may drop information ([docs](https://www.blocknotejs.org/docs/features/import/markdown)). In testing it dropped link titles and table alignment and turned soft breaks into hard breaks. Its native format is block JSON, not Markdown.

### Lexical + `@lexical/markdown`

- 0.53.0, MIT, Meta. Still pre-1.0. The default `TRANSFORMERS` have no table or horizontal-rule transformer: the rule was corrupted and the table was left as text. You would have to assemble the toolbar, the `/` menu (typeahead plugin) and code blocks yourself. MDXEditor is essentially this work already done.

### Others considered briefly

- **`prosemirror-markdown`** (1.13.9, MIT; markdown-it based): the low-level option. You build everything Milkdown already gives.
- **CodeMirror 6 live-preview editor** (Obsidian style): byte-perfect, because the file *is* the text. But it is not the Notion-style rich editing the ticket asks for. A good fallback mode ("edit source") alongside the rich editor.

## Mitigation for the fidelity gap

1. **One serializer, one house style.** Configure Milkdown's `remarkStringifyOptionsCtx`, for example `{ bullet: '-', rule: '-', emphasis: '*', strong: '*' }`. Pick values close to what agents naturally write. Put the same `remark-parse` + `remark-gfm` + `remark-stringify` options into the shared code the app and the `ostraka` CLI use.
2. **Frontmatter outside the editor.** Split `^---\n…\n---\n` off on load and re-attach it byte-for-byte on save. The app edits frontmatter fields, such as Tags, through the shared code, not the editor.
3. **Normalise once.** Run every existing Note through the serializer in one labelled commit.
4. **Normalise agent writes.** Have the CLI or snapshot step reformat agent-written Markdown files before committing, and tell agents the house style in AGENTS.md. Each normalisation then shows up in history as one diff, separate from the editor.
5. **Write only on user edits.** Don't write on open. Write only after a user edit, and skip the write when the serialized output equals the file on disk.
6. **Watch-outs:** setext headings, `1)` lists, 4-space nesting and table padding will always be rewritten. They are not configurable in remark-stringify defaults. Test any custom Milkdown nodes, such as a future Todo-link inline, for round-trip stability.

## Sources

- npm registry metadata (`npm view`) for `@milkdown/kit`, `@milkdown/crepe`, `@milkdown/react`, `@mdxeditor/editor`, `@tiptap/markdown`, `@tiptap/react`, `@blocknote/core`, `@blocknote/shadcn`, `@blocknote/xl-ai`, `@blocknote/xl-multi-column`, `lexical`, `@lexical/markdown`, `prosemirror-markdown`, checked 2026-10-29.
- GitHub API repo metadata: Milkdown/milkdown, ueberdosis/tiptap, mdx-editor/editor, TypeCellOS/BlockNote, facebook/lexical.
- Installed package sources and types: `@milkdown/core/lib/index.js` (`remarkStringifyOptionsCtx`), `@milkdown/components/lib/code-block/config.d.ts`, `@milkdown/crepe/lib/types/feature/index.d.ts`, `@mdxeditor/editor/dist/index.d.ts` and `dist/plugins/`.
- Tiptap Markdown docs: <https://tiptap.dev/docs/editor/markdown>
- Tiptap templates: <https://tiptap.dev/docs/ui-components/templates/simple-editor>, <https://tiptap.dev/docs/ui-components/templates/notion-like-editor>
- MDXEditor front-matter docs: <https://mdxeditor.dev/editor/docs/front-matter>
- BlockNote Markdown import docs: <https://www.blocknotejs.org/docs/features/import/markdown>
