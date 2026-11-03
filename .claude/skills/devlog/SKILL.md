---
name: devlog
description: Writes Dev logs from the user's finished Todos, GitLab, Jira and Slack activity, for today, a past day or a Backfill of missing days, adding only what is missing to a day already written. Also reformats old days (`reformat <date|range>`) and writes a month's summary. Use when the user asks to write, fill, catch up on or reformat Dev logs (`/devlog`), asks for a monthly summary, or the Briefing offers to fill Dev log gaps.
---

# Dev log

A Dev log is the record of one working day. Every branch of this skill drafts first, shows the user the exact file, and writes only what the user approved. Each run ends with one Snapshot.

`ostraka` is on the user's PATH. If the shell can't find it, stop and ask the user to run `pnpm ostraka install` from the ostraka repo.

## Pick the branch

Today is the local date, `date +%F`. Read [format.md](format.md), in this folder, before drafting anything: the Dev log format the app validates. Every file you write follows it.

| The user asks for                                                                           | Do                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Today's Dev log (`/devlog`)                                                                 | [The day flow](#the-day-flow) for today, then [end the run](#end-the-run) |
| One past day (`/devlog 2026-10-29`)                                                         | The day flow for that day, then end the run                               |
| A Backfill: catch up, fill the gaps, a week or a range (`/devlog backfill [<from> [<to>]]`) | Follow [backfill.md](backfill.md)                                         |
| `reformat <date\|range>`                                                                    | Follow [reformat.md](reformat.md)                                         |
| A monthly summary (`/devlog summary [<YYYY-MM>]`)                                           | Follow [monthly-summary.md](monthly-summary.md)                           |

`reformat` and the monthly summary run only when the user asks for them by name; the other branches never restructure a day or touch a summary.

## The day flow

One day, called `<date>`, in four steps: check, gather, draft and confirm, write.

### 1. Check the day

Run `ostraka devlog list --from <date> --to <date>` and read its line for `<date>`:

- **No line**: a new day. Draft it whole.
- **`off`**: an off day. Tell the user and leave it as it is; the day flow is done.
- **`broken:`**: tell the user the error and leave the file as it is (`reformat <date>` can fix it on request); the day flow is done.
- **Any other line**: an **existing day**. Read `<devlogs>/<date>.md`, where `<devlogs>` is the output of `ostraka path devlogs`. Its text is the user's: every line and header value stays exactly as written, and you draft only its missing items.

### 2. Gather

Read each Activity source for `<date>`. Each one is read-only: you look, you never post, comment, transition or mark anything. A source whose MCP server is missing, signed out or failing is skipped: say so in one line above the draft, and leave it out of `sources`. MCP servers are named by key below; if a named tool is missing, use whichever tool of that server does the same job.

- **Todos** (`todos`): `ostraka todo list --finished-on <date> --json`. Each Todo done that day goes in Done as `[title](todo:<id>)`; each Dropped one as `Dropped [title](todo:<id>)`, then `: <dropReason>` when there is one.
- **GitLab** (`gitlab`), from the `GitLab` MCP server. Find the user with `get_user`, then their merge requests with `list_merge_requests`: those they authored and those they review, updated on or after `<date>`. Keep what the user did on `<date>`:
  - opened (created on `<date>`), merged or closed (on `<date>`), and reviewed (they approved, or wrote a note on `<date>`; `get_merge_request_notes` shows the notes).
  - Write each as one Done line with the MR token `group/project!<iid>` (full project path) and its Jira ticket, taken from the MR's title, branch or description: `Opened acme/billing/api!412 for BILL-231: retry failed invoice webhooks`.
- **Jira** (`jira`), from the `atlassian` MCP server. Get the user's account id with `atlassianUserInfo`, then `searchJiraIssuesUsingJql` with `issuekey in updatedBy("<accountId>", "<date>", "<date>")`. For each ticket, `getJiraIssue` (with its changelog and comments) tells what the user did that day: created it, moved it, commented. One Done line per ticket, as its token (`BILL-231`). A ticket already named on an MR line gets its own line only for something the MR line doesn't say.
- **Slack** (`slack`), from the `slack` MCP server. Find the user's Slack id with `slack_read_user_profile`, then `slack_search_public_and_private` with `from:<@USERID> on:<date>`. Open the threads that look substantial with `slack_read_thread`. Group messages by conversation, not one line per message: a discussion worth keeping goes in Meetings & discussions, a decision or blocker in Notes. Small talk and quick acknowledgements are left out.
- **Outlook**: there is no Outlook source yet. Leave `outlook` out of `sources`, and ask about meetings in step 3.

People named in a line are Mentions, `@<person id>`. Look each one up with `ostraka people find <name or email>`. When it finds nobody, or fails, write their name as plain text and remember them for the end of the run.

Done when every source above was read or noted as skipped.

### 3. Draft and confirm

**A new day:**

1. Pick at most 3 Tags for the day. Run `ostraka tag list` and prefer Tags already there, taken from the day's Todos and work. Suggest a new Tag only for a project, initiative or recurring area, lowercase and hyphenated.
2. Show the whole file as it would be written, in a `markdown` code block: the header (`date`, the suggested `tags`, the `sources` actually read), then Done, Meetings & discussions and Notes, each section only when it has a line. One line per item, short plain sentences.
3. Under it, ask: **"Any meetings worth noting?"**, and whether to write it as is, change it, add context, change the Tags or mark the day off.

**An existing day:**

1. Keep only the **missing items**: a gathered item is already there when the file names its Todo id, MR or Jira token, or says the same thing in other words.
2. If nothing is missing, say the day is complete; the day flow is done, with nothing written.
3. Otherwise list the missing items under their sections, then show the whole file with them added, in a `markdown` code block: each new line at the end of its section, a section the file lacks added in its place in the order. In the header, add to `sources` only the sources the new lines came from, and suggest Tags only for free slots up to 3. If the day's sections don't follow format.md, still add the lines, and mention once that `reformat <date>` can restructure it.
4. Ask the same questions as for a new day, without the off day.

Then apply each reply and show the updated file again:

- **Context** (a quick note, or a loose dump of thoughts, typed or dictated): reword each piece into short lines in the right section. Finished work goes in Done, a meeting or conversation in Meetings & discussions, context, decisions and blockers in Notes.
- **Meetings** the user names go in Meetings & discussions, one line each.
- **Edits and Tag changes**: apply them as given.
- **Off day**: the file becomes the header `date`, `off: true` and, if the user gives one, a `label` such as `Holiday`, with no body.

Done when the user's latest reply approves the file exactly as last shown.

### 4. Write

1. Write the approved file to `<devlogs>/<date>.md`. For an existing day, the user's lines and header values are byte for byte as they were, with only the approved additions.
2. Run `ostraka devlog list --from <date> --to <date>`. A `broken:` line means the header failed the app's validation: fix the file to match format.md and run it again until `<date>` lists without `broken:`.

Done when the file lists without `broken:`. The Snapshot waits for the end of the run.

## End the run

Every run ends here, once, whichever branch it took and however many files it wrote:

1. Run `ostraka snapshot "<message>"` once: `devlog: <date>` for one day, `devlog: backfill <first date>..<last date>` for a Backfill, `devlog: reformat <first date>..<last date>`, or `devlog: summary <YYYY-MM>`. With nothing written, it reports that nothing changed, which is fine.
2. Tell the user the path of each file written.
3. If any person was written as a plain name, name them in one line and offer to add them with the `people` skill.
