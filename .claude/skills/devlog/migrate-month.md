# Stage one migrated month

You are the fresh agent session for one month of the old monthly Dev logs, `<YYYY-MM>`, named in your prompt. You run alone, with no user to ask: turn each raw day of the month into a Dev log in the staging folder, losing nothing, and write down what you were unsure of. The user reviews your work afterwards, in another session ([migrate.md](migrate.md)), and only then does it reach the Dev logs.

You write only in the month's staging folder. The raw days, the old monthly file and `devlogs/` are read-only for you, and you run no `ostraka snapshot`.

## 1. Read the month

1. Run `ostraka migrate review <YYYY-MM> --json`. `folders.raw` holds the raw days, `folders.staged` is where you write. `anomalies` is what the split flagged.
2. Read [format.md](format.md) and [the lossless rules](reformat.md#the-lossless-rules) in reformat.md: every staged day follows both.
3. Run `ostraka tag list` for the Tags already in use.
4. List the raw folder. Each `<YYYY-MM-DD>.md` is one day exactly as the old file had it, from its `## <Day> <N>` heading down. `preamble.md` is what came before the first day, and `unplaced-<line>.md` a day the month doesn't have.

Done when you know every raw file of the month and every anomaly.

## 2. Stage each day, oldest first

For each raw `<date>.md`, write `<folders.staged>/<date>.md`:

1. **Header**: `date: <date>`, then `tags`, and no `sources` (no Activity source was read: the day was written by hand). Pick at most 3 Tags by format.md's rules, preferring those from `ostraka tag list` and those you already gave earlier days of the month, so the month's Tags stay few and consistent.
2. **Body**: the raw day by the lossless rules, the `## <Day> <N>` heading dropped (the date says it). A day whose whole content says it was off (a holiday, a sick day) becomes an off day instead: `off: true` and a `label` in its own words, with no body.
3. **Account for it**: the lossless rules' accounting, line by line, before you move on.
4. **Uncertain?** Anything you had to guess (an unclear item's section, a name you couldn't match, an off day that may have had work, a line whose meaning you couldn't place) goes in `uncertainties.md` as one line: `- <date>: <what you were unsure of, and what you did>`.

Done when every raw day has a staged day, and every line of each raw day is accounted for in it.

## 3. The month's loose ends

Write each as its own line in `<folders.staged>/uncertainties.md`, `- <what it is, and what you suggest>` (with `<date>: ` first when it concerns one day):

- Each anomaly from step 1 you could not settle while staging: a `weekday` mismatch you staged under the heading's number, a `duplicate` you merged into one day, a `missing` weekday.
- `preamble.md`, when it holds more than the month's title: what it says and which day or days it belongs to. Leave it out of every staged day: the user places it at review.
- Each `unplaced-<line>.md`: what it says and which day it most likely is.
- One line naming the colleagues `ostraka people find` didn't know, kept as plain names.

Done when every anomaly, `preamble.md` with content and every `unplaced-<line>.md` has its line, or was settled in a staged day.

## 4. Check and finish

1. Run `ostraka migrate review <YYYY-MM>`. Fix every staged day under **Not ready to approve** except one that already has a Dev log (the user settles that), and run it again until those are the only blockers left.
2. End with a short summary: the days staged, the Tags used, and how many uncertainties you wrote.

Done when the review lists no blocker you can fix.
