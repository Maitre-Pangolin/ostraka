---
name: devlog
description: Writes Dev logs from the user's activity (finished Todos, GitLab, Jira, Slack, and Outlook mail and calendar when connected) for today, a past day or a Backfill of missing days, adding only what is missing to a day already written. Also writes a month's summary from its days. Use when the user asks to write, fill or catch up on Dev logs (`/devlog`), asks for a monthly summary, or the Briefing offers to fill Dev log gaps.
---

# Dev log

A Dev log is the record of one working day, written from the user's Activity sources. Every branch of this skill drafts first, shows the user the exact file, and writes only what the user approved. Each run ends with one Snapshot.

`ostraka` is on the user's PATH. If the shell can't find it, stop and ask the user to run `pnpm ostraka install` from the ostraka repo.

## Pick the branch

Today is the local date, `date +%F`. Read [format.md](format.md), in this folder, before drafting anything: the Dev log format the app validates. Every file you write follows it.

| The user asks for                                                                           | Do                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Today's Dev log (`/devlog`)                                                                 | [The day flow](#the-day-flow) for today, then [end the run](#end-the-run) |
| One past day (`/devlog 2026-10-29`)                                                         | The day flow for that day, then end the run                               |
| A Backfill: catch up, fill the gaps, a week or a range (`/devlog backfill [<from> [<to>]]`) | Follow [backfill.md](backfill.md)                                         |
| A monthly summary (`/devlog summary [<YYYY-MM>]`)                                           | Follow [monthly-summary.md](monthly-summary.md)                           |

The monthly summary runs only when the user asks for it by name. No branch restructures a day already written or touches a summary it wasn't asked for.

## The day flow

One day, called `<date>`, in four steps: check, gather, draft and confirm, write.

### 1. Check the day

Run `ostraka devlog list --from <date> --to <date>` and read its line for `<date>`:

- **No line**: a new day. Draft it whole.
- **`off`**: an off day. Tell the user and leave it as it is; the day flow is done.
- **`broken:`**: tell the user the error and leave the file as it is; the day flow is done.
- **Any other line**: an **existing day**. Read `<devlogs>/<date>.md`, where `<devlogs>` is the output of `ostraka path devlogs`. Its text is the user's: every line and header value stays exactly as written, and you draft only its missing items.

### 2. Gather

Read each Activity source for `<date>`. Each one is read-only: you look, you never post, comment, transition or mark anything. A source whose MCP server is missing, signed out or failing is skipped: say so in one line above the draft, and leave it out of `sources`. MCP servers are named by key below; if a named tool is missing, use whichever tool of that server does the same job.

- **Todos** (`todos`): `ostraka todo list --finished-on <date> --json`. It lists Sub-todos finished that day too, each with its `parent`; a Sub-todo is an item of its own, with its own title and id, whatever its parent's state. Each Todo or Sub-todo done that day goes in Done as `[title](todo:<id>)`; each Dropped one as `Dropped [title](todo:<id>)`, then `: <dropReason>` when there is one.
- **GitLab** (`gitlab`), from the `GitLab` MCP server. Find the user with `get_user`, then their merge requests with `list_merge_requests`: those they authored and those they review, updated on or after `<date>`. Keep what the user did on `<date>`:
  - opened (created on `<date>`), merged or closed (on `<date>`), and reviewed (they approved, or wrote a note on `<date>`; `get_merge_request_notes` shows the notes).
  - Write each as one Done line with the MR token `group/project!<iid>` (full project path) and its Jira ticket, taken from the MR's title, branch or description: `Opened acme/billing/api!412 for BILL-231: retry failed invoice webhooks`.
- **Jira** (`jira`), from the `atlassian` MCP server. Get the user's account id with `atlassianUserInfo`, then `searchJiraIssuesUsingJql` with `issuekey in updatedBy("<accountId>", "<date>", "<date>")`. For each ticket, `getJiraIssue` (with its changelog and comments) tells what the user did that day: created it, moved it, commented. One Done line per ticket, as its token (`BILL-231`). A ticket already named on an MR line gets its own line only for something the MR line doesn't say.
- **Slack** (`slack`), from the `slack` MCP server. Find the user's Slack id with `slack_read_user_profile`, then `slack_search_public_and_private` with `from:<@USERID> on:<date>`. Open the threads that look substantial with `slack_read_thread`. Group messages by conversation, not one line per message: a discussion worth keeping goes in Meetings & discussions, a decision or blocker in Notes. Small talk and quick acknowledgements are left out.
- **Outlook** (`outlook`), from the `m365` MCP server, when it is connected. Two parts, each read with whichever tool of the server does the job:
  - **Calendar**: the user's events on `<date>`. Keep the meetings they accepted or organised, leaving out declined ones, focus blocks, holds and all-day reminders. One Meetings & discussions line per meeting worth keeping, its subject in plain words and its attendees as Mentions when there are few (`Sprint planning with @jane-doe and @sam-lee`). A recurring stand-up is left out unless something was decided in it. An all-day event saying the user was away (holiday, sick, out of office) is a hint the day is off: say so above the draft.
  - **Mail**: the messages the user sent on `<date>`. Group them by thread: a decision, a commitment or a blocker goes in Notes, a discussion worth keeping in Meetings & discussions. Newsletters, notifications and quick replies are left out.

  `outlook` goes in `sources` when either part was read. Without the server, skip it as any other source and ask about meetings in step 3.

People named in a line are written as Mentions, `@<person id>`. Find each one with the `people` skill: `ostraka people find <name, email or Slack ID>` first (a Slack message carries the Slack ID, so search by it), MCP only for someone it doesn't find. A Person marked `(ignored)` is written as their plain name. Someone not in the People directory is written as their plain name for now and kept as a `people` candidate for the end of the run.

Done when every source above was read or noted as skipped.

### 3. Draft and confirm

**A new day:**

1. Pick at most 3 Tags for the day. Run `ostraka tag list` and prefer Tags already there, taken from the day's Todos and work. Suggest a new Tag only for a project, initiative or recurring area, lowercase and hyphenated.
2. Show the whole file as it would be written, in a `markdown` code block: the header (`date`, the suggested `tags`, the `sources` actually read), then Done, Meetings & discussions and Notes, each section only when it has a line. One line per item, short plain sentences.
3. Under it, ask: **"Any meetings worth noting?"** (**"Any other meetings worth noting?"** when the Outlook calendar was read), and whether to write it as is, change it, add context, change the Tags or mark the day off.

**An existing day:**

1. Keep only the **missing items**: a gathered item is already there when the file names its Todo id, MR or Jira token, or says the same thing in other words.
2. If nothing is missing, say the day is complete; the day flow is done, with nothing written.
3. Otherwise list the missing items under their sections, then show the whole file with them added, in a `markdown` code block: each new line at the end of its section, a section the file lacks added in its place in the order. In the header, add to `sources` only the sources the new lines came from, and suggest Tags only for free slots up to 3. If the day's sections don't follow format.md, still add the lines, each in the section it belongs to, and leave the rest of the day as it is.
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

1. Offer to add the `people` candidates of the files written, as the `people` skill's last step says: each one added becomes `@<person id>` in those files. Its Snapshot is the next step's.
2. Run `ostraka snapshot "<message>"` once: `devlog: <date>` for one day, `devlog: backfill <first date>..<last date>` for a Backfill, or `devlog: summary <YYYY-MM>`. A skill that borrows this step gives its own message. With nothing written, it reports that nothing changed, which is fine.
3. Tell the user the path of each file written.
