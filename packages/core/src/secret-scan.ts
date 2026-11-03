// The token shapes a backup refuses to push. A prefix alone (a note saying tokens start with `glpat-`) is not a
// token: each pattern wants the body that follows it.
const PATTERNS: [kind: string, pattern: RegExp][] = [
  ['GitLab token', /\bglpat-[\w-]{20,}/],
  ['Slack token', /\bxox[abeprs]-[\w-]{10,}/],
  ['Atlassian token', /\bATATT[\w=+/-]{20,}/],
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
]

/** The kinds of secret found in the text, each once, in a fixed order. Never returns the secret itself. */
export function findSecrets(text: string): string[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind)
}
