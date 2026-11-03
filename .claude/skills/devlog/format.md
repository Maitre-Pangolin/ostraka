# The Dev log format

A Dev log is the record of one working day. The ostraka app reads these files and shows a file whose header does not match this format as broken, with the reason, so follow it exactly.

## Where the files go

Run `ostraka path devlogs` for the folder; never hard-code it. In that folder:

- `<YYYY-MM-DD>.md` is the Dev log of that day. There is at most one per day.
- `<YYYY-MM>.md` is the monthly summary of that month, written from its days.

Any other name is shown as broken. After writing, run `ostraka snapshot "devlog: <date>"` once.

## A day

```markdown
---
date: 2026-10-29
tags: [billing, code-review]
sources: [todos, gitlab, jira, slack]
---

## Done

- Opened acme/billing/api!412 for BILL-231: retry failed invoice webhooks
- Reviewed acme/web!88 for BILL-198
- [Renew the staging certificate](todo:k3f9x)
- Dropped [Migrate the cron jobs](todo:p2m7q): replaced by BILL-240

## Meetings & discussions

- Sprint planning: BILL-231 and BILL-240 committed
- With @jane-doe on the rollout order for the webhook retries

## Notes

- Blocked on access to the billing replica until @sam-lee is back
```

### Header

| Key       | Value                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date`    | The day, `YYYY-MM-DD`, the same as the file name. Required.                                                                                                                                                                 |
| `tags`    | At most 3 Tags, lowercase and hyphenated, in flow style: `tags: [billing, code-review]`. Prefer Tags already in use; add one only for a project, initiative or recurring area. Tags go here only, never inline in the body. |
| `sources` | The Activity sources the day was gathered from: `todos`, `gitlab`, `jira`, `slack`, `outlook`. A source not listed was not used, so a day written without Outlook leaves `outlook` out.                                     |
| `off`     | `true` on an off day (holiday, sick day); otherwise leave it out.                                                                                                                                                           |
| `label`   | Only with `off: true`: what the day was, such as `Holiday`. The app shows it in place of the day.                                                                                                                           |

Keep any other key you find; the app leaves the header exactly as written and never edits it.

### Body

Sections are `##` headings, in this order, each at most once. Leave out a section with nothing in it; add no other section.

1. `## Done`: all activity. Merge requests opened, closed or reviewed, each with its Jira ticket. Todos finished, and Todos Dropped with their reason.
2. `## Meetings & discussions`: meetings and conversations worth keeping.
3. `## Notes`: context, decisions and blockers together.

Write one line per item, in short plain sentences. Use sub-bullets only for real detail.

### References and Mentions

Write these as plain-text tokens, never as URLs or Markdown links:

- A merge request is `group/project!<iid>` with the full project path (`acme/billing/api!412`).
- A Jira ticket is `<KEY>-<number>` (`BILL-231`).
- A Person is `@<person id>` (`@jane-doe`). Look the id up with the `people` skill or `ostraka people find`.
- A Todo is the one link allowed: `[title](todo:<id>)`, with the id from `ostraka todo list --json`. The app shows the Todo's current title, so a later rename never leaves the Dev log stale.

### House style

`-` bullets, `*emphasis*`, `**strong**`, fenced code blocks and `#` headings. The app's editor writes this style, so a file already in it is never rewritten.

## An off day

```markdown
---
date: 2026-10-30
off: true
label: Holiday
---
```

Weekends are skipped unless sources show activity. A weekday with no file shows in the app as missing, with a hint to run the Dev log skill; an off day is not missing.

## A monthly summary

```markdown
---
month: 2026-10
tags: [billing, code-review]
---

# October 2026

- **Billing**: invoice webhooks now retry (BILL-231), shipped in acme/billing/api!412.
- **Reviews**: eight merge requests reviewed, mostly for the web app.
- **Next**: the cron job migration moved to BILL-240.
```

`month` is the month, `YYYY-MM`, the same as the file name. `tags` is optional, with no limit. The body is free-form Markdown in house style, written from that month's days; the app shows it on top of the month's weeks.
