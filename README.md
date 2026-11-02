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

`pnpm ostraka todo add "…"`, `todo done <id>`, `todo drop <id> [--reason "…"]` and `todo list` change and show Todos; `todo list --finished-on <YYYY-MM-DD>` shows what was done or Dropped that day (add `--json` for agents). `todos.json` is written only through core (lock, validation, atomic rename), so agents change Todos with the CLI rather than editing the file.

## Install it

From the main checkout (not a worktree: the paths written point at this repo):

    pnpm install && pnpm build
    pnpm ostraka install

This writes:

- a LaunchAgent, `~/Library/LaunchAgents/com.ostraka.server.plist`, that runs `ostraka serve` at login and restarts it after a crash. Logs go to `~/Library/Logs/ostraka/server.log`.
- a shim, `~/.local/bin/ostraka`, with absolute paths to node and this repo, so skills and Dock-launched editors find `ostraka` by name. Put `~/.local/bin` on your `PATH` if it isn't.

Run it again after moving the repo or changing Node versions. To remove it: `launchctl bootout gui/$(id -u)/com.ostraka.server`, then delete both files.

Then open http://127.0.0.1:4747 and install it as an app, so it gets its own window and Dock icon: in Chrome, ⋮ › Cast, save and share › Install page as app; in Safari, File › Add to Dock.

## Configure it

`~/.config/ostraka/config.yml` holds settings only, never secrets (the app refuses a file with token-like keys or values). Every key is optional; Settings in the app shows what it read.

```yaml
contentDir: ~/ostraka-content # OSTRAKA_HOME overrides it
gitlab:
  base_url: https://gitlab.com
jira:
  site: https://acme.atlassian.net
  cloud_id: 00000000-0000-0000-0000-000000000000 # from https://acme.atlassian.net/_edge/tenant_info
  board_id: 42 # its active sprint is shown
  my_tickets_jql: assignee = currentUser() AND statusCategory != Done
```

## Credentials

Tokens live only in the macOS Keychain, and only the server reads them, once when it starts. Create each item with `-T ""` so that no app is trusted to read it silently: every read, including an agent running `security find-generic-password`, shows a prompt. Expect one prompt per item when the server starts.

Paste each token at the silent `read` prompt. Don't let `security` prompt for it itself (`-w` with no value): that prompt silently truncates long tokens, and Atlassian's are about 190 characters, which then shows up as a bare 401.

- GitLab, a fine-grained personal access token with `read_api`:

      read -rs TOKEN && security add-generic-password -U -a "$USER" -s ostraka-gitlab -T "" -w "$TOKEN"; unset TOKEN

- Jira, a scoped API token with `read:jira-work`:

      read -rs TOKEN && security add-generic-password -U -a "$USER" -s ostraka-jira -T "" -w "$TOKEN"; unset TOKEN

- Backup push to the content repo's remote, a GitLab token with `write_repository` on that project:

      read -rs TOKEN && security add-generic-password -U -a "$USER" -s ostraka-push -T "" -w "$TOKEN"; unset TOKEN

`-U` replaces an existing item. Restart the server after changing one: `launchctl kickstart -k gui/$(id -u)/com.ostraka.server`. Never put tokens in `.env`, `~/.zshrc` or `config.yml`.
