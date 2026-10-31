# PROTOTYPE: ostraka shell, half-screen first (#10)

Throwaway. Layout A (focus list + work strip) inside C's side rail, with every section stubbed:
Todos, Notes (Milkdown Crepe), Dev logs (rendered Markdown, day/week), Sketches (Mermaid split editor),
Work (GitLab MRs + Jira sprint) and Settings. In-memory mock data only.

    pnpm install && pnpm dev

`?view=` picks the section. The app fills the window; theme (light/dark) and density (compact/comfy) are switched from the rail or Settings, defaulting to light + compact.

## #17 / #18: references and quick-entry tokens

Decided on #17 and #18. Three reference models were prototyped first; variants B (Markdown links) and C (link properties) live in commit 7db58da.

- Todo titles and descriptions are plain text. MRs and Jira issues are GitLab's and Jira's own tokens (`pay/api!812`, `PAY-1432`), and mentions are `@person-id`.
- They are edited in a small ProseMirror field (`tokeneditor.tsx`) where references and mentions are atomic chips with a live status dot. `!` suggests open MRs, `KEY-` suggests sprint tickets, and a complete token becomes a chip on space.
- `#tag`, `*high|*med|*low` and `^date` leave the text once completed and become properties: chips under quick entry, or applied straight away in an open Todo. ⇧↵ in a title opens the description.
- Notes (Milkdown) insert the same tokens and highlight them in place.

Each expanded Todo has a "stored in todos.json" toggle that shows the stored fields.
