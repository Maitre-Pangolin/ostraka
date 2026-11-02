# Web app: UI conventions

Rules every screen follows (decided in #26). They are rules, not a component catalogue: read the files they point to.

**Keep this file current.** A change that adds a UI pattern (a new kind of picker, state, shortcut, token) updates this file in the same change. Code review checks screens against it.

## Stack

- Vite, React 19, TanStack Router (`src/router.tsx`), shadcn/ui on Base UI, Tailwind v4, lucide-react.
- Add components with the shadcn CLI (`pnpm exec shadcn add <name>` from `apps/web`), then edit the copy in `src/components/ui/`. Base UI composes through the `render` prop (see `src/shell/rail.tsx`).
- Server state comes from the API under `/api`. In development Vite proxies `/api` to `ostraka serve` on 127.0.0.1:4747, so run both. In production the server serves `dist/` from the same origin.
- Server state lives only in TanStack Query, with no second client store. Each section keeps its queries and mutations as hooks in one `api.ts` (see `src/todos/api.ts`), calling the server through `src/lib/api.ts`. The server's answer (order included) is shown as is. An immediate change updates the cache in `onMutate`, rolls back on error, and invalidates on settle.
- Content types come from core's Zod schemas as type-only imports (`import type { Todo } from '@ostraka/core/todo-schema'`). Core's entry point pulls in Node modules, so import its zod-only subpaths.

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
- Single-item done, Drop or delete happens at once, with a 5-second Undo toast: sonner's `toast(what happened, { description: item title, duration: 5000, action: { label: 'Undo', … } })`, as in `src/todos/todos-view.tsx`. The `<Toaster />` lives in the shell.
- A confirmation Dialog guards only bulk or hard-to-reverse changes (merging Tags, finishing a parent with open Sub-todos).
- Toasts exist only for Undo.
- Confirmations and text entry use the app's own Dialog and inputs; browser `prompt()`, `confirm()` and `alert()` stay unused.

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
- **Errors**: shown where they happen: a broken file in its own list, a failing Activity source as a chip in the top bar, the backup warning in the top bar. Errors never go in a toast. A failed load or change is one `text-destructive` line in place, carrying the server's message. Queries don't retry an error the server answered (a broken file stays broken), only a dropped connection.

## Visuals and copy

- Icons come from lucide-react only, sized with `size-*`.
- UI copy is sentence case and uses the terms in `GLOSSARY.md` (Todo, Sub-todo, Dropped, Tag, Note, Dev log, Sketch, Person, Mention, Reference…), capitalised as there.
- Motion is shadcn's defaults only, and respects `prefers-reduced-motion`.

## Done check

Before calling a screen done, check every changed screen in the browser preview at about 700px wide in all four combinations: light, dark, compact and comfy. Also check 600px for sideways scrolling.
