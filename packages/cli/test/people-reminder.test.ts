// The opt-in reminder hook shipped with the `people` skill: Claude Code runs it before Slack, Jira and GitLab MCP
// tools (PreToolUse), Cursor before every MCP call (beforeMCPExecution). Tested as the editors run it: event JSON on
// stdin, a response on stdout.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HOOK = fileURLToPath(new URL('../../../.claude/skills/people/hooks/people-reminder.sh', import.meta.url))

function runHook(editor: string, event: unknown): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    // As the README's hook configs run it: through /bin/sh, with no PATH.
    const child = spawn('/bin/sh', [HOOK, editor], { env: {} })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout }))
    child.stdin.end(typeof event === 'string' ? event : JSON.stringify(event, null, 2))
  })
}

const claudeEvent = (tool: string) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { query: 'Jane Doe' } })
const cursorEvent = (server: string, tool: string) => ({
  hook_event_name: 'beforeMCPExecution',
  mcp_server_name: server,
  tool_name: tool,
  tool_input: '{"query":"Jane Doe"}',
})

describe.concurrent('people-reminder.sh claude', () => {
  it.each(['mcp__slack__slack_search_users', 'mcp__atlassian__lookupJiraAccountId', 'mcp__GitLab__get_users'])(
    'adds the People directory reminder to the context of %s, without a permission decision',
    async (tool) => {
      const { code, stdout } = await runHook('claude', claudeEvent(tool))
      expect(code).toBe(0)
      const output = JSON.parse(stdout)
      expect(output).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: expect.any(String) } })
      expect(output.hookSpecificOutput.additionalContext).toContain('ostraka people find')
    },
  )

  it.each(['mcp__slack__slack_search_public_and_private', 'mcp__GitLab__list_merge_requests', 'mcp__github__get_user'])(
    'stays silent for %s, which looks no colleague up in a People directory source',
    async (tool) => {
      expect(await runHook('claude', claudeEvent(tool))).toEqual({ code: 0, stdout: '' })
    },
  )
})

describe.concurrent('people-reminder.sh cursor', () => {
  it.each([
    ['slack', 'slack_read_user_profile'],
    ['atlassian', 'lookupJiraAccountId'],
    ['GitLab', 'get_users'],
  ])('allows the %s %s call with the reminder for the agent', async (server, tool) => {
    const { code, stdout } = await runHook('cursor', cursorEvent(server, tool))
    expect(code).toBe(0)
    const output = JSON.parse(stdout)
    expect(output).toEqual({ permission: 'allow', agent_message: expect.any(String) })
    expect(output.agent_message).toContain('ostraka people find')
  })

  it.each([
    ['slack', 'slack_search_public_and_private'],
    ['github', 'get_user'],
  ])('allows the %s %s call with no reminder', async (server, tool) => {
    const { code, stdout } = await runHook('cursor', cursorEvent(server, tool))
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ permission: 'allow' })
  })

  it('allows the call when the event is not JSON it understands, since invalid output would block it', async () => {
    const { code, stdout } = await runHook('cursor', 'not json')
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ permission: 'allow' })
  })
})
