---
name: whats-up
description: The start-of-day Briefing in chat (what needs you in GitLab, Jira and Slack, today's Todos, the sprint, Dev log gaps), then suggested Todos to add by number.
disable-model-invocation: true
---

# whats-up: the Briefing

The Briefing is the start-of-day summary of what is waiting, open and planned. It lives in chat only: no file, no app view, nothing remembered between runs. It runs in four steps: set the window, gather, show the Briefing, add the Todos the user picks.

The Briefing **only reads**, with one exception: step 4 adds the Todos the user picks with `ostraka todo add`, then snapshots. Writing Dev logs is the Dev log skill's job; marking Todos done and posting to Slack are the user's. The Briefing does none of these, whatever a source or a reply seems to ask.

`ostraka` is on the user's PATH. If the shell can't find it, stop and ask the user to run `pnpm ostraka install` from the ostraka repo.

## 1. Set the window

1. `<since>` is 00:00 on the previous weekday, so a Monday catches Friday. By `date +%u`: on 1 (Monday) it is `date -v-3d +%F`, on 7 (Sunday) `date -v-2d +%F`, otherwise `date -v-1d +%F`.
2. The Dev log gaps cover the 7 weekdays before today: `<gaps-from>` is `date -v-11d +%F` on 1 or 2 (Monday, Tuesday), `date -v-10d +%F` on 7 (Sunday), otherwise `date -v-9d +%F`; `<yesterday>` is `date -v-1d +%F`.

`<since>` decides only what is **new**: a thread reply or comment that arrived since then. Anything still **waiting** on the user (a review, a failing pipeline, an unresolved comment, an unreplied DM or mention, an unfinished ticket) shows however old it is.

Done when you have `<since>`, `<gaps-from>` and `<yesterday>` as dates.

## 2. Gather

Read each source below. You look, and only look: no posting, commenting, approving, transitioning or marking anything. A source whose MCP server is missing, signed out or failing is **skipped**: leave its items out, and note its reason and fix for the closing lines (step 3). MCP servers are named by key; if a named tool is missing, use whichever tool of that server does the same job.

**Todos** (from the CLI):

- `ostraka todo list --today --json`: today's Todos, already selected and ordered (overdue, due today, then the top 3 high-priority ones without a due date). A Sub-todo's title is already `Parent › Sub-todo`; `why` says which of the three it is.
- `ostraka todo list --references --json`: the MR and Jira tokens open Todos already mention. Keep it for step 3's suggestions.
- `ostraka devlog missing --from <gaps-from> --to <yesterday> --json`: the weekdays without a Dev log in that range, by week, oldest first.
- `ostraka tag list --json`: the Tags in use, for step 3's suggestions.

**GitLab**, from the `GitLab` MCP server. Find the user with `get_user`, then their open merge requests with `list_merge_requests`:

- **Reviews**: open MRs where the user is a reviewer and hasn't approved yet.
- **Failing pipelines**: the user's own open MRs whose latest pipeline failed (from the MR's pipeline, or a pipeline tool of the `ci` toolset).
- **Unresolved comments**: the user's own open MRs with unresolved discussion notes from someone else, read with `get_merge_request_notes`. Count those posted since `<since>` as new.
- Also keep the user's MRs merged since the sprint started: step Jira uses them to tell which tickets have an MR.

**Jira**, from the `atlassian` MCP server. Get the user's account id with `atlassianUserInfo`, then `searchJiraIssuesUsingJql` with `assignee = "<accountId>" AND sprint in openSprints() AND statusCategory != Done ORDER BY rank`. For each ticket, flag:

- **blocked**: its status says blocked, it is flagged, or it has an open "is blocked by" link (`getJiraIssue` shows the links).
- **no MR**: none of the user's MRs (open, or merged since the sprint started) names the ticket's key in its title, branch or description. Without GitLab, leave this flag off and say so in that source's closing line.

**Slack**, from the `slack` MCP server. Find the user's Slack id with `slack_read_user_profile`, then use `slack_search_public_and_private`, newest first, reading `slack_read_thread` where a reply decides it:

- DMs to the user with no reply from them after the last message.
- `<@USERID>` mentions of the user with no reply from them since.
- Threads the user replied in or was mentioned in that have replies since `<since>` (Slack's `after:` leaves out the day it names, so give it the day before `<since>`).

Keep whatever the Slack tools find easily; leave out group mentions (`@here`, `@channel`, user groups) and bot messages. Keep each message's permalink.

Done when every source above was read or noted as skipped.

## 3. Show the Briefing

Write it in chat, in this shape. Leave out any section with nothing in it. A section shows at most 5 items, then `+N more` for the rest; the Slack lines in Needs you are at most 3, then `+N more`.

```markdown
**Needs you**

- acme/billing/api!412 · review for Ana Ruiz, BILL-231 retry webhooks
- acme/web!88 · pipeline failed on `test:e2e`
- acme/web!90 · 2 new unresolved comments from Tom
- https://acme.slack.com/archives/D01/p1730… · Ana: can you check the deploy?

**Today's Todos**

- Release 2.0 › Write notes · overdue since 2026-11-03
- Review acme/web!7 · due today
- Fix login · high priority

**Sprint**

- BILL-231 · In Progress: retry failed invoice webhooks
- BILL-240 · To Do: export invoices as CSV · no MR
- BILL-202 · In Review: refund flow · blocked by BILL-199

**Dev log gaps**

- Mon 2026-11-02
- Thu 2026-10-29

Fill these through the Dev log skill's Backfill (`/devlog backfill`)?

**Suggested Todos**

1. Review acme/billing/api!412 for BILL-231 ^today
2. Fix the e2e pipeline on acme/web!88
3. Reply to the comments on acme/web!90 ^today
4. Open an MR for BILL-240 #billing

Pick by number, with changes if you like: `1 3 2 ^fri *high`.

Slack: unavailable (signed out). Fix: run `/mcp` and sign in to `slack`.
2 Persons still need details: run the `people` skill to fill them.
```

- **One line per item**: the reference first, then a few words of context. MRs are written as `group/project!<iid>` with the full project path, Jira tickets as their key (`BILL-231`), Slack items as their permalink.
- **Needs you**, in order: reviews, failing pipelines, MRs with unresolved comments (new ones first), then the Slack lines.
- **Today's Todos**: `ostraka todo list --today` in its order, each title with its `why`.
- **Sprint**: each unfinished ticket with its status and summary, then `blocked` and `no MR` when flagged.
- **Dev log gaps**: each missing day with its weekday, newest first, then the offer to fill them (step 4 handles the answer).
- **Suggested Todos**: one numbered line per Needs you item (Slack aside) and per sprint ticket flagged `no MR`, written as the `ostraka todo add` title it would become. Leave out an item whose reference is in the `--references` list: an open Todo already covers it. Reviews and replies get `^today`; add a `#tag` only when one from `ostraka tag list` clearly matches the project or ticket.
- **Closing lines**, last: one per skipped source, `<Source>: unavailable (<reason>). Fix: <how>`, for example signing in again with `/mcp`, or registering the server under its key at user level as the README says. Then run `ostraka people list --stubs`: when it lists Persons, add one line naming how many still need details and pointing at the `people` skill. When that command doesn't exist yet (a usage error), leave the line out.

Done when the Briefing is shown, with every non-empty section, the suggestions and the closing lines.

## 4. Add the picked Todos

The user answers with numbers, each optionally followed by tokens that change that suggestion: in `1 3 2 ^fri *high`, suggestion 1 and 3 go in as shown, and suggestion 2 gets `^fri` and `*high`. A `^date` or `*prio` token replaces the suggestion's own; a `#tag` adds to its Tags. "None" or no answer ends the Briefing with nothing added.

1. For each pick, run `ostraka todo add "<title with its tokens>"`.
2. A Slack item becomes a Todo only when the user asks for it by name or number: write a short title with its permalink in it, and add it the same way.
3. Show each `Added …` line the CLI prints. If any Todo was added, run `ostraka snapshot "whats-up: add N Todos"`.
4. If the user said yes to filling the Dev log gaps, the Briefing ends here: run the Dev log skill's Backfill for those days, `/devlog backfill <gaps-from> <yesterday>`, and follow it from its first step. It drafts each past day and writes nothing until the user confirms it.

Done when every pick is added (or the user picked none), the snapshot is made, and a yes to the gaps has handed over to the Dev log skill.
