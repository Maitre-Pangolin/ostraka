# Global agent rules and MCP hooks in Claude Code and Cursor

Research for issue #16. The question is how to make Claude Code and Cursor run `ostraka people find <name or email>` before they look up a colleague through the Slack, Jira, GitLab or M365 MCP servers.

Sources are official docs only (code.claude.com, cursor.com), checked on 2026-10-30. Anything the docs leave open is marked **Unverified**.

## 1. Cursor global rules

**Answer:** User Rules are set in the Settings UI and stored on the Cursor account, not in a file on disk, so an installer cannot write them. The user has to paste the rule once. Cursor also documents `~/.cursor/rules` for local "user rule files", which an installer can write. A global AGENTS.md is not documented. AGENTS.md is supported only at the project root and in subdirectories.

- User Rules are defined in Customize → Rules and are "Global to your Cursor environment. Used by Agent (Chat)." Precedence is Team Rules → Project Rules → User Rules. Source: https://cursor.com/docs/context/rules
- User Rules are stored on the Cursor account: they "apply across all your projects and sync when you sign in on another machine." Source: https://cursor.com/help/customization/rules
- "User rules are also not migrated since they are not stored on the file system." Source: https://cursor.com/docs/skills
- The same help page lists `~/.cursor/rules` (`%USERPROFILE%\.cursor\rules` on Windows) for "User rule files" that "stay on the machine and do not sync". Source: https://cursor.com/help/customization/rules
  - **Unverified:** whether these files load in every workspace, and which frontmatter they need (for example `alwaysApply: true`). The docs don't say how they relate to the account-based User Rules. Community reports say they only load for projects under the home directory. Test this before relying on it.
- AGENTS.md: "Cursor supports AGENTS.md in the project root and subdirectories." No global location is documented. Source: https://cursor.com/docs/context/rules

## 2. Cursor hooks

**Answer:** Yes. `beforeMCPExecution` runs before each MCP tool call. A user-level config goes in `~/.cursor/hooks.json` and a project config in `<project>/.cursor/hooks.json`. The hook returns `permission` (`allow`, `deny` or `ask`) and can also return `user_message` and `agent_message`. **Unverified:** whether `agent_message` reaches the agent when the call is allowed. The docs list the field without saying when it is delivered, and `additional_context` is documented only for `postToolUse`, `postToolUseFailure` and `sessionStart`.

Source for everything in this section: https://cursor.com/docs/agent/hooks

- Config locations, all merged. Highest priority first:
  1. Enterprise MDM files
  2. Team dashboard
  3. Project `.cursor/hooks.json`
  4. User `~/.cursor/hooks.json`

  User hook paths are relative to `~/.cursor/`.
- Input fields: `tool_name`, `tool_input` and `mcp_server_name`, plus either `url`/`mcp_server_url` or `command`. Hooks also accept a `matcher` option.
- Failures: invalid JSON blocks the call, and exit code `2` blocks. Crashes, timeouts and other exit codes fail open unless `failClosed: true` is set. `beforeMCPExecution` is not supported for cloud agents.

Minimal user-level config:

```json
{
  "version": 1,
  "hooks": {
    "beforeMCPExecution": [
      { "command": "hooks/ostraka-people-reminder.sh", "timeout": 5 }
    ]
  }
}
```

The script would check `mcp_server_name` and print `{"permission":"allow","agent_message":"..."}`. A reliable fallback is `postToolUse` with `additional_context`, since that field is documented.

## 3. Claude Code PreToolUse hook on MCP tools

**Answer:** Confirmed. A `PreToolUse` hook in `~/.claude/settings.json` applies to all projects. Its matcher can be a regex: any character outside letters, digits, `_ - , |` and space makes it an unanchored JavaScript regex, so `mcp__slack__.*` works. The `.*` is required, because a bare `mcp__slack` is compared as an exact string. The hook can return `hookSpecificOutput.additionalContext` without a `permissionDecision`. The call then goes through the normal permission flow: the hook doesn't block it or approve it.

Sources:
- Hook locations and matcher rules: https://code.claude.com/docs/en/hooks
- `additionalContext` is supported for PreToolUse: "String added to Claude's context alongside the tool result." It is wrapped in a system reminder. Source: https://code.claude.com/docs/en/hooks
- The docs advise writing the text as factual statements, not imperative system commands, because command-style text can trigger prompt-injection defenses. Source: https://code.claude.com/docs/en/hooks

**Caveat:** the context reaches Claude *with the tool result*, not before the call runs. So it nudges the next step: Claude has already made this lookup, but it can check `people.json` before the next one. To force a check before the call, return `"permissionDecision": "deny"` with a reason, which is shown to Claude. That blocks every lookup, so it is too heavy for v1.

Minimal config in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^mcp__(slack|jira|atlassian|gitlab|m365|microsoft365)__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":\"The ostraka People directory holds colleagues Slack, Jira and GitLab IDs. `ostraka people find <name or email>` returns them without an MCP lookup.\"}}'"
          }
        ]
      }
    ]
  }
}
```

The server names in the matcher must match the names the user gave the servers in their MCP config. Plugin-bundled servers are named `mcp__plugin_<plugin>_<server>__<tool>`.

## 4. Skills auto-selected by description

**Answer:** Confirmed for both editors. One skill at `~/.claude/skills/people/SKILL.md` covers both, because Cursor also loads `~/.claude/skills/`.

- Claude Code:
  - The personal location is `~/.claude/skills/<skill-name>/SKILL.md`, for "All your projects on this machine".
  - The `description` field is what "Claude uses … to decide when to apply the skill".
  - Descriptions are always in context. The skill body loads when the skill is invoked.
  - The description is truncated at 1,536 characters.

  Source: https://code.claude.com/docs/en/skills
- Cursor:
  - User-level skills live in `~/.cursor/skills/` and `~/.agents/skills/`. "For compatibility, Cursor also loads skills from Claude and Codex directories", including `~/.claude/skills/`.
  - "The agent is presented with available skills and decides when they are relevant based on context." The description is "Used by the agent to determine relevance."

  Sources: https://cursor.com/docs/context/skills and https://cursor.com/docs/skills
- In both editors, setting `disable-model-invocation: true` turns off automatic selection. Leave it unset.

## Recommended v1 setup

1. **Global instruction (always loaded).**
   - Claude Code: the installer appends a short block to `~/.claude/CLAUDE.md`, which applies to all projects and loads alongside a project's AGENTS.md. Source: https://code.claude.com/docs/en/memory
   - Cursor: the installer prints the same text, and the user pastes it once into Settings → Rules → User Rules, since these can't be written from disk. Optionally, the installer also writes `~/.cursor/rules/ostraka-people.mdc`, best effort until its loading behavior is verified.
   - The text: "Before looking up a colleague in Slack, Jira, GitLab or M365, run `ostraka people find <name or email>`."
2. **Auto-triggering `people` skill (main mechanism).** The installer writes `~/.claude/skills/people/SKILL.md`, which both editors pick up. The description should lead with the trigger, for example: "Use when the user mentions a colleague, or before any Slack, Jira, GitLab or M365 user lookup…". The body explains `ostraka people find` and how to use the returned IDs.
3. **Optional hooks (safety net, opt-in).**
   - Claude Code: the `PreToolUse` + `additionalContext` hook above. It never blocks.
   - Cursor: `beforeMCPExecution` returning `allow` + `agent_message`, or `postToolUse` + `additional_context` if `agent_message` turns out not to reach the agent.
   - Leave these opt-in, because they depend on the user's MCP server names.
