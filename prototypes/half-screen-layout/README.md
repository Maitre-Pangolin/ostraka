# PROTOTYPE: ostraka shell, half-screen first (#10)

Throwaway. Layout A (focus list + work strip) inside C's side rail, with every section stubbed:
Todos, Notes (Milkdown Crepe), Dev logs (rendered Markdown, day/week), Sketches (Mermaid split editor),
Work (GitLab MRs + Jira sprint) and Settings. In-memory mock data only.

    pnpm install && pnpm dev

`?view=` picks the section. The app fills the window; theme (light/dark) and density (compact/comfy) are switched from the rail or Settings, defaulting to light + compact.

## #17: MR / Jira references

Three variants of how references are typed and stored, on the same shell: `?variant=A|B|C`, or the floating bar at the bottom (← / → when not typing). Switching reloads, because the seed data is stored differently per variant.

- **A, plain-text tokens:** title and description stay plain text. `!81…` or `PAY-…` (or a pasted URL) offers open MRs and sprint tickets, and picking inserts the GitLab/Jira token (`pay/api!812`, `PAY-1432`), rendered as a chip with live status.
- **B, Markdown links (rich text):** title and description are Milkdown. Picking inserts a link on the item's title, and the text stays editable. ⌘K on a selection links that text; pasting an MR/Jira URL over a selection does the same. Quick entry keeps tokens and turns them into links on save.
- **C, links as properties:** references leave the text and go to `todo.links`, shown as chips with status like Tags (`+ link` in the expanded row). The description is Milkdown with ordinary links.

Every expanded Todo has a "stored in todos.json" toggle that shows the stored fields. Notes use the same picker (tokens in A, links in B and C).
