# Editing a Sketch visually and as text

Research for issue #7. Date: 2026-10-29.

**Question:** which embeddable editors let a Sketch (Mermaid text, saved as `.md`/`.mmd`) be edited both visually and as text, with round-tripping, so an agent (editing text) and the UI (editing visually) can both change it? Must cover sequence and flow diagrams.

## Answer

**Visimer** is the only option found that fits as an embeddable library. Text stays the source of truth, and visual edits come back as small text edits. It is MIT-licensed and offers full structural editing for flowcharts and sequence diagrams. It is young, so the fallback (a split text editor with a live Mermaid preview) should stay cheap to switch to. Every Excalidraw/tldraw/React Flow path is either one-way or would need a hand-written converter back to Mermaid.

## Options

| Option | Licence | Embeddable in a web app | Visual edit | Round-trip to Mermaid text |
|---|---|---|---|---|
| Visimer (`@visimer/*`) | MIT | Yes: npm packages, React component | Yes: flowchart and sequence fully | Yes, preserving the rest of the text |
| Mermaid Live Editor | MIT | Not documented as a component | No: text plus preview | n/a (text only) |
| mermaid.ai (formerly Mermaid Chart) | Proprietary SaaS | No | Yes | Yes, but hosted only |
| mermaid-to-excalidraw + Excalidraw | MIT | Yes | Yes (in Excalidraw) | **One-way**: Mermaid to Excalidraw only |
| tldraw | tldraw licence (key required in production) | Yes | Yes | None built in |
| React Flow (`@xyflow/react`) | MIT | Yes | Only what you build | None: you write the parser and serialiser |
| Split text editor + live preview | MIT (CodeMirror/Monaco + `mermaid`) | Yes | No | n/a: text is the only representation |

### Visimer

- MIT, by Inkeep. It renders with the unmodified Mermaid renderer and maps the SVG elements back to a concrete syntax tree. A visual edit becomes a minimal text edit, so comments, formatting and unknown syntax are kept verbatim. Broken syntax while typing doesn't blank the canvas, and undo covers both canvas and code. ([repo](https://github.com/inkeep/visimer))
- Full structural editing (connect, reorder, restyle) for flowchart, sequence, state, class, ER, pie and gantt. Other types can be viewed with item-level editing only. ([repo](https://github.com/inkeep/visimer))
- Packages: `@visimer/core` (headless), `@visimer/dom` (canvas, brings your own `mermaid`), `@visimer/codemirror` / `@visimer/monaco` (editor bindings), and `@visimer/react`. It targets Mermaid 11. ([repo](https://github.com/inkeep/visimer))
- Maturity: about 140 stars and 48 commits at the time of writing. `@visimer/react` is at 1.1.3 (MIT) on npm, last published 2026-10-15 (`npm view @visimer/react`). It is a young, single-vendor project.
- Fit for Sketches: the file on disk stays plain Mermaid, so an agent's text edits and the UI's visual edits go through the same text and nothing else needs syncing.

### Mermaid Live Editor

- MIT. Live text editing with a rendered preview ("Edit and preview flowcharts, sequence diagrams… in real time"). It is a standalone SvelteKit app, not a documented embeddable component, and has no visual editing. ([repo](https://github.com/mermaid-js/mermaid-live-editor))
- Useful as a reference for the fallback, not as a dependency.

### mermaid.ai (Mermaid Chart)

- The Mermaid team's commercial product has a visual editor linked to code ("click any node to jump to its code"). It is a hosted SaaS, which rules it out for a local-only app. ([mermaid.ai](https://mermaid.ai/))

### Excalidraw + mermaid-to-excalidraw

- MIT. It converts flowcharts, sequence, class, ER and state diagrams into Excalidraw elements, and inserts other types as images. ([README](https://github.com/excalidraw/mermaid-to-excalidraw)) The current npm version is 3.1.0.
- **One-way.** The official library has no export from Excalidraw back to Mermaid. ([API docs](https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api)) Third-party Excalidraw-to-Mermaid converters exist, but they handle flowchart shapes and arrows only, so sequence diagrams would be lost.
- Using it would make the Excalidraw JSON the real source, which breaks "kept as Mermaid text".

### tldraw

- Its licence forbids production use without a trial or commercial licence key. ([LICENSE](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)) It has no Mermaid round-trip. Not worth pursuing.

### React Flow

- MIT, a good node/edge canvas ([@xyflow/react](https://reactflow.dev/)), but it has no Mermaid support. You would need your own parser, serialiser and layout. Sequence diagrams don't fit a node-graph model well. Too much work for a low-priority feature.

## Fallback: split text editor + live preview

CodeMirror or Monaco on one side, `mermaid.render()` on the other, re-rendered on change (debounced), with the last good SVG kept on screen while the text is invalid. Everything is MIT, has no round-trip risk, and agents and the UI edit the same text. It also fits the half-screen layout: stack the two panes, or toggle between them. Visimer's `@visimer/codemirror` binding sits on top of this same layout, so starting with the fallback and adding Visimer's canvas later costs little.

## Recommendation

Build the Sketch view as the split editor + preview first, using CodeMirror. Then prototype Visimer's canvas in the preview pane for flowcharts and sequence diagrams, and keep it only if its edits stay minimal on real Sketches. Don't use Excalidraw or tldraw as the store.
