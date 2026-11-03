// Mentions: a Person written as `@<person id>` in plain text. Pure and free of Node and zod, so the web app, the
// server, the CLI and search share one grammar, as with References (`references.ts`).

/** Lowercase, accents and case left out, for matching names as typed. */
export const foldText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** The id a name suggests: its words, without accents, joined by hyphens. */
export const personIdFromName = (name: string) =>
  foldText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
