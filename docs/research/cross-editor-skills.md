# One skill that works in both editors

Research for issue #4. Question: how should ostraka package its skills (the Dev log and Briefing skills, which read Activity sources over MCP) so the same skill runs identically in Claude Code and Cursor?

Researched 2026-10-29 against the official docs listed under Sources. Where a doc is silent, this note says so instead of guessing.

## Answer in brief

- Both editors implement the **Agent Skills** open standard: a folder holding a `SKILL.md` with YAML frontmatter (`name`, `description`) and a Markdown body. One file format serves both. [S1, S2, S3]
- **Cursor already reads `.claude/skills/`** as a compatibility location. Putting skills in the repo's `.claude/skills/<name>/SKILL.md` gives one source of truth with no symlinks and no installer. [S2, S1]
- **`AGENTS.md`** is the shared instruction file. Cursor reads it natively. Claude Code reads it natively when no `CLAUDE.md` exists, or through the `@AGENTS.md` import this repo already uses. [S4, S5]
- **MCP config cannot be shared as one file.** Claude Code uses `.mcp.json` / `~/.claude.json`; Cursor uses `.cursor/mcp.json` / `~/.cursor/mcp.json`. The shape (`mcpServers`, `command`, `args`, `env`, `url`, `headers`) is the same, but the env-var syntax differs (`${VAR}` vs `${env:VAR}`). [S6, S7]
- **Tool names differ** (`mcp__gitlab__list_merge_requests` in Claude Code, `gitlab:list_merge_requests` in Cursor permissions). Skills should name the server and the bare tool name in prose, and the two MCP configs must use **identical server keys**. [S8, S9]

## 1. Skill format and discovery

### The shared format (Agent Skills spec) [S3]

```
skill-name/
├── SKILL.md      # required: frontmatter + instructions
├── scripts/      # optional
├── references/   # optional
└── assets/       # optional
```

- Required frontmatter: `name` (1-64 chars, lowercase letters, digits, hyphens, no leading/trailing or doubled hyphen, **must match the parent directory name**) and `description` (1-1024 chars, says what and when).
- Optional: `license`, `compatibility`, `metadata`, `allowed-tools` (marked **experimental**: "Support for this field may vary between agent implementations").
- Progressive disclosure: name + description load at startup; the body loads when the skill activates; files under `scripts/` etc. load on demand. Keep `SKILL.md` under 500 lines and reference files one level deep with paths relative to the skill root.

### Claude Code [S1]

- "Claude Code skills follow the Agent Skills open standard ... Claude Code extends the standard with additional features."
- Locations: personal `~/.claude/skills/<name>/SKILL.md`; project `.claude/skills/<name>/SKILL.md` (loaded from the start directory and every parent up to the repo root); nested `<subdir>/.claude/skills/` (loaded when Claude first touches a file there); plugin `<plugin>/skills/`; enterprise via managed settings.
- All frontmatter is optional in Claude Code (`name` defaults to the directory name). Extra Claude-only fields: `when_to_use`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `arguments`, and others. **Unrecognized fields are ignored silently.**
- Invocation: automatic (model matches the description) or `/skill-name`.
- Symlinks: a `<skill-name>` entry in the personal or project location "can be a symlink to a directory elsewhere on disk"; a target reached by several links loads once.
- `.claude/commands/*.md` still works but has been merged into skills; skills are recommended for new work.
- `${CLAUDE_SKILL_DIR}` substitution resolves a skill's own folder. It is Claude-specific; Cursor docs do not mention it.

### Cursor [S2]

- "Cursor supports the Agent Skills open standard."
- Project locations: `.agents/skills/` and `.cursor/skills/`. User locations: `~/.agents/skills/` and `~/.cursor/skills/`.
- **Compatibility locations: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`.**
- Discovery is recursive; nested `.cursor/skills/` or `.agents/skills/` in subdirectories apply only to files in that directory.
- Frontmatter: `name` (**required**, must match folder), `description` (**required**), `paths`, `disable-model-invocation`, `icon`, `color`, `metadata`. Legacy `globs` accepted.
- Invocation: automatic, `/skill-name` in Agent chat (attaches to one message), or as a Custom Mode for the whole session.
- Symlinks: not mentioned in the Cursor docs.
- Rules and commands: `/migrate-to-skills` turns "Apply Intelligently" rules into skills and slash commands into skills with `disable-model-invocation: true`. Rules (`.cursor/rules/*.mdc`) and `AGENTS.md` remain separate, always-on or glob-scoped context. [S4]
- Cloud note: only `~/.cursor/skills/` syncs to Cloud Agents; irrelevant for a local-only app.

### The portable subset

Fields both editors honour: `name`, `description`, `disable-model-invocation`, `paths`, `metadata`. To keep a skill identical in both:

- Always set `name` (Cursor requires it) and make it equal to the folder name.
- Avoid Claude-only fields whose absence would change behaviour in Cursor (`context: fork`, `hooks`, `allowed-tools` with MCP names, `${CLAUDE_SKILL_DIR}`). Claude Code ignores unknown fields; Cursor's docs do not say how it treats them, so stick to the documented set.
- Reference bundled files with relative paths from the skill root, as the spec says.

## 2. One source of truth in this repo

| Option | Claude Code | Cursor | Verdict |
| --- | --- | --- | --- |
| Skills in `.claude/skills/` | native project location [S1] | compatibility location [S2] | **Recommended**: zero glue |
| Skills in `.agents/skills/`, symlinked into `.claude/skills/` | via symlink (documented) [S1] | native [S2] | Works; only worth it if more agents join |
| `npx skills add` | installs to `.claude/skills/` [S10] | installs to `.agents/skills/` [S10] | An installer for third-party skills, not needed for skills authored here |

`npx skills` (vercel-labs/skills) is "the CLI for the open agent skills ecosystem"; it detects installed agents and installs per project (or `-g` globally), with `skills-lock.json` for restore. Its agent table lists Claude Code at `.claude/skills/` / `~/.claude/skills/` and Cursor at `.agents/skills/` / `~/.cursor/skills/`. Its README does not document symlink vs copy. [S10]

Instructions: keep `AGENTS.md` as the single instruction file. Cursor reads `AGENTS.md` at the root and in subdirectories [S4]. Claude Code reads it when there is no `CLAUDE.md`, or loads it through an import; the repo's `CLAUDE.md` containing `@AGENTS.md` is the documented "share one file with other coding tools" pattern and also covers sessions where native `AGENTS.md` support is unavailable [S5]. Cursor docs do not mention `CLAUDE.md`, so nothing important should live only there.

## 3. MCP servers in each editor

| | Claude Code [S6] | Cursor [S7] |
| --- | --- | --- |
| Project file | `.mcp.json` at repo root (project scope) | `.cursor/mcp.json` |
| User file | `~/.claude.json` (user scope, and local scope keyed by project path) | `~/.cursor/mcp.json` |
| Default scope for `claude mcp add` | local (private, this project only) | n/a |
| Top-level key | `mcpServers` | `mcpServers` |
| stdio | `command`, `args`, `env` (no `type` = stdio) | `command`, `args`, `env`, `envFile` |
| remote | `type: "http"` + `url`, `headers` (`url` without `type` is an error) | `url`, `headers`, optional `auth` |
| Env interpolation | `${VAR}`, `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers` | `${env:NAME}`, `${userHome}`, `${workspaceFolder}` in the same fields |
| Approval | prompts once before using project `.mcp.json` servers | prompts per tool call by default; allowlist in `permissions.json` |
| Reads the other editor's file? | No; docs say to paste Cursor JSON into `claude mcp add-json` by hand | Not mentioned |

What must differ: the file path, the interpolation syntax, and `type: "http"` on remote entries for Claude Code. What can match: server keys, commands, args, and env var *names*.

For ostraka (map rule: credentials never in git or in files agents read; the work Cursor config holds credentials):

- Keep MCP configs **user-level or local-scope**, not committed: `~/.cursor/mcp.json` already exists for Cursor; add the same servers to Claude Code at user or local scope (`~/.claude.json`).
- If a committed config is ever wanted, it must hold only `${VAR}` / `${env:VAR}` references, and would still need two files because the syntax differs. Note Claude Code blanks some credential variables in remote `url`/`headers` [S6].
- Use **the same server keys in both** (e.g. `gitlab`, `jira`, `outlook`, `slack`), since skills refer to servers by that key.

## 4. Referencing MCP tools portably from a skill

- Claude Code exposes tools as `mcp__<server>__<tool>` (characters outside `[A-Za-z0-9_-]` in the server key become `_`; plugin servers get `mcp__plugin_<plugin>_<server>__<tool>`). Permission rules use the same names, e.g. `mcp__gitlab__*`. [S8, S6]
- Cursor's `permissions.json` allowlist uses `server:tool` with the `mcp.json` key as the server (e.g. `gitlab:list_*`). Cursor's MCP page does not document the name the model sees; another Cursor page notes tool names "may include a server prefix" depending on the client. [S9, S7]
- Tool search: Claude Code defers MCP tool definitions by default and loads them on demand, so a skill that names the tool helps the model find it. [S6]

Recommended pattern for ostraka skills:

1. In `SKILL.md`, name the **server key and bare tool name** in prose ("use the `list_merge_requests` tool from the `gitlab` MCP server"), never the `mcp__...` form.
2. Describe the capability as a fallback ("if that tool is missing, use whichever `gitlab` tool lists merge requests"), so a renamed or wrapped tool still works.
3. Keep editor-specific approvals out of the skill: put `mcp__gitlab__*` rules in Claude Code settings and `gitlab:*` in `~/.cursor/permissions.json`. Do not rely on `allowed-tools` (experimental in the spec, Claude-specific names).
4. Optionally list required servers in `compatibility` (e.g. "Requires MCP servers: gitlab, jira").

## Open points

- Cursor's handling of unknown frontmatter fields and of symlinked skill folders is undocumented; test once before relying on either.
- Server keys in the work Cursor config should be read (names and commands only, per the map) and mirrored in Claude Code.

## Sources

- [S1] Claude Code, Skills: https://code.claude.com/docs/en/skills
- [S2] Cursor, Agent Skills: https://cursor.com/docs/context/skills
- [S3] Agent Skills specification: https://agentskills.io/specification
- [S4] Cursor, Rules (AGENTS.md, `.cursor/rules`): https://cursor.com/docs/context/rules
- [S5] Claude Code, Memory (CLAUDE.md and AGENTS.md): https://code.claude.com/docs/en/memory
- [S6] Claude Code, MCP: https://code.claude.com/docs/en/mcp
- [S7] Cursor, MCP: https://cursor.com/docs/context/mcp
- [S8] Claude Code, Permissions (MCP rule syntax): https://code.claude.com/docs/en/permissions
- [S9] Cursor, permissions.json reference: https://cursor.com/docs/reference/permissions
- [S10] vercel-labs/skills README and agent table: https://github.com/vercel-labs/skills, https://github.com/vercel-labs/skills/blob/main/docs/agents.md
