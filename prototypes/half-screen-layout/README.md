# PROTOTYPE: ostraka shell, half-screen first (#10)

Throwaway. Layout A (focus list + work strip) inside C's side rail, with every section stubbed:
Todos, Notes (Milkdown Crepe), Dev logs (rendered Markdown, day/week), Sketches (Mermaid split editor),
Work (GitLab MRs + Jira sprint) and Settings. In-memory mock data only.

    pnpm install && pnpm dev

`?view=` picks the section. The app fills the window; theme (light/dark) and density (compact/comfy) are switched from the rail or Settings, defaulting to light + compact.
