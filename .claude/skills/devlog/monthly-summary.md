# Monthly summary

The monthly summary is `<devlogs>/<YYYY-MM>.md`, written on request from that month's Dev logs. The app shows it on top of the month's weeks and never writes it: this skill is the only writer.

## 1. Read the month

1. The month is the one the user names, `<YYYY-MM>`. If they name none, ask, suggesting last month.
2. Run `ostraka devlog list --from <YYYY-MM>-01 --to <last day of the month> --json` and `ostraka path devlogs` for `<devlogs>`.
3. Read every day's file in the list, `<devlogs>/<date>.md`. Count the off days, with their labels. A broken day is read for its body too; name it in one line above the draft.
4. If the list has the summary `<YYYY-MM>`, read it: the current summary, which the new one replaces.

The summary comes from these files only. Activity sources stay unread: what the days don't say, the summary doesn't either.

Done when you have read every day of the month.

## 2. Draft and confirm

Draft the file, following the monthly summary in [format.md](format.md):

- The header: `month: <YYYY-MM>`, and as `tags` the month's Tags used on more than one day, most used first.
- `# <Month YYYY>`, then one bullet per theme (a project, an initiative, a recurring area such as reviews or support), led by its name in `**strong**`: what was done, decided or left open, with the MR and Jira tokens and `@` Mentions the days used.
- A last bullet for what carries into next month, when the days name any, and one for off days when there were any (`**Off**: 3 days, Holiday`).

Every line comes from at least one day. Show the file in a `markdown` code block, under the current summary when there is one, and ask whether to write it, change it or add to it. Apply each reply and show it again.

Done when the user's latest reply approves the file exactly as last shown.

## 3. Write

1. Write the approved file to `<devlogs>/<YYYY-MM>.md`.
2. Run `ostraka devlog list --from <YYYY-MM>-01 --to <YYYY-MM>-01`; fix the file until `<YYYY-MM>` lists without `broken:`.
3. [End the run](SKILL.md#end-the-run) with one `ostraka snapshot "devlog: summary <YYYY-MM>"`.
