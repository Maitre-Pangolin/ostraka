# Reformat

`reformat <date|range>` restructures Dev logs already written into the format in [format.md](format.md). It runs only when the user asks for it, on the days they name, and it is lossless: every piece of information in a day before is in it after.

## 1. List the days

Run `ostraka devlog list --from <from> --to <to> --json` (for one date, `<from>` and `<to>` are that date). Keep the days: an id `YYYY-MM-DD`. Leave out off days (`off: true`) and the monthly summary, and say so in one line. A day with an `error` (a broken header) is reformatted like the others; the after must list without error.

Done when you have the days to reformat, oldest first.

## 2. Each day, oldest first

1. Read `<devlogs>/<date>.md` (`<devlogs>` is the output of `ostraka path devlogs`). If it already follows format.md (header valid, only the three sections in order, one item per line, tokens for MRs, Jira tickets and people), say it is already in shape and go to the next day.
2. Draft the after by [the lossless rules](#the-lossless-rules). In the header, keep `tags` and `sources`; when there are more than 3 Tags, ask the user which 3 to keep.
3. Show the day: the before as it is now, and the after as it would be written, each in a `markdown` code block, then a short list of what moved or changed form (`Checklist under "Todo" → Done lines`, `GitLab URL → acme/web!88`). Ask whether to write it, change it or skip it.
4. Apply each reply and show the after again. On approval, write the after to `<devlogs>/<date>.md` and run `ostraka devlog list --from <date> --to <date>`; fix the file until it lists without `broken:`.

Done when every day was written as approved, skipped by the user, or reported as already in shape.

## 3. End the run

[End the run](SKILL.md#end-the-run) with one `ostraka snapshot "devlog: reformat <first date>..<last date>"`.

## The lossless rules

How a day's before becomes its after, following format.md. The migration of the old monthly Dev logs drafts its days by these rules too.

1. Draft the after:
   - Every item goes in Done, Meetings & discussions or Notes, one line each, sub-bullets only for real detail.
   - A merge request or Jira link becomes its token (`acme/billing/api!412`, `BILL-231`); a colleague becomes `@<person id>` when `ostraka people find` knows them, otherwise their name stays as written.
   - An old checklist becomes plain lines, keeping each item's words; a ticked item stays clearly done, an unticked one clearly not.
   - Other links, numbers, names, dates and wording that carry meaning stay as they are.
   - In the header, `date` and any key format.md doesn't know stay exactly as they are.
2. Account for every piece of information: go through the before, line by line, and find where each fact, name, number, link, token, decision and todo lives in the after. A piece with no place goes in Notes as its own line.

Done when every line of the before is accounted for in the after.
