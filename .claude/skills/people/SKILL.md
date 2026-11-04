---
name: people
description: Looks a colleague up in the ostraka People directory before Slack, Jira, GitLab or M365, and caches their IDs there. Use whenever a task needs a colleague's email, Slack ID or handle, GitLab username, Jira account ID or Mention id, before any MCP user lookup, when a skill offers to add the people it wrote about, or when the user asks to refresh someone's IDs.
---

# People

The People directory holds one Person per colleague: an id, a name, aliases, one company email, a Slack ID and handle, a GitLab username and a Jira account ID. It is the **cache** in front of Slack, Jira and GitLab: read it first, call MCP only for what it lacks, and write it only through `ostraka people`. A Person is mentioned as `@<person id>`.

`ostraka` is on the user's PATH. If the shell can't find it, stop and ask the user to run `pnpm ostraka install` from the ostraka repo.

MCP servers are named by key: `slack`, `atlassian` (Jira) and `GitLab`. Every call you make to them here is a read-only user lookup. If a named tool is missing, use whichever tool of that server does the same job; a server that is missing or failing is skipped, and that identity stays blank.

## 1. Find

For each colleague the task needs, run `ostraka people find <name, id, alias, email, handle or Slack ID>`. It prints one `<person id>  <name>  <email>` line per match, with `(ignored)` last for someone on the ignore list, and `No Person matches …` when it finds nobody. Add `--json` for the full records.

- **One match**: use their cached identities as they are.
- **Several matches**: pick by context (the email, the thread or ticket they came from), and ask the user when it is still unclear.
- **Ignored**: use what the record holds. When the task needs more, look it up as in step 2 and keep it out of step 4.
- **No match**: they are missing; look them up in step 2.
- **Found, but the identity the task needs is blank**: look that one identity up by their email as in step 2.2, and record it with `ostraka people refresh <id> --<flag> <value>` (flags in step 3).

Done when every colleague the task needs is found or marked missing.

## 2. Look up the missing

For each missing colleague:

1. Get their company email: from the context when it holds one, otherwise from Slack by name (`slack_search_users`, then `slack_read_user_profile` for the email).
2. Look them up by that email in every source, once, so the add in step 4 caches all of it:
   - Slack: `slack_search_users` with the email gives the Slack ID and handle.
   - Jira: `lookupJiraAccountId` with the email gives the Jira account ID.
   - GitLab: `get_users` with the email, then with the name when the email finds nobody, gives the username. Keep a match by name only when the full name is the same.
3. Use what you found for the task now, and keep each colleague as a **candidate** for step 4, with their name, email and identities. Nothing is written yet.

When no source gives an email, ask the user for it. Without one, write the colleague as their plain name and leave them out of step 4.

Done when each missing colleague has an email and every source was searched with it, or the user was asked.

## 3. Refresh on request

Cached identities stay as they are until the user asks for a refresh ("refresh Jane's IDs", "Jane changed teams"). When a cached ID fails in a source, tell the user and offer the refresh.

1. `ostraka people show <id> --json` gives the email to look up by.
2. Look them up by that email as in step 2.2.
3. Record what changed: `ostraka people refresh <id> [--email <email>] [--slack-id <id>] [--slack-handle <handle>] [--gitlab <username>] [--jira <account id>]`. The identities you leave out stay as cached.
4. `ostraka snapshot "people: refresh <id>"`.

Done when `refresh` prints the updated Person and the snapshot is made.

## 4. Offer to add, at the end of the run

The candidates to offer are those who end up in something this run writes (a Dev log, a Todo, a Note, a message or a document), and a colleague the user asked you to look up. Someone you only met along the way, such as a name in a search result, is not offered. A skill that called this one offers once, at its own end, after its own work is done.

Ask once, every candidate numbered:

```text
Add to the People directory?
1. Jane Doe  jane.doe@acme.com  Slack @jane.doe, GitLab jdoe, Jira
2. Sam Lee  sam.lee@acme.com  Slack @sam, Jira
Reply with numbers (`1 2`), `all`, `none`, or `ignore 2` to never be offered someone again.
```

Nothing is written before the reply. Then:

- **Added**: `ostraka people add "<name>" --email <email> [--slack-id <id>] [--slack-handle <handle>] [--gitlab <username>] [--jira <account id>]`. The id is the name as lowercase hyphenated words; when that id is taken by someone else, pass `--id <id>` with a distinct one. Then, in each Dev log or Note this run wrote, write their plain name as `@<person id>`.
- **Ignored**: `ostraka people add "<name>" --email <email> --ignored`, so no skill offers them again.
- **Neither**: write nothing; they may be offered on a later run.

When anyone was added or ignored, run `ostraka snapshot "people: add <N>"` once, `<N>` being how many. A calling skill that snapshots right after this step makes that one Snapshot instead.

Done when every candidate is added, ignored or declined, and a Snapshot is made or left to the calling skill when anything was written.
