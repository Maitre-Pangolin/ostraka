#!/bin/sh
# Opt-in reminder hook of the `people` skill; the README ("Colleagues in every project") says how to turn it on.
# Usage: people-reminder.sh claude|cursor, with the editor's hook event JSON on stdin.
# It fires only on a tool that looks a colleague up (user, account, profile, member) in Slack, Jira, GitLab or M365.
# Claude Code (PreToolUse): adds the reminder to the context and leaves the permission decision alone.
# Cursor (beforeMCPExecution): always allows the call, with the reminder as agent_message on a lookup.
PATH=/usr/bin:/bin
REMINDER='The ostraka People directory caches the email, Slack, GitLab and Jira IDs of colleagues: `ostraka people find <name or email>` returns them without an MCP lookup, and the people skill adds a colleague it is missing.'

event=$(tr '\n' ' ')
field() { printf '%s' "$event" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"; }
server=$(field mcp_server_name)
tool=$(field tool_name)
# Claude Code names an MCP tool mcp__<server>__<tool>.
case $tool in
mcp__*__*)
  server=${tool#mcp__}
  server=${server%%__*}
  tool=${tool#mcp__*__}
  ;;
esac

lookup=no
if printf '%s' "$server" | grep -Eiq 'slack|atlassian|jira|gitlab|m365|microsoft|outlook' &&
  printf '%s' "$tool" | grep -Eiq 'user|account|profile|member'; then
  lookup=yes
fi

case $1 in
claude)
  if [ $lookup = yes ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$REMINDER"
  fi
  ;;
cursor)
  if [ $lookup = yes ]; then
    printf '{"permission":"allow","agent_message":"%s"}\n' "$REMINDER"
  else
    printf '{"permission":"allow"}\n'
  fi
  ;;
esac
exit 0
