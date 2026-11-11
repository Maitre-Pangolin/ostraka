# AGENTS.md

Instructions for coding agents (Claude Code, Cursor) working in this repo.

## Workspace

pnpm workspace: `packages/core` (content root, schemas, file access), `packages/cli` (`ostraka`, a thin layer over core), `apps/server` (Hono API on 127.0.0.1:4747), `apps/web` (the app). The spec is issue #28.

- CLI, server and core run as TypeScript straight through Node's type stripping, with no build step: import with `.ts` extensions and write only erasable syntax (no `enum`, no parameter properties, no `namespace`).
- Test through the public seams: core against a temporary content folder (`OSTRAKA_HOME`), the server through `app.request()`, the CLI through `run()`.
- `pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test` is what CI runs.

## Web UI

Before building or changing any screen, read `apps/web/AGENTS.md`: the UI conventions every screen follows.

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues in Maitre-Pangolin/ostraka, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels unchanged (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
