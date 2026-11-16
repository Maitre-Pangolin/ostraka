# Backfill

A Backfill writes Dev logs for past days that have none, from the user's Activity sources only, one week at a time, oldest first. Each day goes through [the day flow](SKILL.md#the-day-flow) and its own confirmation; the run ends with one Snapshot.

## 1. Pick the days

`ostraka devlog missing --json` lists the weekdays with no Dev log, grouped by week (`start` is its Monday), oldest first. Today belongs to a plain `/devlog`, so leave it out of every list below.

- **Default**, when the user names no range: run `ostraka devlog missing --json`. The first week in the list is the one to backfill: its weekdays with no Dev log, Monday to Friday. Keep the rest of the list for step 3.
- **A range the user names** (a week, a month, `<from>` to `<to>`): run `ostraka devlog missing --from <from> --to <to> --json`. Its days are all the days to backfill, across however many weeks.
- If the command says there is no Dev log yet, ask the user which day to start from and run it again with `--from`.

Then add the weekend days with activity. Weekends are skipped unless sources show activity: for each Saturday and Sunday of the chosen week (or inside the named range) with no Dev log (`ostraka devlog list --from <date> --to <date>` lists nothing), check the Todos, GitLab, Jira and Outlook calendar of that day as in the day flow's Gather. A weekend day with any activity joins the days; one without is skipped without a word.

Tell the user in one line what this run covers: `Backfilling the week of 2026-10-19: Tue 20, Thu 22, Fri 23.` For the default, add how many more weeks have missing days.

Done when you have the list of days, oldest first.

## 2. Each day, oldest first

Run the day flow for each day in turn: check, gather, draft and confirm, write. Show one day's draft at a time and write it as soon as the user approves it, before drafting the next. You may read a source once for the whole week (one Slack search over the dates, one Jira query from the first day to the last, one calendar read and one sent-mail search over the range) and split what it returns by day.

A weekday where no source shows any activity, or whose calendar says the user was away, is often an off day: show that nothing was found, and offer to mark it off (asking for a label such as `Holiday`), to write it from what the user tells you, or to skip it and leave it missing.

The user may stop at any day. Days already written stay written.

Done when every day of the list was written, marked off or skipped by the user.

## 3. Offer the next week

- **Default**: if the list from step 1 has another week, offer it in one line: `Next: the week of 2026-10-26 (Mon 26, Fri 30). Go on?` On a yes, go back to step 1's weekend check for that week, then step 2. On a no, or when no week is left, the Backfill is done.
- **A named range**: the Backfill is done after its last day.

Then [end the run](SKILL.md#end-the-run) with one `ostraka snapshot "devlog: backfill <first date>..<last date>"`, covering every day written in this run.
