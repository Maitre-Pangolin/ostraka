# Web app: UI conventions

Rules every screen follows (decided in #26). They are rules, not a component catalogue: read the files they point to.

**Keep this file current.** A change that adds a UI pattern (a new kind of picker, state, shortcut, token) updates this file in the same change. Code review checks screens against it.

## Stack

- Vite, React 19, TanStack Router (`src/router.tsx`), shadcn/ui on Base UI, Tailwind v4, lucide-react.
- View state worth a reload or a link (filters, a date range, the open item) lives in typed router search params: the route's `validateSearch` checks them with a parser from core, which leaves out empty and default values so a plain view has a clean URL (`parseTodoFilter` on `/todos`). Changing them navigates with `replace: true`.
- Add components with the shadcn CLI (`pnpm exec shadcn add <name>` from `apps/web`), then edit the copy in `src/components/ui/`. Base UI composes through the `render` prop (see `src/shell/rail.tsx`).
- Server state comes from the API under `/api`. In development Vite proxies `/api` to `ostraka serve` on 127.0.0.1:4747, so run both. In production the server serves `dist/` from the same origin.
- Server state lives only in TanStack Query, with no second client store. Each section keeps its queries and mutations as hooks in one `api.ts` (see `src/todos/api.ts`), calling the server through `src/lib/api.ts`. The server's answer (order included) is shown as is. An immediate change updates the cache in `onMutate`, rolls back on error, and invalidates on settle.
- Live updates: `src/lib/live-updates.tsx` turns the server's `{kind, id?}` change stream (`/api/events`) into query invalidations, whoever changed the file. So every content query key starts with its kind (`['todos', …]`, `['notes', id]`), and content is never polled.
- A change to an existing item sends the `version` the server answered with that item (`post(path, body, { version })`, sent as `If-Match`). If the item changed elsewhere since, the server refuses it with 412 (`isStale(error)`): the error line in place adds “Showing the newer version.”, and the invalidation on settle shows it.
- Content and config types come from core's Zod schemas as type-only imports (`import type { Todo } from '@ostraka/core/todo-schema'`, `Config` from `@ostraka/core/config-schema`). Core's entry point pulls in Node modules, so import its zod-only subpaths.
- The app installs as a browser web app (own window, Dock icon) from `public/manifest.webmanifest`, linked in `index.html` with the `apple-touch-icon` for Safari's Add to Dock. Its icons are PNGs in `public/`; a changed icon updates all of them.

## Layout

- The shell (`src/shell/shell.tsx`) is the left rail, the top bar and the current view. Every view renders inside the content area, which is the `@container`.
- Lay out with container queries on the content area: `@md:`, `@3xl:`. The window is sized by the user, so viewport variants (`md:`, `lg:`) describe the wrong box.
- `@md` is the single compact breakpoint. Below it, secondary metadata hides and labels become icons with a Tooltip carrying the label. List and detail sit side by side from `@3xl`.
- The minimum window is 600px wide. At 600px nothing scrolls sideways: long text truncates (`min-w-0` + `truncate`) or wraps.

## Density

- Density is one knob: Tailwind's `--spacing`, 0.21rem compact (default) and 0.25rem comfy, set from `data-density` on `<html>` in `src/index.css`.
- Space with ordinary spacing utilities (`p-3`, `gap-1.5`, `h-9`, `size-4`). They all scale with `--spacing`, so components stay density-agnostic: no density branches, no pixel spacing.
- Font sizes stay the same in both densities.

## Colour and theme

- Use semantic colour tokens only: `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `border`, `ring`, `destructive`, and the app tokens `today`, `prio-*`, `tag-1`…`tag-8`. Raw Tailwind palette colours and hex values stay out of components.
- Tokens live in `src/index.css`: values under `:root` (light) and `.dark`, exposed to Tailwind in `@theme inline`. A new token gets a light value, a dark value and a `@theme inline` line.
- Light/dark is the `.dark` class on `<html>`, defaulting to light. Theme and density are per-browser choices handled by `src/shell/appearance.tsx`.

## Editing

- Edit inline, where the thing is shown. Pickers (date, priority, Tags, People) open in a Popover anchored to what they change.
- Forms live inline too; a Dialog is never a form.
- Single-item done, Drop or delete happens at once, with a 5-second Undo toast: sonner's `toast(what happened, { description: item title, duration: 5000, action: { label: 'Undo', … } })`, as in `src/todos/todos-view.tsx`. The `<Toaster />` lives in the shell. Undo of a delete posts the item back as it was (`useRestoreTodo`).
- Row actions that would clutter the list (Drop or delete) sit at the row's end, shown on row hover or keyboard focus (`group/row`, `opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100`), and open a Popover, as `DropOrDelete` in `src/todos/todos-view.tsx`. An optional field in it (the Drop reason) is skippable: ↵ on the empty field still acts.
- Finished items (Done & Dropped) are kept, in a section collapsed by default below the open ones: a muted disclosure button with a chevron and the count, `aria-expanded`. Finished rows are muted and struck through, show when they finished, and reopen from their checkbox or Dropped icon.
- A confirmation Dialog guards only bulk or hard-to-reverse changes (merging Tags, finishing a parent with open Sub-todos).
- Toasts exist only for Undo.
- Read-only settings sit in bordered definition lists, label then value (monospace for paths, URLs and ids), as in `src/settings/settings-view.tsx`. Settings has no form: `config.yml` is edited by hand.
- Confirmations and text entry use the app's own Dialog and inputs; browser `prompt()`, `confirm()` and `alert()` stay unused.
- The priority picker is a Popover of flags (`PriorityPicker`); the date picker is a Popover with quick picks over a Calendar and a Clear date (`DuePicker`), both in `src/todos/properties.tsx`.
- Tags show as pills coloured `tag-1`…`tag-8` (`TagPill`), with × where one can be removed. Below `@md` a collapsed row shows them as dots. A Tag's colour comes from `tags.yml` through `GET /api/tags` (`useTagColor`); a Tag without one, or not in use yet, gets the colour its name hashes to (core's `defaultTagColor`).
- A due date reads relative to today (`DueText`): overdue is highlighted strongly (`destructive` pill), due today lightly (`today` text).
- An expanded row edits its text in place and shows no empty field: a description appears only once there is one, or after ⇧↵ in the title, and closes again when emptied.

## Filters

- A list is narrowed by filter chips over it (`TodoFilters` in `src/todos/filters.tsx`): each chip (Priority, Tags, later People) opens a Popover checklist (Tags alphabetical) with a search field past 6 options. A chip with values chosen is tinted `primary` and shows their count.
- Groups combine with AND. Tags match all chosen by default, with an All/Any toggle in the Tags picker.
- Active values follow as removable chips (×), then Clear all. With more than one Tag, the chips are labelled "All of" or "Any of".
- Matching is core's (`@ostraka/core/todo-filter`), never the app's own, and keeps the server's order. A parent that matches only through its Sub-todos stays in the list dimmed (`DIMMED`), with the matching Sub-todos under it.
- A filter that matches nothing shows the empty line, naming how to widen it.

## Quick-entry tokens

- `#tag`, `*high|*med|*low` and `^today|^tomorrow|^fri|^2026-11-05` are parsed by core (`@ostraka/core/todo-tokens`), never by the app itself, so the CLI and agents read them the same way.
- Title and description fields where tokens apply use `TokenField` (`src/todos/token-field.tsx`). A token leaves the text once completed, picked with Tab or ↵ or followed by a space, and suggestions show while one is typed (existing Tags first; a new Tag is offered only when none matches).
- In quick entry the values wait as removable chips under the input until the Todo is added; in an open Todo they change it straight away.

## Keyboard

- ↵ commits.
- ⇧↵ adds a new line; in a title it opens the description.
- Esc closes the open popup first; pressed again, it leaves the field and keeps the text.
- Tab or ↵ accepts a suggestion.
- ⌘K opens search, from anywhere. It is search only, no commands.
- Everything is reachable by keyboard and shows a visible focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50`, as in `src/shell/rail.tsx`).

## States

- **Empty**: one muted line naming the next action (`EmptyState` in `src/shell/shell.tsx`). No illustrations.
- **Loading**: skeleton rows, shown only after 300 ms (`useAfter(300, isPending)` from `src/lib/use-after.ts`).
- **Errors**: shown where they happen: a broken file in its own list, an unreadable `config.yml` in Settings, a failing Activity source as a chip in the top bar, the backup warning in the top bar.
- **Top bar**: GitLab and Jira counts sit on the left; warnings sit at the end (`justify-end`), each a `text-destructive` chip with an icon and a one-line title that opens a Popover with the details, as `BackupWarning` in `src/backup/backup-warning.tsx`. Nothing shows while all is well. Below `@md` the chip is its icon, its Tooltip carrying the title. Status that is not content (the Backup) has no live update and refetches every minute. Errors never go in a toast. A failed load or change is one `text-destructive` line in place, carrying the server's message. Queries don't retry an error the server answered (a broken file stays broken), only a dropped connection.

## Visuals and copy

- Icons come from lucide-react only, sized with `size-*`.
- UI copy is sentence case and uses the terms in `GLOSSARY.md` (Todo, Sub-todo, Dropped, Tag, Note, Dev log, Sketch, Person, Mention, Reference…), capitalised as there.
- Motion is shadcn's defaults only, and respects `prefers-reduced-motion`.

## Done check

Before calling a screen done, check every changed screen in the browser preview at about 700px wide in all four combinations: light, dark, compact and comfy. Also check 600px for sideways scrolling.
