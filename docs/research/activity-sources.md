# Access to Activity sources

Research for issue #3. Researched 2026-10-29. Question: for each **Activity source** (GitLab, Jira, Outlook, Slack), answer five things:

- what Cursor uses today
- how to set up the same in Claude Code
- whether a personal token allows direct REST calls from the local app server
- how to keep credentials out of prompts, agent-readable files and git
- what "my activity on a given day" the source can return, for a **Dev log** or **Briefing**

## Recommendation

1. **Skills (Dev log, Backfill, Briefing) use remote MCP servers with OAuth.** Register them at **user scope** in both Claude Code and Cursor, under the same server names (`GitLab`, `atlassian`, `slack`), so skills can name the same tools in both. The tool stores the OAuth tokens, and they never appear in a file the agent reads. Don't use claude.ai connectors for these. They would attach work accounts to the personal claude.ai account.
2. **The local app server (work overview: open MRs, current sprint) calls REST with a personal token:**
   - GitLab: a fine-grained PAT, or a legacy PAT with `read_api`.
   - Jira: a scoped API token, read-only.

   Store each token in the **macOS Keychain**. The server reads it at startup with `security find-generic-password -w`. No `.env` file goes in the repo, and none goes anywhere agents read.
3. **GitLab has the best per-day data over REST** (`GET /events`). Its MCP server has no events tool, so a Dev log skill may also need a small REST helper. Better: an app-server endpoint the skill calls (see "Open points").
4. **Slack: MCP only.** Direct REST would need a Slack app of your own and a workspace-admin install. The official MCP server already searches by user and date.
5. **Outlook: deferred.** Nothing is configured today, and there is no personal access token. Any route needs an Entra app registration or Work IQ MCP, and both depend on tenant consent policy. Check with IT first.

## What Cursor uses today

Read from `~/.cursor/mcp.json` and the Cursor plugin cache through a filter that dropped secrets. Only server names, URLs and transports were read.

| Source | Cursor server | Endpoint | Auth |
|---|---|---|---|
| GitLab | Cursor plugin `gitlab` (server name `GitLab`) | `https://gitlab.com/api/v4/mcp` (HTTP) | OAuth (`mcp_auth`) |
| Jira | Cursor plugin `atlassian` (Atlassian Rovo MCP) | `https://mcp.atlassian.com/v2/mcp` (streamable HTTP) | OAuth |
| Slack | `slack` in `~/.cursor/mcp.json`, plus the Cursor plugin `slack` | `https://mcp.slack.com/mcp` (HTTP) | OAuth |
| Outlook | none | none | none |

All three are remote OAuth servers. No env keys or header keys hold credentials in the config. There is also a test Atlassian plugin (`Ethienne-Test-Atlassian-Rovo-MCP-Server`, `/v1/mcp/authv2`), which is probably stale.

There is no project-level `.cursor/mcp.json` in this repo.

On the Claude Code side, `~/.claude.json` has no MCP servers. A Docker MCP Toolkit gateway (`docker mcp server ls`) has an `atlassian` server enabled, with secrets and config marked "partial", and it shows up as `MCP_DOCKER` tools in Claude Code sessions. Decide whether to keep it or drop it in favour of Rovo.

Tools cached by Cursor that matter for activity:

- **GitLab:** `list_merge_requests`, `get_merge_request_notes`, `list_commits`, `list_todos`, `list_work_items`, `get_user`, `search`. There is no events or activity tool.
- **Atlassian:** `searchJiraIssuesUsingJql`, `getJiraIssue`, `atlassianUserInfo`, `lookupJiraAccountId`, `search`.
- **Slack:** `slack_search_public_and_private`, `slack_read_channel`, `slack_read_thread`, `slack_read_user_profile`.

## Claude Code setup (general)

- **Scopes:** local (default, `~/.claude.json`, this project only), project (`.mcp.json`, checked in), user (`~/.claude.json`, all projects). Fields are not merged across scopes. ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp))
- **Use user scope.** The sources are personal work accounts, not project config, and project scope means a versioned file. A URL-only `.mcp.json` would hold no secret, but Cursor reads `.cursor/mcp.json` instead, so you would keep two files in sync anyway.
- **OAuth:** run `claude mcp add --transport http <name> <url>`, then `/mcp` (or `claude mcp login <name>`) to sign in. The docs say "Authentication tokens are stored securely and refreshed automatically", and that a client secret goes in the macOS Keychain, "not in your config". Claude Code's own login is in the encrypted macOS Keychain, with a fallback to `~/.claude/.credentials.json` (mode 0600) when the Keychain is locked. ([MCP docs](https://code.claude.com/docs/en/mcp), [Authentication docs](https://code.claude.com/docs/en/authentication))
- **For a header-token server:** use `${VAR}` expansion in `headers`, or better a `headersHelper` script that prints the headers as JSON. The helper can read the Keychain, so no token sits in any config file. ([MCP docs](https://code.claude.com/docs/en/mcp))
- **Personal Claude account vs work sources:** the OAuth grant is between Claude Code and the work service. But content returned by the tools goes to the model under the personal Claude account. That is an employer-policy question (see "Blockers"). If needed, `CLAUDE_CONFIG_DIR` gives a separate config and login per account. ([Authentication docs](https://code.claude.com/docs/en/authentication))

## GitLab

- **MCP setup:**

  ```shell
  claude mcp add -s user --transport http GitLab https://<host>/api/v4/mcp
  ```

  Then `/mcp` to sign in. Notes from the [GitLab MCP server docs](https://docs.gitlab.com/user/model_context_protocol/mcp_server/):
  - Auth is OAuth with dynamic client registration and the `mcp` scope.
  - Fine-grained PATs also work. Legacy PATs are rejected (403).
  - It is generally available since GitLab 19.5, on all tiers, on GitLab.com and Self-Managed.
  - An admin or top-level group owner must allow MCP access.
  - Rate limits on GitLab.com: 60/min on Free, 600/min on Premium and Ultimate.
  - Toolsets on by default: `core`, `merge_requests`, `work_items`, `repository`, `ci`.

  Cursor's plugin points at `gitlab.com`. If the work GitLab is self-hosted, use its host.
- **PAT for REST:** yes. Send it as the `PRIVATE-TOKEN` header. It expires within 365 days by default. Admins (Self-Managed) or enterprise group owners (GitLab.com) can disable PATs. ([PAT docs](https://docs.gitlab.com/user/profile/personal_access_tokens/))
- **My activity on a day:**
  - `GET /events?after=<D-1>&before=<D+1>` lists the authenticated user's events: pushes, comments, MR and issue actions. It needs the `read_user` or `api` scope, and you can filter by `action` and `target_type`. It doesn't return epic or MR-specific events, and large pushes lose their commit details. ([Events API](https://docs.gitlab.com/api/events/))
  - Events older than 3 years are pruned. ([Contributions calendar](https://docs.gitlab.com/user/profile/contributions_calendar))
  - `GET /merge_requests?scope=created_by_me|reviews_for_me&updated_after=…&updated_before=…` lists MRs touched that day. ([MR API](https://docs.gitlab.com/api/merge_requests/))
  - Over MCP: `list_merge_requests`, `list_commits` and `list_todos` cover part of this. With no events tool, MCP gives a weaker Dev log than REST.

## Jira (Atlassian Rovo MCP)

- **MCP setup:**

  ```shell
  claude mcp add -s user --transport http atlassian https://mcp.atlassian.com/v2/mcp
  ```

  Then `/mcp`. Notes from the [Rovo MCP getting started](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) page:
  - Auth is OAuth 2.1, with API tokens as an option.
  - It covers Atlassian Cloud only.
  - Usage is billed in **Rovo credits** per call, so check the work plan's limits.
  - v1 endpoints move to v2 on 2027-03-01.
- **API token for REST:** yes. Use Basic auth with your email and the API token. Notes from [Manage API tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/):
  - Prefer a **scoped** token, sent to `https://api.atlassian.com/ex/jira/{cloudId}`.
  - Expiry is 1 to 365 days.
- **Issue search:** use `/rest/api/3/search/jql`. It pages with `nextPageToken` and has no total count. The old `/rest/api/3/search` is deprecated and being removed. ([Issue search API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), RFC-61)
- **My activity on a day:**
  - JQL `issuekey in updatedBy(<user>, "YYYY-MM-DD", "YYYY-MM-DD")` finds issues the user created, edited a field on, or commented on. Granularity is at least one day, and it works only with `IN` / `NOT IN`. ([JQL functions](https://support.atlassian.com/jira-software-cloud/docs/jql-functions/))
  - I didn't verify whether `currentUser()` works as the argument. Resolve the account ID with `atlassianUserInfo` or `lookupJiraAccountId` instead.
  - For what changed (transitions, fields), read each issue's changelog.
  - Over MCP: `searchJiraIssuesUsingJql` with the same JQL.

## Slack

- **MCP setup:** `/plugin install slack@claude-plugins-official`, or `claude mcp add --transport http --scope user slack https://mcp.slack.com/mcp`, then `/mcp`. Slack's docs show `--scope local`; use `user` for the reasons above. ([Connect to harnesses](https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses))
  - The server uses confidential OAuth and must be backed by a registered Slack app. Dynamic client registration is not supported, so the official plugin ships its own client ID.
  - A **workspace admin must have approved the MCP integration**. Cursor already works, which suggests it is approved for Cursor's app. The Claude app may need its own approval.
  - Rate limits are the same as the Web API. ([Slack MCP server](https://docs.slack.dev/ai/mcp-server/))
- **Token for REST:** only through a Slack app you create, install in the workspace (admin policy applies) and authorize to get a user token (`xoxp`). `search.messages` needs a user token with `search:read`. It is rate-limited at Tier 2 (20+/min), returns 100 per page, and Slack now calls it legacy. ([Tokens](https://docs.slack.dev/authentication/tokens/), [search.messages](https://docs.slack.dev/reference/methods/search.messages/)) Not worth it for one person.
- **My activity on a day:** search for `from:<@MYID> on:<date>`. The modifiers `on:`, `before:`, `after:`, `during:` and `from:` are documented in [Search in Slack](https://slack.com/help/articles/202528808-Search-in-Slack). Over MCP, `slack_search_public_and_private` filters by date and user, then `slack_read_thread` gives the context. This returns messages you sent, not threads you only read.

## Outlook (Microsoft 365)

- **Cursor today:** nothing configured.
- **MCP options:**
  - Microsoft's current option is **Work IQ MCP**: one endpoint with generic tools such as `fetch /me/messages`, authenticated with Entra ID. Its availability "can vary by tenant, region, rollout status, licensing, administrator approval, and organizational policy". ([Agent 365 MCP options](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview), [Work IQ MCP overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview))
  - The older Mail and Calendar MCP servers are legacy and not for new projects.
  - Community servers (for example `@softeria/ms-365-mcp-server`) use Graph through your own sign-in. Vet them before use.
- **Personal token for REST:** Microsoft Graph has no personal access tokens. You need an **Entra app registration** (a public client, device-code or auth-code flow) with delegated permissions:
  - `Calendars.ReadBasic` covers the calendar view.
  - `Mail.Read` covers sent mail.
  - By default, users can consent to permissions that don't need admin consent, such as their own mailbox. But tenants can restrict this to verified publishers or turn it off. ([User consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent))
  - Store the refresh token in the Keychain.
- **My activity on a day:**
  - `GET /me/calendarView?startDateTime=<D>T00:00&endDateTime=<D+1>T00:00` returns the day's meetings, needs `Calendars.ReadBasic`, and supports a timezone offset. ([calendarView](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0))
  - For sent mail, filter `/me/mailFolders/sentitems/messages` on `sentDateTime`. That needs `Mail.Read`; I didn't look this one up for this note.

## Keeping credentials out of prompts, agent files and git

- **OAuth MCP (skills):** the tokens stay in the client's own store, the macOS Keychain or Claude Code's credentials file. Never paste tokens into chat.
- **App server tokens:** keep them in the macOS Keychain. Add with `security add-generic-password -s ostraka-gitlab -a "$USER" -w` (it prompts, so the token stays out of shell history). Read with `security find-generic-password -s ostraka-gitlab -w` at server start. Don't write a `.env` inside the repo, and don't echo tokens in logs or API responses.
- **If an MCP server ever needs a header token,** use `headersHelper` to read the Keychain, never a literal in `.mcp.json` or `~/.claude.json`.
- **Note:** an agent with shell access could still run `security find-generic-password` itself. Keychain items can require approval ("Always Allow" only for the server binary), and Claude Code permission rules can deny `security find-generic-password`.

## Open points

- Where the Dev log skill gets GitLab events: a REST helper with its own token, or the ostraka app server exposing a local `/activity?date=` endpoint that the skill calls. With the endpoint, the token stays in the server and both Claude Code and Cursor skills behave the same.
- Whether the Docker `atlassian` gateway (an API-token server) or Rovo (OAuth, Rovo credits) is the Jira MCP to use.

## Blockers for the user

- **Employer policy:** confirm that sending work GitLab, Jira and Slack content to a model under a personal Claude account is allowed.
- **Slack:** the workspace admin may need to approve the Claude MCP app.
- **Outlook:** ask IT whether user consent to a self-registered Entra app is allowed, or whether Work IQ MCP is enabled for the tenant.
- **GitLab:** confirm the work instance's host (gitlab.com or self-hosted), and that MCP access and PATs are allowed.
