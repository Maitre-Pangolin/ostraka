# UI component library and design tokens

Research for issue #5. Question: which component library and design-token approach (colours, spacing, typography, dark mode) keeps ostraka's UI consistent when coding agents write most of the front end, given a half-screen-first (~700–960px) layout?

Researched 2026-10-29 against official docs, GitHub repos and the npm registry. The front-end framework is not chosen yet; this note says where a choice here constrains it.

## Answer

**Use shadcn/ui (Base UI primitives, the new default) on Tailwind CSS v4. Keep every design token as a CSS variable in one `globals.css`, and write a short UI conventions document for agents on top of it.**

Why:

- **Agents already know it, and it ships its own agent tooling.** shadcn publishes an agent skill (`skills add shadcn/ui`) that reads the project config and enforces its patterns, an MCP server, and `llms.txt` [1][2]. Tokens and components are plain files in the repo, so agents read the real source instead of guessing at a package API [1].
- **The token model is small and easy to write down.** Semantic colour pairs (`primary` / `primary-foreground`, `muted`, `background` …) in OKLCH, one `--radius` that drives the whole radius scale, and dark mode as the same names overridden under `.dark` [3]. Tailwind v4 turns these into utilities through `@theme inline` [3][4], and derives all spacing from one `--spacing` value [4], so density is one knob.
- **Half-screen fits container queries, which Tailwind v4 has built in** (`@container`, `@md:` … based on the parent's width, not the viewport) [5]. A pane at ~700–960px can lay itself out the same whether the window is half or full screen.
- **The keyboard-first pieces exist:** Command (cmdk, with `CommandDialog` and `CommandShortcut`), Combobox, Kbd, Sidebar, Resizable [6][7]. Base UI also has an Autocomplete primitive [8] for the Jira-key / MR suggestion idea. Markdown gets `prose` / `prose-sm` / `dark:prose-invert` from the official Typography plugin [9].
- **Licence and maintenance are the best of the field:** MIT, ~127k stars, pushed two days before this note, shadcn CLI 4.23.0 published 2026-10-27 [10].

The main cost: shadcn's official ports are React only (Next.js, Vite, TanStack Start, React Router, Astro, Laravel via React) [11]. Choosing it means a React front end. Community ports exist for Svelte (shadcn-svelte) and Vue (shadcn-vue), both MIT and active [10], but agents know them less well and the official skill and MCP do not cover them.

## Candidates compared

| | shadcn/ui + Tailwind v4 | Radix Themes | Mantine | Park UI (Ark UI + Panda CSS) | Plain CSS variables + small primitive set |
|---|---|---|---|---|---|
| What it is | Copy-in component source on Base UI, Radix or React Aria primitives [1][12] | Pre-styled React package [13] | Full React component library + hooks [14] | Styled components on Ark UI, Panda CSS [15] | Hand-written tokens and components, maybe on Base UI or Ark UI |
| Framework coupling | React (official) [11]; community Svelte/Vue ports | React | React only [14] | React, Solid [15] (Ark UI also Vue/Svelte) | None for tokens; primitives are framework-bound |
| Agent familiarity | Very high; official skill, MCP, llms.txt [2] | Medium | High; llms.txt, MCP server, skills [16] | Low | Low: everything is project-specific |
| Writing conventions down for agents | Easy: tokens in one CSS file, source in repo, skill enforces patterns [2][3] | Easy, but few knobs | Theme object in TS; conventions live in package docs [17] | Panda config; little agent material | Fully custom; we must write all of it |
| Dense UI | `--spacing` base; edit any component's source [4][1] | `scaling` 90%–110% [18] | `scale`, size props [17] | Panda tokens | Whatever we write |
| Half-screen layout | Container queries built in [5] | Viewport breakpoints only (xs 520, sm 768, md 1024 …) [19] | Viewport breakpoints in em; no container queries in docs [17] | Panda supports container queries | Native CSS container queries |
| Command palette / autocomplete | Command (cmdk), Combobox, Base UI Autocomplete [6][8] | Neither in Themes [13] | Spotlight (mod+K), use-hotkeys [20] | Ark Combobox | Must assemble (e.g. cmdk) |
| Markdown | Tailwind Typography `prose` [9] | Own typography components | `@mantine/tiptap` editor [14] | Hand-styled | Hand-styled |
| Licence | MIT [10] | MIT [10] | MIT [14] | MIT [10] | — |
| Maintenance (Oct 2026) | Very active [10] | Slow: last npm release 3.3.0 on 2026-01-31, previous in Feb 2025; repo last pushed Apr 2026 [10][21] | Very active; v9.7.4, Oct 2026 [21] | Repo last pushed Apr 2026; Ark UI active [10] | Our own |

### Notes per candidate

- **Radix Themes** gives the most consistent look for the least work (one `<Theme accentColor grayColor radius scaling>` wrapper [18]), and `scaling="90%"` is a real density knob. But it has no command palette or combobox [13], its breakpoints are viewport-based [19], and releases have slowed to about one a year [21]. Not recommended.
- **Mantine** is the strongest alternative: MIT, very active, and the only one with a ready command palette (Spotlight, mod+K by default, built on `use-hotkeys`) and its own LLM tooling (llms.txt, `@mantine/mcp-server`, skills) [16][20]. It loses on coupling (React only, CSS via its PostCSS preset [14]), on the absence of container queries in its docs [17], and on tokens living in a TypeScript theme object rather than in files agents edit directly. Pick it if the stack ends up React and we want more batteries (forms, dates, notifications) over owning the source.
- **Park UI** is now part of the Chakra organisation [15] and spans React and Solid, but has the least agent familiarity and its repo has been quiet since April 2026 [10]. Not recommended.
- **Plain CSS variables + a small primitive set** has zero framework coupling, but agents drift without a library to anchor them, and we would write and document every component. Worth it only if the stack choice lands on something without a good shadcn port (e.g. HTMX or plain server templates). Even then, keep the shadcn token names (see below) so the conventions doc stays the same.

## Token approach (works whichever library wins)

Write tokens once, as CSS custom properties, in one file agents are told to read:

- **Colours:** semantic pairs only (`background`/`foreground`, `primary`/`primary-foreground`, `muted`, `accent`, `destructive`, `border`, `ring`), OKLCH values [3]. Agents use `bg-primary`, never `bg-zinc-900`. Add a token by defining it under `:root` and `.dark` and exposing it in `@theme inline` [3].
- **Dark mode:** same names overridden under `.dark`, toggled by a class on `<html>` [3]; follow the OS by default.
- **Spacing / density:** one `--spacing` base [4]. A compact base (e.g. smaller than the 0.25rem default) gives quick-capture density without per-component edits.
- **Radius:** one `--radius`; the scale is derived with `calc()` [3].
- **Typography:** `--font-sans`, `--font-mono` and a short `--text-*` scale [4]; rendered Markdown (Notes, Dev logs) uses `prose prose-sm dark:prose-invert` [9].
- **Layout:** panes declare `@container`; components use `@md:` / `@3xl:` variants instead of viewport `md:`. Tailwind's `@2xl` (672px) to `@4xl` (896px) bracket the half-screen range [5].

## Follow-ups for the map

- This answer couples to React; the stack ticket should weigh that.
- The "UI conventions document for agents" item can be short: the token file, "semantic tokens only", "container queries, not viewport breakpoints", "install components with the shadcn CLI, then edit", and the shadcn skill installed for both Claude Code and Cursor. The shadcn skills page names Claude Code only [2]; Cursor support of the skills.sh format was not verified here.
- Check density in the half-screen prototype before fixing the `--spacing` value.

## Sources

1. shadcn/ui introduction — https://ui.shadcn.com/docs
2. shadcn/ui skills — https://ui.shadcn.com/docs/skills
3. shadcn/ui theming — https://ui.shadcn.com/docs/theming
4. Tailwind CSS theme variables — https://tailwindcss.com/docs/theme
5. Tailwind CSS responsive design and container queries — https://tailwindcss.com/docs/responsive-design
6. shadcn/ui Command — https://ui.shadcn.com/docs/components/command
7. shadcn/ui components index — https://ui.shadcn.com/docs/components
8. Base UI quick start (components list, v1.9.0) — https://base-ui.com/react/overview/quick-start
9. Tailwind Typography plugin — https://github.com/tailwindlabs/tailwindcss-typography
10. GitHub repo metadata via `gh api repos/<owner>/<repo>` on 2026-10-29: shadcn-ui/ui (MIT, pushed 2026-10-27), radix-ui/themes (MIT, pushed 2026-04-11), mui/base-ui (MIT), mantinedev/mantine (MIT), chakra-ui/park-ui (MIT, pushed 2026-04-10), chakra-ui/ark (MIT), dip/cmdk (MIT, pushed 2025-10-29), huntabyte/shadcn-svelte (MIT), unovue/shadcn-vue (MIT)
11. shadcn/ui installation — https://ui.shadcn.com/docs/installation
12. shadcn/ui changelog, "Base UI as the Default" (July 2026; Radix still supported via `init -b radix`) — https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
13. Radix Themes getting started and theme overview — https://www.radix-ui.com/themes/docs/overview/getting-started, https://www.radix-ui.com/themes/docs/theme/overview
14. Mantine getting started — https://mantine.dev/getting-started/
15. Park UI — https://park-ui.com/
16. Mantine with LLMs — https://mantine.dev/guides/llms/
17. Mantine theme object — https://mantine.dev/theming/theme-object/
18. Radix Themes `Theme` component (scaling 90%–110%) — https://www.radix-ui.com/themes/docs/components/theme
19. Radix Themes breakpoints — https://www.radix-ui.com/themes/docs/theme/breakpoints
20. Mantine Spotlight — https://mantine.dev/x/spotlight/
21. npm registry via `npm view` on 2026-10-29: @radix-ui/themes 3.3.0 (2026-01-31; 3.2.1 2025-02-27), @mantine/core 9.7.4 (2026-10-25), @base-ui/react 1.9.0, cmdk 1.1.1, shadcn 4.23.0 (2026-10-27), tailwindcss 4.3.3
