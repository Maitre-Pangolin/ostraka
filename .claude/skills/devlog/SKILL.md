---
name: devlog
description: Drafts today's Dev log from the user's finished Todos, GitLab, Jira and Slack activity, gets their confirmation, then writes and snapshots it. Use when the user asks to write, fill or log today's Dev log (`/devlog`), or the Briefing offers to fill today's gap.
---

# Dev log: today

A Dev log is the record of one working day. This skill writes **today's** Dev log, in four steps: gather, draft, confirm, write. Nothing is written until the user confirms the draft.

`ostraka` is on the user's PATH. If the shell can't find it, stop and ask the user to run `pnpm ostraka install` from the ostraka repo.

## 1. Check the day

1. Today is the local date, `date +%F`. Call it `<date>`.
2. Run `ostraka devlog list --from <date> --to <date>`. If it lists `<date>`, today already has a Dev log: tell the user its path (`ostraka path devlogs`, then `<date>.md`) and stop. That file is theirs, kept as written.
3. Read [format.md](format.md), in this folder: the Dev log format the app validates. Every line you draft follows it.

Done when you have `<date>`, no Dev log exists for it, and you have read format.md.

## 2. Gather

Read each Activity source for `<date>`. Each one is read-only: you look, you never post, comment, transition or mark anything. A source whose MCP server is missing, signed out or failing is skipped: say so in one line above the draft, and leave it out of `sources`. MCP servers are named by key below; if a named tool is missing, use whichever tool of that server does the same job.

- **Todos** (`todos`): `ostraka todo list --finished-on <date> --json`. Each Todo done that day goes in Done as `[title](todo:<id>)`; each Dropped one as `Dropped [title](todo:<id>)`, then `: <dropReason>` when there is one.
- **GitLab** (`gitlab`), from the `GitLab` MCP server. Find the user with `get_user`, then their merge requests touched that day with `list_merge_requests`: those they authored and those they review, updated on `<date>`. Keep what the user did that day:
  - opened (created on `<date>`), merged or closed (on `<date>`), and reviewed (they approved, or wrote a note on `<date>`; `get_merge_request_notes` shows the notes).
  - Write each as one Done line with the MR token `group/project!<iid>` (full project path) and its Jira ticket, taken from the MR's title, branch or description: `Opened acme/billing/api!412 for BILL-231: retry failed invoice webhooks`.
- **Jira** (`jira`), from the `atlassian` MCP server. Get the user's account id with `atlassianUserInfo`, then `searchJiraIssuesUsingJql` with `issuekey in updatedBy("<accountId>", "<date>", "<date>")`. For each ticket, `getJiraIssue` (with its changelog and comments) tells what the user did: created it, moved it, commented. One Done line per ticket, as its token (`BILL-231`). A ticket already named on an MR line gets its own line only for something the MR line doesn't say.
- **Slack** (`slack`), from the `slack` MCP server. Find the user's Slack id with `slack_read_user_profile`, then `slack_search_public_and_private` with `from:<@USERID> on:<date>`. Open the threads that look substantial with `slack_read_thread`. Group messages by conversation, not one line per message: a discussion worth keeping goes in Meetings & discussions, a decision or blocker in Notes. Small talk and quick acknowledgements are left out.
- **Outlook**: there is no Outlook source yet. Leave `outlook` out of `sources`, and ask about meetings in step 3.

People named in a line are Mentions, `@<person id>`. Look each one up with `ostraka people find <name or email>`. When it finds nobody, or fails, write their name as plain text and remember them for step 4.

Done when every source above was read or noted as skipped.

## 3. Draft and confirm

1. Pick at most 3 Tags for the day. Run `ostraka tag list` and prefer Tags already there, taken from the day's Todos and work. Suggest a new Tag only for a project, initiative or recurring area, lowercase and hyphenated.
2. Show the whole file as it would be written, in a `markdown` code block: the header (`date`, the suggested `tags`, the `sources` actually read), then Done, Meetings & discussions and Notes, each section only when it has a line. One line per item, short plain sentences.
3. Under it, ask: **"Any meetings worth noting?"**, and whether to write it as is, change it, add context, change the Tags or mark the day off.

Then apply each reply and show the updated file again:

- **Context** (a quick note, or a loose dump of thoughts, typed or dictated): reword each piece into short lines in the right section. Finished work goes in Done, a meeting or conversation in Meetings & discussions, context, decisions and blockers in Notes.
- **Meetings** the user names go in Meetings & discussions, one line each.
- **Edits and Tag changes**: apply them as given.
- **Off day**: the file becomes the header `date`, `off: true` and, if the user gives one, a `label` such as `Holiday`, with no body.

Done when the user's latest reply approves the file exactly as last shown.

## 4. Write

1. Write the approved file to `<devlogs>/<date>.md`, where `<devlogs>` is the output of `ostraka path devlogs`.
2. Run `ostraka devlog list --from <date> --to <date>`. A `broken:` line means the header failed the app's validation: fix the file to match format.md and run it again until `<date>` lists without `broken:`.
3. Run `ostraka snapshot "devlog: <date>"`.
4. Tell the user the file's path. If any person was written as a plain name, name them in one line and offer to add them with the `people` skill.

Done when the file lists without `broken:` and the snapshot is made.
