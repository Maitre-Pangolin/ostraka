# ostraka

Personal admin base: a small local app for todos, dev logs, ideas, notes and quick sketches, plus a GitLab MR / Jira sprint overview, and a set of agent skills (Claude Code / Cursor) that write daily dev logs from todos, GitLab, Jira, Outlook and Slack activity.

> _Ostraka_: pottery shards used in antiquity for quick notes, sketches and records.

## Run it

Node 24+ and pnpm 10 (`corepack enable`).

    pnpm install
    pnpm build            # builds the web app into apps/web/dist
    pnpm ostraka serve    # http://127.0.0.1:4747

For UI work, run `pnpm ostraka serve` and `pnpm dev` side by side: Vite on http://127.0.0.1:5173 proxies `/api` to the server.

`pnpm ostraka path <todos|notes|devlogs|sketches|people|tags>` prints where that content lives (`OSTRAKA_HOME`, else `contentDir` in `~/.config/ostraka/config.yml`, else `~/ostraka-content`).

`pnpm ostraka todo add "…" [--parent <id>]`, `todo done <id>`, `todo drop <id> [--reason "…"]` and `todo list` change and show Todos and their Sub-todos (`--parent` adds a Sub-todo under that Todo; finishing a Todo finishes its open Sub-todos too); `todo list --finished-on <YYYY-MM-DD>` shows what was done or Dropped that day (a Sub-todo by its own finish, as `Parent › Sub-todo`), `todo list --today` today's Todos for the Briefing (overdue, due today, then the top 3 high-priority ones without a due date) and `todo list --references` the MR and Jira tokens open Todos mention (add `--json` for agents). In a title, `#tag`, `*high|*med|*low` and `^today|^tomorrow|^fri|^2026-11-05` set the Todo's Tags, priority and due date, as in the app: `ostraka todo add "Fix login #auth *high ^fri"`. MRs and Jira tickets are written as their own tokens, `group/project!<iid>` and `<KEY>-<number>`, and stay in the text as is: `ostraka todo add "Rebase pay/api!809 for PAY-1432"`. The app shows them as chips with their status, from the work overview or fetched on hover. `todos.json` is written only through core (lock, validation, atomic rename), so agents change Todos with the CLI rather than editing the file. The open app refreshes on its own when content changes on disk, and refuses a change made from a copy that is no longer current instead of overwriting it.

The People directory is `people.json`: one Person per colleague, with an id slug, name, aliases, one company email, Slack ID and handle, GitLab username and Jira account ID (and `ignored: true` for someone skills must not offer to add again). Like `todos.json`, it is written only through core, so agents use the CLI: `pnpm ostraka people find <name|id|alias|email|handle>` before looking a colleague up in Slack, Jira, GitLab or M365; `people add "<name>" [--id <id>] [--email …] [--alias …] [--slack-id …] [--slack-handle …] [--gitlab …] [--jira …] [--ignored]`; `people show <id>`; `people refresh <id> [--email …] [--slack-id …] [--slack-handle …] [--gitlab …] [--jira …]` to record identities looked up again by email (the others stay cached); `people list [--stubs]` (`--stubs`: only Stub Persons, those with no email who aren't ignored); `people ignore <id>`; and `people rename <id> <new id> [--name …]` and `people merge <id> <into id>`, which rewrite every Mention in Todos, Notes and Dev logs and print how many each file held (`--dry-run` only counts). Each takes `--json`. A Person is mentioned as `@<person id>` in Todos, Notes and Dev logs: `ostraka todo add "Pair with @ilse-vantongeren on PAY-1432"`. The app shows the Person's current name with a contact card, and an id not in the directory as plain text with an offer to add them. Typing `@` and an id no Person matches offers "Add Person" last: picking it writes a Stub Person (the id and a name guessed from it) when the Todo or Note is saved, and a Stub Person's Mentions show underlined with dots, "Incomplete" in their card.

Notes are `notes/<id>.md`: a YAML header, then a Markdown body. The header is validated on load; a Note whose header is broken still shows in the app's list, with the reason. An Idea is a Note tagged `idea`.

```markdown
---
tags: [work, idea] # lowercase, hyphenated; always here, never inline
title: Release plan # optional; otherwise the first `# ` heading names the Note
---

# Release plan
```

Bodies are written in one house style (`-` bullets and rules, `*emphasis*`, `**strong**`, fenced code, `#` headings), which the app's editor writes too, so opening and saving an unchanged Note leaves it byte-identical and the header is never touched. After writing a Note by hand, run `pnpm ostraka note format [<id>…]` to put it in house style; `note list [--json]` lists Notes with any broken header. MR and Jira tokens in a Note or Dev log stay plain text too: the app highlights them in the editor with their status dot and card (as chips in a rendered Dev log), and suggests them while you type `!` or a Jira key like `PAY-`.

Dev logs are `devlogs/<YYYY-MM-DD>.md`, one per day, plus a monthly summary `devlogs/<YYYY-MM>.md`. The Dev log skill writes them: `/devlog` in Claude Code or Cursor gathers today's finished Todos and your GitLab, Jira and Slack activity (through the `GitLab`, `atlassian` and `slack` MCP servers, registered under those names at user level in both editors), shows a draft, and writes and snapshots the day once you confirm it; on a day already written it proposes only what is missing and keeps your text. `/devlog backfill` catches up one week at a time, oldest missing week first (or any range you name), confirming each day; `/devlog reformat <date|range>` restructures old days with a before/after per day; `/devlog summary <YYYY-MM>` writes the month's summary from its days. `pnpm ostraka devlog list [--from <date>] [--to <date>]` lists Dev logs with any broken header, `pnpm ostraka devlog missing [--from <date>] [--to <date>]` the weekdays with none, by week, and `pnpm ostraka tag list` the Tags in use (all take `--json`); the app lists them by week under each month's summary, shows any date range stacked by day, and edits a day's body (never its header). Their format, which agents follow, is in [`.claude/skills/devlog/format.md`](.claude/skills/devlog/format.md), next to the skill: a header with `date`, at most 3 `tags`, the `sources` used and `off: true` plus a `label` on an off day, then the sections Done, Meetings & discussions and Notes.

The old monthly Dev log files migrate one reviewed month at a time with `/devlog migrate [<YYYY-MM>]` ([`migrate.md`](.claude/skills/devlog/migrate.md)), never modifying the originals. `pnpm ostraka migrate split "<old file>"` (no AI) splits a month at its `## <Day> <N>` headings into raw days under `.migration/raw/<YYYY-MM>/` in the content folder and flags anomalies (a weekday that doesn't match the date, a day twice or out of order, a weekend, an empty day, a stray heading, text before the first day, a missing weekday). A fresh headless `claude -p` session per month then reformats each day into `.migration/staged/<YYYY-MM>/` and writes its uncertainties, its usage saved to `.migration/usage/<YYYY-MM>.json`. `migrate review <YYYY-MM>` shows the day count, the Tags to settle (`migrate tag <YYYY-MM> <tag> <new>|--remove`), the uncertainties, sample days and what blocks approval; `migrate approve <YYYY-MM>` moves the month into `devlogs/` (never over an existing day) and snapshots `migrate: <YYYY-MM>`; `migrate status` lists each month with what its session cost. `.migration/` is kept out of Snapshots, so out of Backups too.

The Briefing is the start-of-day summary, in chat only: `/whats-up` in Claude Code or Cursor reads your Todos and, through the same MCP servers, GitLab, Jira and Slack, then shows what needs you (reviews, failing pipelines, unresolved comments, a few Slack lines), today's Todos, your unfinished sprint tickets and the Dev log gaps of the past 7 weekdays, with an offer to fill them through `/devlog backfill`. It ends with numbered suggested Todos you pick in one line (`1 3 2 ^fri *high`), added through `ostraka todo add`; it never writes Dev logs, finishes Todos or posts to Slack. A source that fails is skipped, with its reason and fix at the end.

Sketches are `sketches/<id>.md`: a YAML header with a `title` and `tags`, then a body holding one `mermaid` fenced code block, which is what the app's editor changes (anything else in the body is kept). A Sketch without a title or a Mermaid block still shows in the app's list, with the reason. Edit the Mermaid text in place; the open app shows the change live.

````markdown
---
title: Login flow
tags: [auth]
---

```mermaid
sequenceDiagram
  User->>App: Sign in
```
````

The content folder is its own git repo (created when missing, no remote). While it runs, the server commits the whole folder as one Snapshot at most once an hour: the first change after a Snapshot starts a one-hour timer, and when it fires everything pending is committed together. It also commits on stop. `pnpm ostraka snapshot "<message>"` commits now with that message; skills run it after they write. Snapshots stay on this machine: nothing in the app talks to the remote ([Back it up](#back-it-up)).

History in a Note's or a Sketch's header (and on the Todos view, for `todos.json`) lists the file's Snapshots and shows any of them. Restore writes that version as the current file and commits it as a new Snapshot, `restore: <path> as of <date>`, after committing any changes not yet in a Snapshot; nothing rewrites history, so a restore is undone by restoring the Snapshot before it (the Undo on its toast). The API is `GET /api/history?path=<file>`, `GET /api/history/<commit>?path=<file>` and `POST /api/history/restore {path, commit}`, for any content file.

Search covers Notes, Dev logs and Todos (every state, Sub-todos too) in full text, and Sketches by title and Tags. ⌘K opens it from anywhere in the app: a typed `#tag` or `@person` becomes a chip (several Tags match all of them, or any with the toggle), Kind and Date menus narrow further, and with nothing typed it lists the 8 items opened last (kept in the browser). Notes, Dev logs and Todos each have a search box that narrows the list in place, keeping its order; opening a result lands on the match, highlighted, and a Todo opens expanded, in Done & Dropped if it is finished. `pnpm ostraka search "<words>" [--tag <tag>]… [--kind todo|note|devlog|sketch]… [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]` searches from the terminal, and skills use it instead of `rg` on the content folder. Case and accents are ignored, each word matches as a prefix, `"a phrase"` matches exactly, nothing is stemmed, and a Reference (`PAY-1432`) or Mention (`@jane-doe`) is found only as that whole token. Results rank by relevance (bm25), newer first on a tie. The index is a throwaway SQLite FTS5 file, `~/Library/Caches/ostraka/search.db`, outside the content folder so it is never snapshotted or backed up: the server rebuilds it from the files when it starts (the app shows "indexing…" meanwhile) and keeps it current as files change, whoever changes them. `ostraka search` asks the running server, or builds a throwaway index in memory when the server is down.

`tags.yml` in the content folder holds Tag colours only; Tags themselves come from use. A Tag it doesn't list keeps a colour picked from its name. Colours are `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink` and `red`:

```yaml
code-review:
  color: blue
```

The app's Tags view (the tag icon at the bottom of the rail) lists every Tag in use with its colour and how many Todos, Notes, Dev logs and Sketches use it. From there a Tag can be coloured (saved to `tags.yml`), renamed, merged into another or deleted. A rename, merge or delete rewrites every Todo and Sub-todo and the `tags:` line of every Note, Dev log and Sketch using the Tag, in one request and after a confirmation; files with a broken header are left alone. The next Snapshot holds the whole change, so History undoes it file by file. The API is `GET /api/tags/usage`, `POST /api/tags/<name>/rename {to}`, `POST /api/tags/<name>/merge {into}`, `DELETE /api/tags/<name>` and `PUT /api/tags/<name>/color {color}` (`null` for the default).

## Install it

From the main checkout (not a worktree: the paths written point at this repo):

    pnpm install && pnpm build
    pnpm ostraka install

This writes:

- a LaunchAgent, `~/Library/LaunchAgents/com.ostraka.server.plist`, that runs `ostraka serve` at login and restarts it after a crash. Logs go to `~/Library/Logs/ostraka/server.log`.
- a shim, `~/.local/bin/ostraka`, with absolute paths to node and this repo, so skills and Dock-launched editors find `ostraka` by name. Put `~/.local/bin` on your `PATH` if it isn't.
- a link `~/.claude/skills/<name>` to each skill in this repo's `.claude/skills/`, so the skills work from any project, in Claude Code and in Cursor (which reads `~/.claude/skills/` too). The repo stays their single source: an edit here applies at once. A skill folder of the same name that isn't such a link is left alone, and `install` says so. It also points out the old Cursor `/devlog` command (`~/.cursor/commands/devlog.md`) if it is still there: the `devlog` skill replaces it and its dictation mode.

Run it again after moving the repo or changing Node versions. To remove it: `launchctl bootout gui/$(id -u)/com.ostraka.server`, then delete the files and the skill links.

Then open http://127.0.0.1:4747 and install it as an app, so it gets its own window and Dock icon: in Chrome, ⋮ › Cast, save and share › Install page as app; in Safari, File › Add to Dock.

The LaunchAgent runs the checked-out code, so keep this checkout on `main`. It ignores `OSTRAKA_HOME`: set `contentDir` in `config.yml` ([Configure it](#configure-it)) to use another content folder.

### Start, stop and restart

Once installed, the app runs in the background, with no terminal. These drive the LaunchAgent:

- `ostraka stop` stops it cleanly: pending changes are committed as a Snapshot, then it exits and stays stopped until the next login or `ostraka start`. It waits up to 15 s for that.
- `ostraka start` starts it (and loads the LaunchAgent again if it was turned off).
- `ostraka restart` restarts it, Snapshot first, after an update (`git pull`, `pnpm install && pnpm build`) or a changed Keychain item or `config.yml`.
- `ostraka status` says whether it runs in the background and its pid, or whether an `ostraka serve` in a terminal answers instead; it exits 1 when nothing runs.

A crash restarts it on its own. `ostraka serve` in a terminal stops the same clean way on Ctrl+C.

### Colleagues in every project

The `people` skill, linked by `install`, is what both editors pick on their own when an agent looks a colleague up. It runs `ostraka people find` first and calls the Slack, Jira or GitLab MCP server only for someone missing; it looks a new colleague's IDs up once by email in all three and offers to cache them, refreshing them only when you ask. At the end of a run it offers, in one question, to add the people who ended up in what it wrote, and `ignore` keeps someone from being offered again. The Dev log skill goes through it, so Dev logs name people as `@<person id>` Mentions. Asked to fill Stub Persons, it searches Slack by name and aliases (then Jira by name), shows every stub with up to 3 candidates in one question answered in one line (`1a 2 skip 3 ignore`), then renames or merges each one with its Mentions and makes one Snapshot.

A global instruction makes agents check the directory even when they don't pick the skill. Add it yourself, since `install` writes neither file (it points this out until `~/.claude/CLAUDE.md` mentions `ostraka people find`):

- Claude Code: append it to `~/.claude/CLAUDE.md`.
- Cursor: paste it once into Cursor Settings › Rules › User Rules. Those are kept on your Cursor account, not on disk.

```markdown
## Colleagues

Before looking up a colleague in Slack, Jira, GitLab or M365, run `ostraka people find <name, email or handle>`. The People directory caches their email, Slack ID and handle, GitLab username and Jira account ID, so use what it prints. Call the MCP server only when it prints `No Person matches`, and then follow the `people` skill.
```

Optionally, reminder hooks add one line about the People directory when an agent calls a Slack, Jira, GitLab or M365 tool that looks a user up (one whose name has `user`, `account`, `profile` or `member`). They never block or approve a call. Both run [`.claude/skills/people/hooks/people-reminder.sh`](.claude/skills/people/hooks/people-reminder.sh) through the link `install` made.

- Claude Code, merged into `~/.claude/settings.json`. The matcher lists your MCP server keys:

  ```json
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "^mcp__(slack|atlassian|GitLab)__.*",
          "hooks": [{ "type": "command", "command": "/bin/sh \"$HOME/.claude/skills/people/hooks/people-reminder.sh\" claude" }]
        }
      ]
    }
  }
  ```

  The reminder reaches Claude with the tool's result, so it steers the next lookup rather than the one already made.

- Cursor, merged into `~/.cursor/hooks.json`, with your home folder written out:

  ```json
  {
    "version": 1,
    "hooks": {
      "beforeMCPExecution": [{ "command": "/bin/sh /Users/<you>/.claude/skills/people/hooks/people-reminder.sh cursor", "timeout": 5 }]
    }
  }
  ```

  It runs before every MCP call and always allows it, adding the reminder as `agent_message` on a lookup. Cursor's docs don't say whether that message reaches the agent on an allowed call, so check it once.

## Configure it

`~/.config/ostraka/config.yml` holds settings only, never secrets (the app refuses a file with token-like keys or values). Every key is optional; Settings in the app shows what it read.

```yaml
contentDir: ~/ostraka-content # OSTRAKA_HOME overrides it
gitlab:
  base_url: https://gitlab.com
jira:
  site: https://acme.atlassian.net
  cloud_id: 00000000-0000-0000-0000-000000000000 # from https://acme.atlassian.net/_edge/tenant_info
  email: you@acme.com # your Atlassian account; the API token signs in with it
  board_id: 42 # its active sprint is shown
  my_tickets_jql: assignee = currentUser() AND statusCategory != Done
```

## Credentials

The GitLab and Jira tokens for the work overview live only in the macOS Keychain, and only the app server reads them, once when it starts. The CLI and agents never do. Backups don't use the Keychain at all: `ostraka backup` and `ostraka init --from` let git sign in as it does for you ([Back it up](#back-it-up)). Create each item with `-T ""` so that no app is trusted to read it silently: every read, including an agent running `security find-generic-password`, shows a prompt. Expect one prompt per item when the server starts.

Paste each token at the silent `read` prompt. Don't let `security` prompt for it itself (`-w` with no value): that prompt silently truncates long tokens, and Atlassian's are about 190 characters, which then shows up as a bare 401.

- GitLab, a fine-grained personal access token with `read_api`:

      read -rs TOKEN && security add-generic-password -U -a "$USER" -s ostraka-gitlab -T "" -w "$TOKEN"; unset TOKEN

- Jira, a scoped API token with `read:jira-work`, for the account in `jira.email`:

      read -rs TOKEN && security add-generic-password -U -a "$USER" -s ostraka-jira -T "" -w "$TOKEN"; unset TOKEN

`-U` replaces an existing item. Restart the server after changing one: `ostraka restart`. Never put tokens in `.env`, `~/.zshrc` or `config.yml`.

## Back it up

The content repo is backed up by a plain `git push` of its whole history to a private project in your own namespace on the work gitlab.com (content is work data and colleagues' details, so it stays on employer infrastructure). Create the project empty, then point the content repo at it once:

    git -C ~/ostraka-content remote add origin https://gitlab.com/<you>/ostraka-content.git

- The app never pushes: nothing in the server talks to the remote. You back up with `pnpm ostraka backup` (or `ostraka backup` once installed), which runs on its own, with or without the app running, and suits cron (exit code 0 when backed up, `--json` for scripts). It pushes the Snapshots already made: run `ostraka snapshot "<message>"` first to include changes from the last hour.
- git signs in as it does for you: your SSH key, or your credential helper for an HTTPS remote (for example `osxkeychain`, with user `oauth2` and a GitLab token with `write_repository` as password). Ostraka reads no token for it. From cron, use an SSH key or a helper that answers without a prompt.
- Before pushing, every line added in the Snapshots not yet on `origin/<branch>` is scanned for tokens (GitLab `glpat-`, Slack `xox…`, Atlassian `ATATT…`, private keys). A match blocks the push and `ostraka backup` names the file, never the token. Take the secret out of every Snapshot not backed up yet (a secret removed in a later Snapshot is still in history), for example with `git reset --soft` to the last backed-up commit and a new commit.
- It is a plain `git push origin <branch>`: never forced, never merged. If the remote has commits this machine doesn't, the push is rejected and `ostraka backup` prints git's reason. Bring them in by hand (`git -C ~/ostraka-content pull --rebase`), then run `ostraka backup` again.
- "Backed up" means the local `HEAD` is on `origin/<branch>`, as of the last push or fetch. The top bar works that out locally, with no network: it warns when a Snapshot has waited more than 24 hours, and about any content file over 10 MB (plain git, no LFS; `ostraka backup` warns about those too). A content folder with no remote gets no backup warning.

## Restore on a new machine

1. Clone this repo, then `pnpm install && pnpm build` (Node 24+ and pnpm 10, as in [Run it](#run-it)).
2. `pnpm ostraka init --from https://gitlab.com/<you>/ostraka-content.git`. It walks through recreating the GitLab and Jira Keychain items ([Credentials](#credentials)), waiting while you run each command in another terminal tab (it never reads them: only the server does); then it clones the content into `~/ostraka-content` (or `OSTRAKA_HOME`) with `origin` set, signing in with git's own credentials (your SSH key or credential helper, or a prompt: over HTTPS, user `oauth2` and a GitLab token as password), as every later `ostraka backup` does, and writes `~/.config/ostraka/config.yml` with `contentDir` and `gitlab.base_url`, keeping a file that is already there. Fill in the Jira settings ([Configure it](#configure-it)).
3. `pnpm ostraka install` for the LaunchAgent and the CLI shim ([Install it](#install-it)). The server starts on the cloned content, already backed up; carry on backing up with `ostraka backup`.
