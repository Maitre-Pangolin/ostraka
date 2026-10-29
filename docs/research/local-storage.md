# Research: local storage for Todos, Notes and Dev logs

Ticket: #2. Researched 2026-10-29 against primary sources (SQLite docs, Node.js docs, POSIX, Claude Code docs, chokidar README, MDN).

## Question

Which local storage fits ostraka's content: plain files (JSON/YAML/Markdown with frontmatter), SQLite, or similar? Todos are structured; Notes and Dev logs are Markdown. The comparison covers formats an agent can edit safely, the app and an agent editing at the same time, file watching and live reload, and how each option handles later search and backup.

Constraints from the map (#1): content is local and gitignored. Agents (Claude Code and Cursor, with skills that must behave the same in both) read and write Todos and Dev logs. The app is a web front end, probably backed by a small local server, and it must react when an agent edits content.

## Answer

**Use plain files as the source of truth: one Markdown file per Dev log and per Note, and Markdown or YAML for Todos. The local server watches the content directory and pushes changes to the browser. If search needs an index later, build it as a disposable SQLite FTS5 index derived from the files.**

- **Agents can edit files safely with their built-in tools.** Claude Code's Edit tool does exact string replacement. It applies only when `old_string` matches the file's *current* content exactly and uniquely. A file that changed after Claude read it can still be edited when the match holds; otherwise Claude re-reads it first ([Claude Code tools reference, "Edit tool behavior"](https://code.claude.com/docs/en/tools-reference#edit-tool-behavior)). That is optimistic concurrency at the level of a text fragment, which gives a single-user app enough protection against agent and app edits clobbering each other. With SQLite, agents would have to write SQL through Bash or go through a custom MCP or CLI layer that the skills would need in both Claude Code and Cursor.
- **The app needs one rule for safe writes: write to a temp file, then `rename()` it over the target.** POSIX requires that the target name "shall remain visible to other threads throughout the renaming operation" and refer to either the old or the new file ([POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)). Readers, the watcher included, therefore never see a half-written file. Node warns that it is "unsafe to use `fs.writeFile()` multiple times on the same file without waiting for the callback" ([Node fs docs](https://nodejs.org/api/fs.html#fswritefilefile-data-options-callback)), so the server should also serialize its own writes per file.
- **Live reload means file watching plus SSE.** Raw `fs.watch` "is not 100% consistent across platforms". It uses FSEvents for directories on macOS. It keeps watching the *original* inode after a delete and recreate, and `filename` "is not always guaranteed to be provided" ([Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats)). Recursive watching on Linux arrived only in Node v19.1.0. chokidar normalizes these quirks into `add`, `change` and `unlink` events. Its `atomic` option merges an editor's temp-file-plus-rename save into a single `change`, and `awaitWriteFinish` holds events until a file's size is stable ([chokidar README](https://github.com/paulmillr/chokidar)). v6 requires Node 22.22 or later. To push changes to the browser, Server-Sent Events are enough: a one-way server-to-client stream ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
- **Main trade-off:** files give up transactions across files, queries and indexes, which are exactly what SQLite argues for as an application format ([SQLite: application file format](https://www.sqlite.org/appfileformat.html)). Ostraka's writes touch one file at a time (one Dev log per day, one Note), so it barely needs cross-file atomicity.

## Option comparison

| Concern | Markdown + frontmatter files | One JSON/YAML file for all Todos | SQLite |
|---|---|---|---|
| Agent edits with built-in tools | Yes. Edit and Write work directly. | Yes, but a single large file causes more stale-match retries, and JSON syntax errors break the whole file. | No. Needs `sqlite3` through Bash or an MCP/CLI wrapper, and the same wrapper in Cursor. |
| App and agent editing at once | Edit's exact match plus the app's atomic rename covers it. Conflicts are limited to one file. | Every Todo edit touches one file, so concurrent edits are much more likely to collide. | Strong: ACID, one writer at a time, readers never block writers in WAL mode ([SQLite WAL](https://www.sqlite.org/wal.html)). Must handle `SQLITE_BUSY`. |
| Live reload | Watch the directory. Each event names the item that changed. | Watch one file, then re-parse and diff it. | No file events per row. Watching `-wal` is unreliable, so the app needs polling or `data_version`, or must route all writes through the server. |
| Search | `grep`/`rg` works today. An FTS index can be added later. | `grep` works but is clumsy for structured queries. | Built-in FTS5 with `bm25` ranking ([SQLite FTS5](https://www.sqlite.org/fts5.html)). |
| Backup | Any file copy works (rsync, Time Machine, `tar`, a private git repo). | Same. | A plain copy of a live database is unsafe. Use the backup API, `VACUUM INTO` or `sqlite3_rsync` ([SQLite backup](https://www.sqlite.org/backup.html)), and never separate the file from its `-wal`. |
| Human-readable or diffable | Yes. | Mostly. | No. The SQLite page concedes grep and text editors don't work on it. |

## Details by concern

### Formats an agent can edit safely

- **Markdown with YAML frontmatter** suits Notes and Dev logs, since the body is prose. Frontmatter holds the metadata: `date` for a Dev log, `tags: [idea]` for an Idea (an Idea is a Note with a tag, per GLOSSARY.md).
- **Todos:** two viable shapes.
  1. One file per Todo (`todos/<id>.md` with frontmatter `done`, `created`, links). This is the most robust under concurrency and makes watcher events precise, but means many small files.
  2. A single `todos.md` checklist (`- [ ] …`). Agents and people edit it easily, and Edit's uniqueness rule targets one line. The cost is that every Todo change collides on one file, and the server must re-parse the whole file on each change.
  Choosing between them is a design call; the grilling or prototype ticket should settle it. Avoid a single `todos.json`: one bad comma from an agent invalidates every Todo.
- Both Claude Code tools refuse non-UTF-8 files ([tools reference](https://code.claude.com/docs/en/tools-reference#non-utf-8-files)), so the app must always write UTF-8.

### App and agent editing the same content at once

- The agent side is covered by Edit's current-content match (above). Write replaces the whole file and "doesn't append or merge", so skills should prefer Edit for existing Dev logs and keep Write for creating new ones (Backfill creates new files, so Write is fine there).
- The app side needs atomic rename writes. Before saving, the app can check the file's `mtime` and hash against what it loaded and refuse or merge if they changed. That gives the app the same optimistic check the agent already has.
- The SQLite alternative: WAL allows concurrent readers and one writer at a time, but requires all processes to be on the same host and says applications "should be prepared" for `SQLITE_BUSY` ([SQLite WAL](https://www.sqlite.org/wal.html)). This is solid, but it only helps if agents also write through SQLite.

### File watching and live reload

- Use chokidar (or native recursive `fs.watch` with debouncing) on the content root, then push `{kind, path}` over an SSE endpoint so the front end refetches the affected item.
- Ignore the app's own writes by remembering the hash of what it just wrote.
- MDN warns SSE over HTTP/1.1 is limited to 6 connections per browser. That doesn't matter for one or two local tabs.

### Search and backup

- **Search (not yet specified in the map):** start with `rg` over the content directory. When ranked search becomes necessary, rebuild a SQLite FTS5 index from the files at startup and update it on watcher events. The index is derived and gitignored, and deleting it costs nothing. FTS5's `'rebuild'` command and external-content tables fit this "files are truth, index is cache" model ([SQLite FTS5](https://www.sqlite.org/fts5.html)).
- **Backup (not yet specified in the map):** a plain directory backs up with any tool, including a separate private git repo for content if that is chosen later. With SQLite as the source of truth, a backup would need `VACUUM INTO` or the backup API rather than `cp`.

## Open points for later tickets

- Todo layout: one file per Todo, or a single checklist file.
- Content root location: a gitignored `content/` folder in the repo, or a path outside it set in config. Skills must find it the same way in Claude Code and Cursor.
- The frontmatter schema for each kind of content.

## Sources

- SQLite, Write-Ahead Logging: https://www.sqlite.org/wal.html
- SQLite, Online Backup API: https://www.sqlite.org/backup.html
- SQLite, FTS5: https://www.sqlite.org/fts5.html
- SQLite, SQLite as an Application File Format: https://www.sqlite.org/appfileformat.html
- Node.js, `fs` docs (`fs.watch` caveats, `writeFile`): https://nodejs.org/api/fs.html (source: https://github.com/nodejs/node/blob/main/doc/api/fs.md)
- POSIX.1-2024, `rename()`: https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html
- Claude Code, Tools reference (Edit and Write behavior): https://code.claude.com/docs/en/tools-reference
- chokidar README: https://github.com/paulmillr/chokidar
- MDN, Using server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events

Not verified: how Cursor's agent edit tool handles a file that changed on disk. Cursor's docs were not checked, so skills should not rely on Claude Code-specific Edit semantics alone. A server-side atomic write and an mtime check protect the app either way.
