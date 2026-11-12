# Web app: UI conventions

Rules every screen follows (decided in #26). They are rules, not a component catalogue: read the files they point to.

**Keep this file current.** A change that adds a UI pattern (a new kind of picker, state, shortcut, token) updates this file in the same change. Code review checks screens against it.

## Stack

- Vite, React 19, TanStack Router (`src/router.tsx`), shadcn/ui on Base UI, Tailwind v4, lucide-react.
- View state worth a reload or a link (filters, a date range, the open item, a search box's text) lives in typed router search params: the route's `validateSearch` checks them with a parser from core, which leaves out empty and default values so a plain view has a clean URL (`parseTodosView` on `/todos`). Changing them navigates with `replace: true`.
- Add components with the shadcn CLI (`pnpm exec shadcn add <name>` from `apps/web`), then edit the copy in `src/components/ui/`. Base UI composes through the `render` prop (see `src/shell/rail.tsx`).
- Server state comes from the API under `/api`. In development Vite proxies `/api` to `ostraka serve` on 127.0.0.1:4747, so run both. In production the server serves `dist/` from the same origin.
- Server state lives only in TanStack Query, with no second client store. Each section keeps its queries and mutations as hooks in one `api.ts` (see `src/todos/api.ts`), calling the server through `src/lib/api.ts`. The server's answer (order included) is shown as is. An immediate change updates the cache in `onMutate`, rolls back on error, and invalidates on settle.
- Live updates: `src/lib/live-updates.tsx` turns the server's `{kind, id?}` change stream (`/api/events`) into query invalidations, whoever changed the file. So every content query key starts with its kind (`['todos', …]`, `['notes', id]`), and content is never polled.
- The work overview (GitLab and Jira) is polled by the server, never by the app: its changes arrive on the same stream as `{ kind: 'activity', id: source }` and invalidate `['activity']` (`src/work/api.ts`). The window only reports whether it is visible (`POST /api/activity/visibility`, from `live-updates.tsx`); the server picks the rates.
- A change to an existing item sends the `version` the server answered with that item (`post(path, body, { version })`, sent as `If-Match`). If the item changed elsewhere since, the server refuses it with 412 (`isStale(error)`): the error line in place adds “Showing the newer version.”, and the invalidation on settle shows it.
- Content and config types come from core's Zod schemas as type-only imports (`import type { Todo } from '@ostraka/core/todo-schema'`, `Config` from `@ostraka/core/config-schema`). Core's entry point pulls in Node modules, so import its zod-only subpaths.
- The app installs as a browser web app (own window, Dock icon) from `public/manifest.webmanifest`, linked in `index.html` with the `apple-touch-icon` for Safari's Add to Dock. Its icons are PNGs in `public/`; a changed icon updates all of them.

## Layout

- The shell (`src/shell/shell.tsx`) is the left rail, the top bar and the current view. Every view renders inside the content area, which is the `@container`.
- The top bar is one row: the work overview's counts, one group per source with a thin divider between them (a button that expands the MRs and the sprint in place, below the row, `aria-expanded`; its counts have no Tooltip, even below `@md`, as its `aria-label` says them all), then one item per thing that needs attention, such as a failing source's chip or the backup warning. A new item is another child of that row in `TopBar`.
- Expanded, the work overview is one panel per source, divided by a rule (stacked, side by side from `@3xl`): each keeps its title and update time in place while its body scrolls on its own (`SourceSection` in `src/work/work-overview.tsx`). GitLab lists MRs per repo by its name only (full path as the title), then Reviewing and Authored under it, each MR as `!iid` and title (`groupByRepo` in `src/work/repos.ts`). MR and ticket titles are never cut short: each is one line that scrolls sideways, its scrollbar hidden (`SCROLLING_TITLE`).
- Lay out with container queries on the content area: `@md:`, `@3xl:`. The window is sized by the user, so viewport variants (`md:`, `lg:`) describe the wrong box.
- `@md` is the single compact breakpoint. Below it, secondary metadata hides and labels become icons with a Tooltip carrying the label. List and detail sit side by side from `@3xl`.
- The minimum window is 600px wide. At 600px nothing scrolls sideways: long text truncates (`min-w-0` + `truncate`) or wraps.

## Density

- Density is one knob: Tailwind's `--spacing`, 0.21rem compact (default) and 0.25rem comfy, set from `data-density` on `<html>` in `src/index.css`.
- Space with ordinary spacing utilities (`p-3`, `gap-1.5`, `h-9`, `size-4`). They all scale with `--spacing`, so components stay density-agnostic: no density branches, no pixel spacing.
- Font sizes stay the same in both densities.

## Colour and theme

- Use semantic colour tokens only: `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `border`, `ring`, `destructive`, and the app tokens `today`, `warning`, `success` (a passed pipeline), `prio-*`, `tag-1`…`tag-8`. Raw Tailwind palette colours and hex values stay out of components.
- Tokens live in `src/index.css`: values under `:root` (light) and `.dark`, exposed to Tailwind in `@theme inline`. A new token gets a light value, a dark value and a `@theme inline` line.
- Priority shows on the round checkbox (and the dots of `SubTodoLines`): a 2px ring in its `prio-*` colour with a light tint inside (`PRIORITY_RING` in `src/todos/priority.ts`); no priority keeps the plain 1px `input` ring. The `prio-*` tokens keep at least 3:1 contrast against `background` in both themes, for the ring and the flag.
- Light/dark is the `.dark` class on `<html>`, defaulting to light. Theme and density are per-browser choices handled by `src/shell/appearance.tsx`.

## Editing

- Edit inline, where the thing is shown. Pickers (date, priority, Tags, People) open in a Popover anchored to what they change.
- Forms live inline too; a Dialog is never a form.
- Single-item done, Drop or delete happens at once, with a 5-second Undo toast: sonner's `toast(what happened, { description: item title, duration: 5000, action: { label: 'Undo', … } })`, as in `src/todos/todos-view.tsx`. The `<Toaster />` lives in the shell. Undo of a delete posts the item back as it was (`useRestoreTodo`).
- Row actions that would clutter the list (Add a Sub-todo, Drop or delete) sit at the row's end, shown on row hover or keyboard focus (`group/row`, `opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100`, `ROW_ACTION` in `src/todos/todos-view.tsx`). Drop or delete opens a Popover (`DropOrDelete`). An optional field in it (the Drop reason) is skippable: ↵ on the empty field still acts. A row without an action keeps its place (a Sub-todo has no Add a Sub-todo), so dates and flags line up.
- Finished items (Done & Dropped) are kept, in a section collapsed by default below the open ones: a muted disclosure button with a chevron and the count, `aria-expanded`. Finished rows are muted and struck through, show when they finished, and reopen from their checkbox or Dropped icon.
- A confirmation Dialog guards only bulk or hard-to-reverse changes (renaming, merging or deleting a Tag, finishing a parent with open Sub-todos). It says what will happen and how to undo it, has Cancel and one primary action, and no close button (`FinishParentDialog` in `src/todos/todos-view.tsx`).
- Toasts exist only for Undo.
- Read-only settings sit in bordered definition lists, label then value (monospace for paths, URLs and ids), as in `src/settings/settings-view.tsx`. Settings has no form: `config.yml` is edited by hand.
- Confirmations and text entry use the app's own Dialog and inputs; browser `prompt()`, `confirm()` and `alert()` stay unused.
- The priority picker is a Popover of flags (`PriorityPicker`); the date picker is a Popover with quick picks over a Calendar and a Clear date (`DuePicker`), both in `src/todos/properties.tsx`.
- Tags show as pills coloured `tag-1`…`tag-8` (`TagPill`), with × where one can be removed. On a Todo row they sit on the row, never under it: `▸ ○ Title [indicators] #tag #tag [warning] Fri ⚑ [actions]` (`RowTags` in `src/todos/todo-row.tsx`). Collapsed, up to three pills (below `@md`, dots); expanded, all of them with ×, wrapping within half the row. The title truncates first. A Tag's colour comes from `tags.yml` through `GET /api/tags` (`useTagColor`); a Tag without one, or not in use yet, gets the colour its name hashes to (core's `defaultTagColor`).
- Tags are managed in the Tags view (`src/tags/tags-view.tsx`, `/tags`, from the rail's bottom group): each Tag in use with its colour swatch, pill and usage ("2 Todos, 1 Note and 1 Dev log"; the total below `@md`). The swatch opens a Popover of the eight colours and Default colour, saved at once. Rename (the name becomes an input in place; ↵ asks, Esc or leaving cancels), Merge into… (a Popover list of the other Tags) and Delete are row actions shown on hover or focus, and each asks in a confirmation Dialog naming what changes; a rename onto a Tag in use asks to merge instead. Validation and rewriting are core's (`@ostraka/core/todo-tokens` `normalizeTag` for the typed name, the server for the rest). Tag swatch and pill colours come from `TAG_STYLES` (`src/todos/tag-styles.ts`).
- A due date reads relative to today (`DueText`): overdue is highlighted strongly (`destructive` pill), due today lightly (`today` text).
- A row expands only when it has something to show under it: a description or Sub-todos (`isExpandable` in `src/todos/expansion.ts`). Otherwise it has no chevron (its width kept, so checkboxes line up) and its title is edited in place by clicking it, or ↵ on it.
- An expanded row edits its text in place and shows no empty field: a description appears only once there is one, or after ⇧↵ in the title (which expands a row that couldn't), and closes again when emptied.
- Sub-todos (`src/todos/sub-todos.tsx`) show only under their expanded parent, in creation order, along a `border`-coloured guide line from the parent's checkbox. Open ones are full `TodoRow`s; finished ones stay in place, muted and struck through. A collapsed parent shows a `ListTree` indicator with finished/total.
- A Sub-todo is added on demand: a Todo's Add a Sub-todo row action (`ListPlus`, Todos only, since Sub-todos are one level deep) expands it and shows the entry last, focused. ↵ adds and keeps it open for the next; Esc, or leaving it empty, closes it.
- A warning on an item is a `TriangleAlert` in `warning` colour before its due date, carrying its text as a title and for screen readers (a Sub-todo due after its parent).
- An offer the app must not act on by itself (finishing a parent once its last open Sub-todo is finished) is one muted inline line where it applies, with a secondary action and "Not now". It is never a toast or a Dialog.
- A list with expandable rows has Expand all / Collapse all at its top right (ghost `xs` button); it reads Collapse all while any expandable row is expanded, ignores rows that can't expand and hides when none can (`expandAll` in `src/todos/expansion.ts`).
- A view that shows one content file has a History button (`HistoryButton`) at the end of its header, which swaps the file's display for `FileHistory` (`src/history/file-history.tsx`, given the file's path relative to the content folder): its Snapshots newest first, beside the chosen one's raw text from `@3xl`, stacked below. Restore acts at once, with no Dialog, then closes the panel and shows an Undo toast (restoring the Snapshot before it). An editor stays mounted, hidden, behind the panel, and a view that skips reloading its own saves listens with `onFileRestore` (`src/history/api.ts`), as `useAutosave` does for `NoteDetail`, `SketchDetail` and `DevlogEditor`. Notes, Sketches, Todos, Dev logs and monthly summaries have it (a Dev log's History sits after Edit, which hides while the history is open).

## Filters

- A list is narrowed by filter chips over it (`TodoFilters` in `src/todos/filters.tsx`): each chip (Priority, People, Tags) opens a Popover checklist (Tags alphabetical, People by name) with a search field past 6 options (`searchText` says what it matches: People by name, id and aliases). A chip with values chosen is tinted `primary` and shows their count.
- Groups combine with AND. Tags match all chosen by default, with an All/Any toggle in the Tags picker. People (`PeoplePicker`, `PersonFilterChips` in `src/people/people-filter.tsx`, `?person=` in the URL) keep what mentions all the chosen Persons; the same chip narrows stacked Dev logs.
- Active values follow as removable chips (×), then Clear all. With more than one Tag, the chips are labelled "All of" or "Any of"; with more than one Person, "All of".
- Matching is core's (`@ostraka/core/todo-filter`), never the app's own, and keeps the server's order. A parent that matches only through its Sub-todos stays in the list dimmed (`DIMMED`), with the matching Sub-todos under it.
- A filter that matches nothing shows the empty line, naming how to widen it.

## Markdown editing (Notes)

- Notes are edited in Milkdown Crepe (`src/notes/note-editor.tsx`): selection toolbar, `/` block menu, Markdown shortcuts. Crepe's own themes stay unloaded; its `--crepe-*` variables map onto the app tokens in `src/index.css` (`.ostraka-md`).
- The editor sees the body only; the YAML header stays on the server and changes through fields (Tags), never through the editor.
- The editor serializes in core's house style (`HOUSE_STYLE` from `@ostraka/core/markdown`, set in `src/notes/note-editor-setup.ts`), so an unchanged Note round-trips byte-identical; `test/note-editor.test.ts` guards it. A new Milkdown feature or custom node gets a case there.
- Nothing is written on opening. An edit saves after a 600 ms pause, on leaving the Note and when the window closes, from the version the editor was loaded with. A save shows as a quiet status (Editing, Saving…, Saved) in the Note's header (`SaveStatus` in `src/lib/save-status.tsx`), never a toast.
- `useAutosave` (`src/lib/use-autosave.ts`, tested in `test/autosave.test.tsx`) does all of this and the next rule for every editor of a file (`NoteDetail`, `SketchDetail`, `DevlogEditor`): a new editor of a file uses it rather than its own timer and version handling.
- A change made elsewhere reloads the editor when no edit is waiting; with one waiting, the save is refused (412), the error line says so and the newer content shows.
- Mermaid code blocks render in place (`src/notes/mermaid-preview.ts`), source one toggle away. Milkdown and Mermaid load lazily, with the first open Note and diagram.
- A list item whose file is broken shows its path and error in `destructive`; opening it shows the error and where to fix it.
- An Idea is a Note tagged `idea`: the list switches between All Notes and Ideas, and the lightbulb in a Note's header toggles the Tag.

## Reading Markdown (Dev logs)

- Dev logs and monthly summaries open read-only, rendered by `MarkdownView` (`src/devlogs/markdown-view.tsx`) from core's parser (`parseMarkdown`) and styled by `.devlog-prose` in `src/index.css`. Raw HTML shows as text; only web and mail links are links, opening in a new tab. Edit in the header switches to the Notes editor (`DevlogEditor`, same saving rules as Notes), View back.
- A Todo link, `[title](todo:<id>)`, shows the Todo's current title from the Todo queries, with a square (open) or checked square (finished); a Todo that no longer exists keeps the stored text, muted and struck through.
- The list opens first, never the first item: months newest first, each month's summary on top, then its weeks (a week header opens that week stacked). A weekday up to today without a Dev log shows as a muted row with the skill's command (`/devlog`); an off day shows its label with a `Palmtree`. Layout by month, week and gap, the range presets and the Tag filter are core's (`@ostraka/core/devlog-days`).
- A date range is a Popover from the `Dates` chip: presets over a range Calendar (first click from, second to). The range, Tags and People live in the URL (`parseDevlogsView`). Stacked days reuse the People and Tags chips from the Todo filters (`PeoplePicker`, `FilterPicker`, `MatchToggle`, `ActiveChip`).
- A Mention in a Dev log shows as `MentionChip`, through the same `text` renderer (`ReferenceText`).
- A day whose sections stray from Done / Meetings & discussions / Notes shows a `warning` `TriangleAlert` in its header, carrying the problems as its title.

## Sketches

- A Sketch is edited as Mermaid text in CodeMirror (`src/sketches/mermaid-editor.tsx`) beside its live preview (`src/sketches/use-mermaid.ts`), in preview, split or code mode (`?mode=`, split by default). Split stacks the panes and puts them side by side from `@2xl` of the Sketch's own `@container/sketch`. Both panes stay mounted across modes, so the text and its undo history survive a switch.
- Mermaid drawing is shared with Notes (`src/lib/mermaid.ts`), in the app's light or dark theme, redrawn when the theme changes. CodeMirror and Mermaid load lazily with the first open Sketch.
- Text that doesn't draw is still saved: the error is one `text-destructive` line in place of the diagram (under the text in code mode), over the last diagram that drew, dimmed.
- Saving, a change made elsewhere and a stale save behave as for Notes. The title is edited in place in the Sketch's header (↵ or leaving the field renames, Esc puts it back); Tags as on Notes.

## Quick-entry tokens

- `#tag`, `*high|*med|*low` and `^today|^tomorrow|^fri|^2026-11-05` are parsed by core (`@ostraka/core/todo-tokens`), never by the app itself, so the CLI and agents read them the same way.
- Title and description fields where tokens apply use `TokenField` (`src/todos/token-field.tsx`). A token leaves the text once completed, picked with Tab or ↵ or followed by a space, and suggestions show while one is typed (existing Tags first; a new Tag is offered only when none matches).
- In quick entry the values wait as removable chips under the input until the Todo is added; in an open Todo they change it straight away.

## References

- A Reference (`group/project!<iid>`, `<KEY>-<number>`) is plain text in storage. Its grammar, URL → token, completion and suggestions are core's (`@ostraka/core/references`), never the app's own.
- Shown text renders each Reference as a chip (`ReferenceText`, `ReferenceChip` in `src/references/reference-chip.tsx`): icon, number (`!809`, `PAY-1432`), status dot. Hovering or focusing one opens a Popover card with the token, title, pipeline and approvals or Jira status, and Open.
- Status comes from the top bar's polled data (`useReferenceIndex` in `src/references/api.ts`); a Reference it didn't poll shows a dashed dot and is fetched when its card opens (`GET /api/references?token=`), its error in the card. Dot colours live in `src/references/status.ts`.
- In Notes (and a Dev log's Edit mode) a Reference stays text: `tokenHighlight` (`src/notes/token-highlight.ts`) decorates it in place, tinted like a chip (`.ostraka-reference`), with its status dot after it, and hovering it opens the same card (`ReferenceHoverCard`). The plugin takes a list of highlighters (`referenceHighlighter` in `src/references/highlight.ts`, `mentionHighlighter` in `src/people/highlight.ts`). `tokenSuggest` (`src/notes/token-suggest.ts`) offers the same `!`, `KEY-` and `@` suggestions, in a list under the caret that takes ↑↓, Tab or ↵ and Esc before the editor's own keys; picking writes the plain token and a space. Code and link text are never highlighted or suggested in.
- Rendered Dev logs show References as chips: `MarkdownView` hands its plain text (outside code and link text) to a `text` renderer, `ReferenceText` in `src/devlogs/devlogs-view.tsx`, which also shows Mentions (`MentionChip`).
- `TokenField` is a small ProseMirror editor (model in `src/todos/token-doc.ts`, tested in `test/token-doc.test.ts`) where References are atomic chips: typing next to one can't break it, Backspace removes it whole. `!` + number or words suggests my open MRs, `KEY-` my open sprint tickets. A complete token, or a `!<iid>` only one open MR has, becomes a chip on a space or punctuation; a pasted MR or Jira URL under the configured sites becomes its token. On save a word touching a chip gets a space (core's `joinPieces`). Mentions are another chip kind (see Mentions).

## Mentions

- A Mention (`@<person id>`) is plain text in storage. Its grammar, Person suggestions, completion and contact links are core's (`@ostraka/core/mentions`); the People directory comes from `GET /api/people` (`usePeopleIndex` in `src/people/api.ts`, query key `['people']`).
- Shown text renders a Mention of a known Person as their current display name in `primary` (`MentionChip` in `src/people/mention-chip.tsx`, through `ReferenceText`). Hovering or focusing it opens the contact card (`ContactCard`): Slack DM first, then email, then GitLab and Jira profile links, each value with a copy button.
- A Stub Person (no email, not ignored: core's `isStubPerson`) is underlined with dots wherever their Mention shows (chip, `.ostraka-mention-stub` in Notes), and their card carries an "Incomplete" pill and a line saying the `people` skill fills them in.
- A Mention of an id not in the directory stays plain text followed by a muted `UserPlus` button: its Popover offers an inline form (name guessed from the id, optional email) that adds the Person (`POST /api/people`).
- In `TokenField`, `@` suggests Persons by id, name words and aliases (accents ignored); a picked one, or a known `@<person id>` followed by a space or punctuation, becomes an atomic Mention chip showing the name. An unknown id stays text there.
- When no Person matches a typed `@<id>`, "Add Person “<id>”" is offered last (core's `suggestPeople` with `offerNew`), in `TokenField` and in Notes. Picking it marks a new Person in the window (`src/people/new-people.ts`): its chip shows the title-cased name guess, dotted, with a small "new". Nothing is written then: the Stub Person (`POST /api/people`, id and name) is written by `saveNewPeople` just before a Todo, Sub-todo, Note or Dev log mentioning them is saved, so an abandoned draft leaves no Person.
- In Notes (and a Dev log's Edit mode) a Mention of a known Person stays `@<person id>` text, highlighted by `mentionHighlighter` in `tokenHighlight` (`.ostraka-mention`, the name as its title); hovering it opens the contact card (`MentionHoverCard`), and `@` suggests Persons there too.

## Search

- ⌘K (Ctrl+K) opens `SearchDialog` (`src/search/search-dialog.tsx`), mounted once in the shell, from anywhere: the shortcut is caught before editors see it. Each opening starts empty. It is shadcn's `command` (cmdk) in a Dialog, with `shouldFilter={false}`: the server finds and ranks (`GET /api/search`, `useSearch` in `src/search/api.ts`), the dialog only lays the hits out and moves the selection.
- A `#tag` or `@person` followed by a space leaves the text and becomes a removable chip under the input (a `TagPill`, or the Person's name in `primary`); Backspace in the empty field removes the last one. Several Tags match all of them, with an All of / Any of toggle before them. A Kind menu and a Date menu (Any date, Last 7 days, Last 30 days, This year, Custom… over a range Calendar) end that row, tinted `primary` once they narrow. Reading the typed text, chips and menus into a query is core's (`@ostraka/core/search-input`): a Person is searched as their whole Mention.
- Hits are grouped by kind, kinds in the order of their best hit (`groupHits`), the server's order kept within each. A row is the kind's rail icon, the title (a Dev log's day or a monthly summary's month, written out), the date at the end; under it the snippet with matches in `<mark>` (`bg-primary/15`) and the Tags as pills. A finished Todo is muted and struck through, a Dropped one says so. ↵ opens the item's view at the match (below).
- With nothing typed or chosen, the dialog lists the 8 items opened last ("Recently opened"), kept per browser in `localStorage` by `src/search/recent.ts`, which works without storage (a private window lists nothing). Opening an item from ⌘K or in its view (`useRememberOpened` in Notes, Dev logs and Sketches) puts it first.
- One muted line stands in for the hits when there is nothing to list, while the server is still indexing ("Indexing…", asked again every 500 ms) and when nothing matches; an error is that line in `text-destructive`. Live updates refetch `['search']` on any content change.
- A section with a list (Notes, Dev logs, Todos) has a search box (`SectionSearch` in `src/search/section-search.tsx`, its text in the URL as `q`): the server finds that kind (`useSectionSearch`), and the list keeps only what it found, in its own order (`filterTodos`, `searchDevlogList` and `filterDevlogDays` take the found ids); a Note or Dev log row shows the snippet under it (`Snippet`). Esc leaves the box and keeps the text; × clears it.
- Matches are highlighted where they show, never by changing the DOM: `useFindHighlight` (`src/search/find-highlight.ts`) paints ranges with the CSS Custom Highlight API (`::highlight(ostraka-search)` in `src/index.css`), found by core's `findMatches` (`@ostraka/core/search-match`) and found again as the view redraws, so it works over the Notes editor too. A chip showing a Mention or Reference as something else (a name, `!809`) is matched by its token, read from `data-mention-chip` or `data-reference-chip`, and painted whole: a new chip kind carries its token the same way. Text inside the server's own `<mark>` is left to it.
- Opening at the match: ⌘K passes the searched text as the view's `q`. A Note or Dev log opens scrolled to its first match, highlighted (`useFindHighlight` with the item's id as its scroll key). A Todo opens with `?todo=<id>`: it, or its parent for a Sub-todo, is expanded and scrolled to (rows carry `data-todo`); a finished one opens Done & Dropped and shows its description and Sub-todos under it.

## Keyboard

- ↵ commits.
- ⇧↵ adds a new line; in a title it opens the description.
- Esc closes the open popup first; pressed again, it leaves the field and keeps the text.
- Tab or ↵ accepts a suggestion.
- ⌘K opens search, from anywhere. It is search only, no commands. Backspace in its empty field removes the last chip.
- Everything is reachable by keyboard and shows a visible focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50`, as in `src/shell/rail.tsx`).

## States

- **Empty**: one muted line naming the next action (`EmptyState` in `src/shell/shell.tsx`). No illustrations.
- **Loading**: skeleton rows, shown only after 300 ms (`useAfter(300, isPending)` from `src/lib/use-after.ts`).
- **Errors**: shown where they happen: a broken file in its own list, an unreadable `config.yml` in Settings, a failing Activity source as a chip in the top bar (`SourceChip` in `src/work/work-overview.tsx`: `destructive` outline pill with its reason, while its last numbers stay, muted and italic, marked stale), the backup warning in the top bar. Errors never go in a toast. A failed load or change is one `text-destructive` line in place, carrying the server's message. Queries don't retry an error the server answered (a broken file stays broken), only a dropped connection.
- **Backup warning** (`BackupWarning` in `src/backup/backup-warning.tsx`): the app never pushes (`ostraka backup` does, from a terminal), so the warning knows only what the content repo says, with no network (`backupWarnings` in `src/backup/warnings.ts`). Nothing while all is well; otherwise one `destructive` outline pill like `SourceChip`, naming the most serious problem (Snapshots not on the remote's branch for over 24 h, then a file over 10 MB) with a count of the others, opening a Popover with all of them and their files. A content folder with no remote gets no backup warning (the README covers setting one up); its large files still warn. Below `@md` the pill is its icon, its Tooltip carrying the title. The Backup is not content, so no live update reaches it: its status refetches every minute.

## Visuals and copy

- Icons come from lucide-react only, sized with `size-*`.
- A status from another system shows as a small dot before the item plus that system's own status text after it: a Jira ticket's dot is coloured by its status category (`muted-foreground` to do, `primary` in progress, `success` done), and done tickets are muted (`TicketRow` in `src/work/work-overview.tsx`); an MR's by its head pipeline (`success` passed, `destructive` failed, `primary` still running).
- UI copy is sentence case and uses the terms in `GLOSSARY.md` (Todo, Sub-todo, Dropped, Tag, Note, Dev log, Sketch, Person, Mention, Reference…), capitalised as there.
- Motion is shadcn's defaults only, and respects `prefers-reduced-motion`.

## Done check

Before calling a screen done, check every changed screen in the browser preview at about 700px wide in all four combinations: light, dark, compact and comfy. Also check 600px for sideways scrolling.
