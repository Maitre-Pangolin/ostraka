# ostraka

Personal admin base: a small local app for todos, dev logs, ideas, notes and quick sketches, plus a GitLab MR / Jira sprint overview, and a set of agent skills (Claude Code / Cursor) that write daily dev logs from todos, GitLab, Jira, Outlook and Slack activity.

> _Ostraka_: pottery shards used in antiquity for quick notes, sketches and records.

## Run it

Node 24+ and pnpm 10 (`corepack enable`).

    pnpm install
    pnpm build            # builds the web app into apps/web/dist
    pnpm ostraka serve    # http://127.0.0.1:4747

For UI work, run `pnpm ostraka serve` and `pnpm dev` side by side: Vite on http://127.0.0.1:5173 proxies `/api` to the server.

`pnpm ostraka path <todos|notes|devlogs|sketches|people>` prints where that content lives (`OSTRAKA_HOME`, else `contentDir` in `~/.config/ostraka/config.yml`, else `~/ostraka-content`).

`pnpm ostraka todo add "…"`, `todo done <id>` and `todo list` change and show Todos (add `--json` for agents). `todos.json` is written only through core (lock, validation, atomic rename), so agents change Todos with the CLI rather than editing the file.
