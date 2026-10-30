# PROTOTYPE: ostraka shell, half-screen first (#10)

Throwaway. Layout A (focus list + work strip) inside C's side rail, with every section stubbed:
Todos, Notes (Milkdown Crepe), Dev logs (rendered Markdown, day/week), Sketches (Mermaid split editor),
Work (GitLab MRs + Jira sprint) and Settings. In-memory mock data only.

    pnpm install && pnpm dev

`?view=` picks the section. Bottom-right bar: ⅓ / ½ / full frame width, comfy/compact density, light/dark.
