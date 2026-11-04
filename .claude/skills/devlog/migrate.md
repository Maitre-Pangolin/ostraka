# Migrate the old monthly Dev logs

`/devlog migrate [<YYYY-MM>]` moves the user's old monthly Dev log files (Jan–Aug 2026, one Markdown file per month with a `## <Day> <N>` heading per day) into daily Dev logs, one reviewed month at a time. The old files are only ever read. Work happens in the content folder's `.migration/`, which Snapshots leave out; a month reaches `devlogs/` only when the user approves it.

Each month goes through four stages, and `ostraka migrate status` says where every month stands, with what its session cost. Start at the stage the month is at: `split` goes to step 2, `staged` to step 3.

## 1. Split the month

1. Run `ostraka migrate status`. Without a month from the user, take the oldest month not yet `approved`; when every month listed is approved, ask the user for the next old monthly file. Before splitting a new month, show the usage of the months already done, so the user can judge the cost of the next one.
2. Ask the user for the old file's path when you don't have it. Run `ostraka migrate split "<file>"` (add `--month <YYYY-MM>` when it says it can't tell the month). It writes one raw file per day and lists the anomalies it found.

Done when the month is split and the user has seen its anomalies.

## 2. Hand the month to a fresh session

The reformatting runs in its own fresh agent session, headless, so each month starts clean and its usage is recorded. It follows [migrate-month.md](migrate-month.md). Give the user this command for their terminal, with `<content>` the folder above `ostraka path devlogs` and `<YYYY-MM>` the month:

```sh
cd "<content>" && mkdir -p .migration/usage && claude -p "Use the devlog skill: stage the migration of <YYYY-MM>, following its migrate-month.md." \
  --permission-mode acceptEdits \
  --allowedTools "Bash(ostraka migrate review:*)" "Bash(ostraka tag list:*)" "Bash(ostraka people find:*)" \
  --output-format json > .migration/usage/<YYYY-MM>.json
```

Then stop: the session takes a while, and the user comes back with `/devlog migrate <YYYY-MM>` once it has finished.

Done when the user has the command.

## 3. Review the month with the user

Run `ostraka migrate review <YYYY-MM>` (`--json` for the folders and lists) and show the user, in this order:

1. **Days**: how many were split and staged, and any not staged.
2. **Usage**: what the session used, from the review's Usage line.
3. **Tags**: the consolidated list, each with its days and whether it is new or already in use. Ask the user to accept each, rename it, merge it into another or remove it, and apply each answer with `ostraka migrate tag <YYYY-MM> <tag> <new tag>` (rename or merge) or `ostraka migrate tag <YYYY-MM> <tag> --remove`. A day left with no Tags is fine.
4. **Uncertainties** and **split anomalies**: go through each with the user. A change to a day is made in its staged file by [the lossless rules](reformat.md#the-lossless-rules). `preamble.md` content and each `unplaced-<line>.md` go into the staged day the user names.
5. **Before and after** of the sample days the review names (2 or 3): the raw day and the staged day, each in a `markdown` code block, then a short list of what moved or changed form. Show any other day the user asks for the same way.
6. **Not ready to approve**: each blocker. A day that already has a Dev log is never overwritten: ask the user whether to merge the staged day's missing lines into the existing one through the [day flow](SKILL.md#the-day-flow)'s existing day branch (then delete the staged file) or to drop the staged file.

Apply every answer, then run the review again and show what changed.

Done when the review says **Ready to approve.** and the user approves the month.

## 4. Approve the month

1. Run `ostraka migrate approve <YYYY-MM>`. It moves the staged days into `devlogs/` and makes the month's Snapshot, `migrate: <YYYY-MM>`; with a blocker left, it moves nothing and names it.
2. Run `ostraka migrate status` and show the month's line with its usage, then offer the next month.
3. If any colleague was kept as a plain name, name them in one line and offer to add them with the `people` skill.

Done when the month lists as `approved`. This branch makes its own Snapshot, so it skips [End the run](SKILL.md#end-the-run).
