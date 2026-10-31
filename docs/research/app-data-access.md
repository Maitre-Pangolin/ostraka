# App data access and refresh

Research for issue #12. Researched 2026-10-31. It builds on [activity-sources.md](https://github.com/Maitre-Pangolin/ostraka/blob/research/activity-sources/docs/research/activity-sources.md) (issue #3), which covers agent-side MCP setup, personal tokens and per-day activity queries. None of that is repeated here.

Settled before this note: agents use MCP whenever a server exists, and company policy is not a blocker for agents. The open question is the **app** side. How does the local app server get work-overview data from GitLab, Jira, Slack and Outlook, and how does it stay up-to-date-ish?

Data items in scope: open MRs, MR pipeline status, review requests, current sprint issues, unanswered Slack mentions and DMs, today's calendar, unread mail.

## Recommendation

1. **The app server polls each source's REST or GraphQL API directly, with its own credentials in the macOS Keychain.** It uses plain `fetch` and no SDK wrappers. Agents keep their MCP grants, and the app never borrows them.
2. **Poll, don't push.** Webhooks and Graph change notifications need a public HTTPS endpoint, and some need admin or Maintainer rights. A tunnel would expose the server that holds every token to the internet. The only push channel that fits a local app is **Slack Socket Mode**, an outbound WebSocket that needs no public URL. Use it if a Slack app gets approved.
3. **Per source:**

   | Source | App route | Credential | Admin needed | Status |
   |---|---|---|---|---|
   | GitLab | GraphQL (one `currentUser` query) plus REST for running pipelines | Fine-grained PAT (`read_api`) | No, unless the enterprise disables PATs | Do now |
   | Jira Cloud | REST `/rest/api/3/search/jql` | Scoped API token, read-only | No | Do now |
   | Outlook | Microsoft Graph with delta queries, MSAL Node public client | Entra app registration, delegated `Calendars.Read` + `Mail.ReadBasic` | Depends on tenant consent policy | Blocked on IT answer |
   | Slack | Own internal Slack app: user token for Web API, plus Socket Mode for push | `xoxp` user token, `xapp` app-level token | Workspace admin, if app approval is on | Optional. Until then, Slack is agent-only (Briefing) |

4. **Don't make the app an MCP client** of the agents' remote servers. It is possible for GitLab, but the other three need extra admin steps or burn paid credits (see "The app as an MCP client"). Keep it as a fallback for GitLab only, if PATs are disabled.
5. **Don't shell out to CLIs** for data. `glab` and `acli` work and keep credentials in the Keychain, but they add a process per poll and a second credential store that agents can also use. They are fine as manual tools.
6. **Refresh rates:** about 60 s for MRs and review requests while the window is visible, 15 s for running pipelines only, 2 to 5 min for the sprint, calendar and mail, and much slower while hidden or idle. See "Refresh-rate table".

## The app as an MCP client

The app could reuse the agents' remote MCP servers through the MCP TypeScript SDK client. Findings:

- **Spec.** The current MCP authorization spec (2026-07-28) prefers Client ID Metadata Documents (CIMD), then pre-registration, and keeps Dynamic Client Registration (DCR) only as a deprecated fallback. CIMD needs the client to host its metadata at an HTTPS URL, which a local-only app doesn't have. ([MCP authorization, latest](https://modelcontextprotocol.io/specification/latest/basic/authorization), [2025-11-25 client registration order](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization))
- **SDK.** v2 ships as `@modelcontextprotocol/client` (stable). v1 `@modelcontextprotocol/sdk` gets fixes for at least six months. ([typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)) The app implements `OAuthClientProvider` itself, including token storage. The guide says to "persist to OS keychain / secure storage — never plain files". The SDK registers the client when it has none, and does not validate `state`, so the app must. ([SDK OAuth guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth.html))

Each server, from its live OAuth metadata (fetched 2026-10-31) and docs:

| Server | Third-party client can register? | Catch for the app |
|---|---|---|
| GitLab `/api/v4/mcp` | Yes. DCR at `https://gitlab.com/oauth/register`, no CIMD advertised ([metadata](https://gitlab.com/.well-known/oauth-authorization-server)). "GitLab does not verify which MCP client application presents the `clientId`" ([MCP server docs](https://docs.gitlab.com/user/model_context_protocol/mcp_server/)) | 60 requests/min and 3,600/hour per user on Free, 600/min and 5,000/hour on Premium and Ultimate. These are per user, shared with the agents. A group owner must allow MCP. ([MCP server docs](https://docs.gitlab.com/user/model_context_protocol/mcp_server/)) |
| Atlassian Rovo `mcp.atlassian.com/v2/mcp` | Yes. DCR at `https://mcp.atlassian.com/v1/register`, public clients (`none`) allowed ([metadata](https://mcp.atlassian.com/.well-known/oauth-authorization-server)) | OAuth only works from allowlisted domains. A local tool's localhost redirect may need the org admin to allowlist it ([KB](https://support.atlassian.com/rovo/kb/fix-oauth-consent-block-for-atlassian-rovo-mcp-server-in-atlassian-cloud/), [admin controls](https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-mcp-server/)). Some tools cost Rovo credits, "1-10 Rovo credits per call" for most enriched calls ([getting started](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/)). Polling would burn credits. |
| Slack `mcp.slack.com/mcp` | No. No `registration_endpoint`, `client_secret_post` only ([metadata](https://mcp.slack.com/.well-known/oauth-authorization-server)). "We do not support … Dynamic Client Registration". Clients must be "backed by a registered Slack app", and "Only directory-published apps or internal apps may use MCP" ([Slack MCP](https://docs.slack.dev/ai/mcp-server/)) | You need your own Slack app and admin approval anyway. Once you have that, the Web API is the simpler route. Rate limits equal the Web API's. No unread tool is listed. |
| Work IQ (Microsoft 365) | Entra ID. Its `WorkIQ.Read` permission has "AdminConsentRequired: Yes" ([permissions](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions)) | Needs a Global Admin to enable it and a usage-based Copilot Credits billing plan ([enable Work IQ](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq)). Polling would cost money. |

Verdict: MCP suits agents, not a poller. MCP tool output is shaped for models, and tool names and shapes can change without an API version. That last point is our judgment and wasn't checked in any server's docs.

## GitLab

**Routes compared**

| Route | Auth and credential store | Fit |
|---|---|---|
| REST / GraphQL + PAT | `PRIVATE-TOKEN` header. Token in the Keychain (see #3) | **Best.** One GraphQL query returns everything. |
| `@gitbeaker/rest` | Same token | Community project (`jdalrymple`), not GitLab ([repo](https://github.com/jdalrymple/gitbeaker)). Latest npm release 43.8.0 on 2025-11-01, a year old ([registry](https://registry.npmjs.org/@gitbeaker/rest)). Not needed for a few endpoints. |
| `glab` CLI | `glab auth login` stores credentials "in your operating system's keyring" by default. `--insecure-storage` writes plaintext to `~/.config/glab-cli/config.yml` ([login docs](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/auth/login.md)) | Documented on docs.gitlab.com as "an open source GitLab CLI tool" ([glab](https://docs.gitlab.com/cli/)). Not installed here. A subprocess per poll; skip. |
| MCP client | OAuth with DCR | See above. Fallback only. |

**What to call**

- GraphQL `currentUser { authoredMergeRequests, assignedMergeRequests, reviewRequestedMergeRequests }`. Each `MergeRequest` has `headPipeline`, "Pipeline running on the branch HEAD of the merge request". ([GraphQL objects](https://docs.gitlab.com/api/graphql/reference/objects/)) One request covers open MRs, review requests and pipeline status. Complexity is capped at 250 for authenticated requests, with a 30 s timeout. ([GraphQL API](https://docs.gitlab.com/api/graphql/)) Our query's score is unverified, so keep `first:` small.
- REST equivalent: `GET /merge_requests?scope=created_by_me|assigned_to_me|reviews_for_me&state=opened&updated_after=…`. The list response has `detailed_merge_status` but not `head_pipeline`, which only the single-MR endpoint returns. ([MR API](https://docs.gitlab.com/api/merge_requests/))
- A running pipeline: `GET /projects/:id/pipelines?updated_after=…` filters by `status` and `updated_after`. The user-level `GET /pipelines` lists only recent pipelines "triggered by the authenticated user", without status filters. ([Pipelines API](https://docs.gitlab.com/api/pipelines/))

**Freshness**

- **Webhooks:** project webhooks need Maintainer or Owner. Group webhooks need Owner and Premium or Ultimate. ([Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)) Self-managed instances block webhooks to local addresses such as `127.0.0.1` by default ([webhook security](https://docs.gitlab.com/security/webhooks/)), so you'd need a public tunnel. Not worth it.
- **ETag / 304:** GitLab has ETag caching with `Poll-Interval`, but it is documented only as an internal developer guide for routes added to `Gitlab::EtagCaching::Router` ([polling](https://docs.gitlab.com/development/polling/)). The REST docs don't mention ETag or 304 ([REST API](https://docs.gitlab.com/api/rest/)). **Unverified** for public API clients, so don't rely on it.
- **GraphQL subscriptions:** not mentioned in the public GraphQL docs. An issue shows PATs were allowed on subscriptions over ActionCable ([issue 455805](https://gitlab.com/gitlab-org/gitlab/-/work_items/455805)), but there is no public contract. **Unverified**, so don't use them.
- **`updated_after`** on MRs and pipelines is the cheap change filter.

**Rate limits**

- GitLab.com today: 2,000 authenticated API requests per minute per user ([GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/)).
- **Proposed** plan-based limits, "not in effect yet", on the same page:
  - Free: 5,000/hour, with an API burst of 100/minute.
  - Premium: 15,000/hour, 1,250/minute.
  - Ultimate: 25,000/hour, 2,000/minute.

  Design for the Free numbers.
- Self-managed defaults: 7,200 per 3,600 s per user, but the limit is disabled by default. `RateLimit-Remaining` is included in all responses. ([User and IP rate limits](https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/))

## Jira Cloud

**Routes compared**

| Route | Auth and credential store | Fit |
|---|---|---|
| REST + scoped API token | Basic auth (email + token) via `api.atlassian.com/ex/jira/{cloudId}`. Token in the Keychain (see #3) | **Best.** No points quota (below). |
| `jira.js` | Basic, OAuth 2.0 (3LO) or bearer | Community (`MrRefactoring`), MIT, covers the Agile API ([repo](https://github.com/MrRefactoring/jira.js)). Active: 6.4.0 on 2026-10-27 ([registry](https://registry.npmjs.org/jira.js)). Optional. |
| `acli` (Atlassian CLI) | Official ([intro](https://developer.atlassian.com/cloud/acli/guides/introduction/)). `acli jira auth login --web` (OAuth) or `--token` from stdin. Has `workitem search --jql … --json`, `board list-sprints` and `sprint list-workitems` (from `--help`, v1.3.11) | Installed here. Its config in `~/.config/acli/*.yaml` (mode 0600) holds no token key, and there is a Keychain item with service `acli`. So it uses the Keychain (observed locally, not documented). Subprocess per poll; skip. |
| Rovo MCP client | OAuth with DCR | Credits and localhost allowlist. Avoid. |

**What to call**

- Current sprint: `POST /rest/api/3/search/jql` with `sprint in openSprints() AND assignee = currentUser()`. `openSprints()` matches sprints that have started but not completed, with `IN` / `NOT IN` only ([JQL functions](https://support.atlassian.com/jira-software-cloud/docs/jql-functions/)). An alternative is `GET /rest/agile/1.0/board/{boardId}/sprint` then `…/sprint/{sprintId}/issue` ([Board API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)).
- Change filter: `updated >= "-5m"`. Relative units `w`, `d`, `h` and `m` are documented for Data Center, quoted ([fields reference, DC](https://confluence.atlassian.com/servicemanagementserver0512/advanced-searching-fields-reference-1306299415.html)). **Unverified on Cloud.** An absolute `"yyyy-MM-dd HH:mm"` from the last sync is safe.

**Freshness**

- **Admin webhooks** need the Administer Jira global permission ([manage webhooks](https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/)).
- **Dynamic webhooks** (`/rest/api/3/webhook`) are for Connect and OAuth 2.0 apps:
  - an OAuth app gets 5 webhooks per user
  - they expire 30 days after creation or refresh
  - the JQL filter supports only a few clauses
  - URLs must be HTTPS with a certificate from a globally trusted CA, and "must use the same base URL as the app"

  ([Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)) A local app can't meet this without a public host. Poll.
- No ETag or long-poll documented. **Unverified**, assume none.

**Rate limits**

- Points-based hourly quotas apply to Forge, Connect and OAuth 2.0 apps. Enforcement starts 2026-03-02, and the default global pool is 65,000 points/hour. ([Rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/))
- "API token-based traffic is not affected by this change, and will continue to be governed by existing burst rate limits." Burst limits are per tenant and per endpoint, for example GET 100 requests/second. (same page) An API token is the right choice for the app.
- On 429, honor `Retry-After` and check `RateLimit-Reason`. Back off with jitter and cap at about 4 retries. (same page)

## Slack

**Routes compared**

| Route | Auth and credential store | Fit |
|---|---|---|
| Web API via own internal Slack app | User token `xoxp-`, issued to the user who installs the app ([tokens](https://docs.slack.dev/authentication/tokens/)). Keychain | Works, but needs the app installed. **Admin approval** applies if the workspace requires approved apps ([app approval](https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace)). |
| `@slack/web-api`, `@slack/socket-mode` | Same tokens | Slack's own SDK, part of the `slackapi` Node SDK ([Node SDK](https://docs.slack.dev/tools/node-slack-sdk/)). Active: 8.3.0 and 3.1.1, both 2026-10-30 ([registry](https://registry.npmjs.org/@slack/web-api)). **Use `@slack/socket-mode`** if Socket Mode is adopted. Bolt is unnecessary. |
| Slack CLI | Stores auth in `~/.slack/credentials.json` ([authorizing](https://docs.slack.dev/tools/slack-cli/guides/authorizing-the-slack-cli/)), a plain file | Built to create and manage apps ([Slack CLI](https://docs.slack.dev/tools/slack-cli/)), not to read messages. No use here. |
| Slack MCP client | Needs own Slack app | See above. No gain over the Web API. |
| Desktop client cache | none | **Off-limits.** It is undocumented and would read data outside any granted scope. This is our judgment. |

**What to call (if a Slack app exists)**

- **Mentions:** use the legacy `search.messages` (user token, `search:read`, Tier 2, 20+/min). Slack recommends `assistant.search.context` instead ([search.messages](https://docs.slack.dev/reference/methods/search.messages/)). That method allows user tokens without an `action_token`, with a per-user limit of 10/min, and it may be unavailable (`feature_not_enabled`) ([assistant.search.context](https://docs.slack.dev/reference/methods/assistant.search.context/)).
- **DMs:**
  - `conversations.info` returns `unread_count` and `unread_count_display` "for DM conversations only" (Tier 3) ([conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)).
  - `conversations.history` with `oldest=<last ts>` fetches the new messages (Tier 3, `im:history`) ([conversations.history](https://docs.slack.dev/reference/methods/conversations.history/)).
- **"Unanswered"** has no API flag. Compute it: a mention or DM with no later reply from me in that thread or DM. This is a design choice.
- **The May 2025 limits change** cut `conversations.history` and `conversations.replies` to 1 request/min and 15 objects. It applies to new non-Marketplace, commercially distributed apps. "Internal customer-built applications are not impacted". ([changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)) So keep the app internal to one workspace.

**Freshness**

- **Events API over HTTP** needs a public Request URL, a 2xx within 3 s, and retries 3 times ([Events API](https://docs.slack.dev/apis/events-api/)).
- **Socket Mode** "allows your app to use the Events API … without exposing a public HTTP Request URL". It uses an app-level token (`xapp-`) in the `Authorization` header and allows up to 10 connections. Connections refresh "once every few hours". Socket Mode apps can't go in the public Marketplace, which doesn't matter for an internal app. ([Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [apps.connections.open](https://docs.slack.dev/reference/methods/apps.connections.open/))
- Events follow the scopes granted by installing users, and a user subscription covers the private channels that user belongs to ([Events API](https://docs.slack.dev/apis/events-api/)). `message.im` needs `im:history` ([message.im](https://docs.slack.dev/reference/events/message.im/)). **Unverified:** that user-scope message events arrive over Socket Mode the same way as over HTTP. Test this with the app.
- **Rate limits:** per method, per workspace, per app. Tiers are 1+, 20+, 50+ and 100+ per minute. On 429, honor `Retry-After`. ([Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/))

## Outlook (Microsoft 365)

**Routes compared**

| Route | Auth and credential store | Fit |
|---|---|---|
| Graph REST + MSAL Node | Entra **public client** app registration. Auth code + PKCE with a localhost redirect ([desktop interactive token](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token-interactive)) | **Best**, once the app registration is allowed. |
| `@azure/msal-node` + `@azure/msal-node-extensions` | The extensions persist the token cache: "MAC - The MAC KeyChain is used", scoped so "only the application that created the cache can access it" ([msal-node-extensions](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/extensions/msal-node-extensions)) | Official and active (7.1.2 / 5.5.4, 2026-10-27, [registry](https://registry.npmjs.org/@azure/msal-node)). **Use both.** |
| `@microsoft/microsoft-graph-client` | Plugs into MSAL or `@azure/identity` | Official, but the last npm release is 3.0.7 from 2023-09-19 ([registry](https://registry.npmjs.org/@microsoft/microsoft-graph-client)). The newer `@microsoft/msgraph-sdk` is "currently in Pre-Release" ([repo](https://github.com/microsoftgraph/msgraph-sdk-typescript)). Use plain `fetch` instead. |
| Microsoft Graph CLI (`mgc`) | none | Deprecated since 2025-09-01, retired 2026-08-28 ([announcement](https://devblogs.microsoft.com/microsoft365dev/microsoft-graph-cli-retirement/)). Dead. |
| CLI for Microsoft 365 (`m365`, PnP) | Needs your own Entra app (`appId` + `tenant`). Tokens are kept "in the password store specific to the platform" ([connecting](https://pnp.github.io/cli-microsoft365/user-guide/connecting-microsoft-365)) | A community (PnP) tool, not installed here. Still needs the same Entra app. No gain. |
| Work IQ MCP | Admin consent and Copilot Credits | No, for polling. |
| Outlook desktop local store | none | **Off-limits** (undocumented). Our judgment. |

**What to call**

- **Permissions:** the folder read and message delta both list `Mail.ReadBasic` as least privileged ([mailFolder get](https://learn.microsoft.com/en-us/graph/api/mailfolder-get?view=graph-rest-1.0), [message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)). The calendar delta needs `Calendars.Read`. `Mail.Read` (bodies) isn't needed for the overview.
- **Unread mail, cheap:** `GET /me/mailFolders/inbox?$select=unreadItemCount`. Microsoft recommends the folder counts over `$count` queries "that can incur significant latency". ([mailFolder](https://learn.microsoft.com/en-us/graph/api/resources/mailfolder?view=graph-rest-1.0))
- **Mail changes:** `GET /me/mailFolders/inbox/messages/delta`, run per folder. It supports `$select` and `$top`, `$filter` only on `receivedDateTime ge|gt`, and a `changeType=created|updated|deleted` option. It also returns read-state changes. ([messages delta](https://learn.microsoft.com/en-us/graph/delta-query-messages))
- **Today's calendar:** `GET /me/calendarView/delta?startDateTime=…&endDateTime=…`, least privilege `Calendars.Read`. `$select`, `$filter` and `$orderby` aren't supported, and removed events outside the window also come back. ([event delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0)) Start a new delta round each day.
- **Delta tokens for Outlook entities** have no fixed lifetime; they depend on a cache. On expiry Graph returns a 40X such as `syncStateNotFound`, and a `410 Gone` means do a full resync. ([delta overview](https://learn.microsoft.com/en-us/graph/delta-query-overview))

**Freshness**

- **Change notifications** need "a publicly accessible, HTTPS-secured endpoint" with these properties ([webhooks delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)):
  - validation within 10 s
  - a 2xx within 3 s
  - Graph may drop notifications to slow endpoints
- Outlook `message` and `event` subscriptions last at most 10,080 minutes, just under 7 days, so they need renewing. Message latency is "less than 1 minute" on average. ([subscription](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0))
- That rules out a local app, short of a tunnel or Azure Event Hubs / Event Grid. **Use delta polling**, which Microsoft recommends over plain polling ([throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)).
- **Lead, unverified:** the subscription resource now documents Web Push (`vapidPublicKey`, `notificationUrl` on `*.push.apple.com` and similar) ([subscription](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)). That could deliver to a browser service worker without a public endpoint. I didn't check whether it supports Outlook resources or delegated tokens.
- **Rate limits:** Outlook allows 10,000 requests per 10 minutes and 4 concurrent requests, per app per mailbox ([Outlook service limits](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits)). On 429, wait `Retry-After` ([throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)).

## Push vs poll

| Source | Push option | What it needs | Fits a local app? |
|---|---|---|---|
| GitLab | Project or group webhooks | Maintainer/Owner (group: Owner + Premium), a reachable URL | No |
| Jira | Admin webhooks, or dynamic webhooks for OAuth/Connect apps | Administer Jira, or an app whose base URL hosts the HTTPS receiver with a CA-signed cert | No |
| Slack | Events API over HTTP, or **Socket Mode** | Own Slack app. Socket Mode needs an `xapp` token and no public URL | **Yes, Socket Mode**, once an app is approved |
| Outlook | Graph change notifications | Public HTTPS, 3 s responses, renewal at least weekly | No |

**Tunnels**, the local-webhook workaround:

- **Cloudflare Quick Tunnels** are "for testing and development", with "no uptime guarantee", and the hostname changes on every run ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)). Webhook registrations would break on every restart.
- **smee.io** is "intended for use in development, not for production", and "channels are not authenticated" ([smee.io](https://github.com/probot/smee.io)). Anyone with the channel ID sees work payloads.
- **Tailscale Funnel** exposes a local service to the public internet on ports 443, 8443 or 10000 only. It needs MagicDNS, HTTPS certificates and a policy attribute ([Funnel](https://tailscale.com/docs/features/tailscale-funnel)).
- **Shared problem:** the receiving process is the server holding all four tokens. Every exposed route needs signature checks, `clientState` checks for Graph, and IP filtering. It is still a public attack surface on a laptop that sleeps, and missed events would need polling to repair anyway. This is our judgment.

**Verdict:** poll everywhere. Add Slack Socket Mode if and when an internal Slack app exists.

## Refresh-rate table

Visibility comes from the Page Visibility API (`document.visibilityState`, `visibilitychange`). Browsers throttle timers in hidden tabs anyway ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)). So **the server owns the schedule**, and the front end only tells it "visible", "hidden" or "refresh now". The server pushes results to the UI over a local SSE or WebSocket.

| Data item | Call | Visible | Hidden or idle (> 15 min no input) | Extra triggers |
|---|---|---|---|---|
| Open MRs (mine, assigned) | GitLab GraphQL `currentUser` query (one request) | 60 s | 10 min | Manual refresh, window focus, wake |
| Review requests | Same query (`reviewRequestedMergeRequests`) | 60 s | 10 min | Same |
| MR pipeline status | `headPipeline` in the same query. While any is `running`/`pending`: `GET /projects/:id/pipelines/:pipeline_id` for those only | 15 s while running, else follows MRs | 2 min while running | Stop when finished. Cap at 5 running pipelines |
| Current sprint issues | Jira `search/jql` with `sprint in openSprints() AND assignee = currentUser()`. Optionally a cheap pre-check with `updated >= "<last sync>"` and `fields=key` | 3 min | 15 min | Manual refresh, wake |
| Unanswered Slack mentions/DMs | Socket Mode events (push). Without push: `search.messages` / `assistant.search.context` + DM `unread_count` | Push, or 3 min | Push, or 15 min | Reconnect on wake |
| Today's calendar | Graph `calendarView/delta` for today | 5 min | 30 min | New round at midnight, on wake, 1 min before the next meeting |
| Unread mail | `inbox?$select=unreadItemCount`, then `messages/delta` only if the count changed or every 15 min | 2 min | 15 min | Manual refresh |

**Budget check** at the visible rates:

- **GitLab:** about 1 query/min plus 4/min per running pipeline. With 3 running, that is 13/min, about 780/hour. That is under the proposed Free limits of 100/min and 5,000/hour, and far under today's 2,000/min. If agents use GitLab MCP at the same time, those calls count against MCP's own 60/min limit, not the REST limit.
- **Jira:** 20 searches/hour. Only burst limits apply to API tokens.
- **Slack:** at most 1 search/3 min plus a few `conversations.info` calls. That is far under Tier 2 and 3.
- **Graph:** about 1/min, against 10,000 per 10 min per mailbox.

**Rules for every poller:**

- Back off exponentially on errors, honoring `Retry-After` (Jira, Slack, Graph) and `RateLimit-Remaining` (GitLab).
- Never run two fetches for the same item at once.
- Detect wake by timer drift: if an interval fires much later than scheduled, refresh everything once. This is a design choice; a Node server has no sleep events of its own.
- Show the last-updated time per panel.

## Credentials

- **The app gets its own credentials, separate from the agents' MCP grants:**
  - GitLab: fine-grained PAT, `read_api`
  - Jira: scoped read-only API token
  - Slack: `xoxp` + `xapp`
  - Outlook: MSAL cache
- **Where they live:**
  - GitLab, Jira and Slack: Keychain items, read at server start (method in #3).
  - Outlook: `msal-node-extensions` Keychain persistence for the MSAL token cache.
  - Never in `.env`, prompts, repo files or logs.
- **Avoid these stores:** the Slack CLI's `~/.slack/credentials.json`, and `glab --insecure-storage`. Both are plain files that agents can read.
- **CLIs share their store with agents.** `glab` and `acli` keep tokens in the Keychain, but any agent with shell access can run `glab api …` or `acli jira …` with them. That's one more reason the app shouldn't depend on them.
- **If the MCP-client fallback is ever used:** the app's `OAuthClientProvider` writes tokens and client registration to the Keychain, never to files ([SDK OAuth guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth.html)).

## Open points

- **Keychain access by binary:** if the server runs as `node`, then "Always Allow" for its items applies to every Node script on the machine. Consider a packaged binary or a small helper with its own code signature. Unverified how macOS scopes this for `security` and `node`.
- **GitLab:** the GraphQL complexity of the combined `currentUser` query is unmeasured. Also watch when GitLab.com's proposed plan limits take effect.
- **Jira:** confirm `updated >= "-5m"` on Cloud.
- **Slack:** confirm that user-scope `message.*` events arrive over Socket Mode. Decide whether `search.messages` (legacy) or `assistant.search.context` is enabled in the workspace.
- **Outlook:** check whether Graph Web Push subscriptions work for Outlook resources. That would give push without a public endpoint.
- **Agent endpoint:** whether agents should read work-overview data from the app's local cache (the `/activity` endpoint idea in #3) instead of MCP when the data is already fresh.

## Blockers for the user

- **Outlook:** ask IT whether you may register an Entra public-client app and consent yourself to `Calendars.Read` and `Mail.ReadBasic`, or whether admin consent is needed ([user consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)). Without this, there is no Outlook in the app.
- **Slack (optional):** ask a workspace admin to approve an internal Slack app with the needed user scopes (`search:read`, `im:history`, `im:read`), plus Socket Mode. Without it, Slack stays agent-only, through the Briefing skill.
- **GitLab:** confirm the host, and that fine-grained PATs are not disabled by the enterprise group. No Maintainer role is needed, because there are no webhooks.
- **Jira:** none for REST with a scoped API token. If the org uses an Atlassian IP allowlist, check that your network is on it. The allowlist is documented for MCP tool calls ([admin controls](https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-mcp-server/)); for REST it is unverified. Avoid needing an admin to allowlist a localhost redirect for Rovo, which only the MCP-client route would require.
