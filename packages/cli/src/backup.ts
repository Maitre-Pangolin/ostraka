// `ostraka backup` and `ostraka init --from <remote-url>`: back up now, and set up a new machine from the backup.
// Neither reads the Keychain: only the app server holds the push token, so `backup` asks the running server to push,
// and `init` lets git authenticate the clone as it would for the user.
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { cloneContent, configPath, loadConfig, resolveContentRoot, type BackupResult, type LargeFile } from '@ostraka/core'
import { HOSTNAME, KEYCHAIN_ITEMS, PORT, type CredentialName } from '@ostraka/server'
import type { Io } from './main.ts'
import { askServer } from './server.ts'

export const BACKUP_USAGE = `  ostraka backup [--json]       Ask the running app server to push the content folder to its remote now
  ostraka init --from <remote-url>
                                Set up a new machine: Keychain items, content, config.yml
`

/** A push scans, pushes and checks the remote, each git step allowed 2 minutes. */
const PUSH_TIMEOUT_MS = 6 * 60_000

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const warnLarge = (io: Io, files: LargeFile[]) =>
  files.forEach(({ file, bytes }) => io.stderr(`Warning: ${file} is ${megabytes(bytes)}; keep content files under 10 MB.\n`))

export async function backupCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  if (positionals.length > 0) {
    io.stderr(`Usage:\n${BACKUP_USAGE}`)
    return 1
  }
  const root = await resolveContentRoot({ env: io.env, homeDir: io.homeDir ?? homedir() })
  const answer = await askServer('/backup', root, io, { method: 'POST', timeoutMs: PUSH_TIMEOUT_MS })
  if (answer.kind === 'down') {
    io.stderr(
      `No Ostraka server is running on http://${HOSTNAME}:${PORT}, and only the server pushes (it holds the push token).\nStart it with ostraka serve, or check its LaunchAgent: launchctl print gui/$(id -u)/com.ostraka.server\n`,
    )
    return 1
  }
  if (answer.kind === 'elsewhere') {
    io.stderr(
      `The server on http://${HOSTNAME}:${PORT} serves ${answer.root ?? 'another content folder'}, not ${root}: it was not asked to push.\n`,
    )
    return 1
  }
  const body = (await answer.res.json()) as (BackupResult & { largeFiles: LargeFile[] }) | { error: string }
  if ('error' in body) {
    io.stderr(`Backup failed: ${body.error}\n`)
    return 1
  }
  const { largeFiles, ...result } = body
  const ok = result.status === 'backed-up' || result.status === 'empty'
  if (values.json) {
    io.stdout(`${JSON.stringify(body, null, 2)}\n`)
    return ok ? 0 : 1
  }
  switch (result.status) {
    case 'backed-up':
      io.stdout(
        result.pushed ? `Backed up ${result.commit.slice(0, 7)} to origin.\n` : `Already backed up (${result.commit.slice(0, 7)}).\n`,
      )
      break
    case 'empty':
      io.stdout('Nothing to back up yet: no Snapshot.\n')
      break
    case 'no-remote':
      io.stderr(
        `The content folder has no remote. Create a private project on the work gitlab.com, then:\n  git -C ${root} remote add origin <url>\n`,
      )
      break
    case 'secrets':
      io.stderr(
        `Backup blocked: nothing was pushed. These files look like they hold a secret:\n${result.files
          .map(({ file, kinds }) => `  ${file} (${kinds.join(', ')})\n`)
          .join('')}Take it out of every Snapshot not backed up yet (a removed secret stays in history), then run ostraka backup.\n`,
      )
      break
    case 'rejected':
      io.stderr(`${result.reason}\n`)
      break
    case 'failed':
      io.stderr(
        `Backup failed: ${result.reason}\n(The server pushes with Keychain item ${KEYCHAIN_ITEMS.push}: see README, Credentials.)\n`,
      )
      break
  }
  warnLarge(io, largeFiles)
  return ok ? 0 : 1
}

/** What each Keychain item holds, in the order the walkthrough asks for them. */
const ITEM_PURPOSES: [CredentialName, string][] = [
  ['push', 'backup push, a GitLab token with write_repository on the content project'],
  ['gitlab', 'GitLab, a fine-grained personal access token with read_api'],
  ['jira', 'Jira, a scoped API token with read:jira-work'],
]

const addItemCommand = (item: string) =>
  `read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`

export async function initCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { from: { type: 'string' } } })
  if (values.from === undefined || positionals.length > 0) {
    io.stderr(`Usage:\n${BACKUP_USAGE}`)
    return 1
  }
  const homeDir = io.homeDir ?? homedir()
  const options = { env: io.env, homeDir }
  const root = await resolveContentRoot(options)
  // Checked before the walkthrough too, so a machine already set up is told so straight away.
  if ((await readdir(root).catch(() => [])).length > 0)
    throw new Error(`${root} already exists and is not empty: init --from only sets up a new machine.`)

  // The items are created by the user and read only by the server, so nothing here checks them.
  io.stdout(
    `1. Keychain items, read only by the app server. Tokens live only in the Keychain, created with -T "" so every read\n   prompts. Run each command in another terminal tab and paste the token at its silent prompt; -U replaces one\n   already there.\n`,
  )
  for (const [name, purpose] of ITEM_PURPOSES) {
    const item = KEYCHAIN_ITEMS[name]
    io.stdout(`   ${item}: ${purpose}\n     ${addItemCommand(item)}\n`)
    if (!io.readLine) continue
    const answer = await io.readLine(`   Press Enter once ${item} is created (or type skip): `)
    io.stdout(`   ${item}: ${answer.trim().toLowerCase() === 'skip' ? 'skipped' : 'created'}\n`)
  }

  // git authenticates as it would for the user (their SSH key or credential helper, or by asking): no token here.
  io.stdout(`2. Content: cloning ${values.from} into ${root}\n`)
  const cloned = await cloneContent(values.from, { ...options, interactive: true })
  if (cloned.status === 'failed') {
    io.stderr(`Could not clone ${values.from}: ${cloned.reason}\n`)
    return 1
  }

  const file = configPath(homeDir)
  if (await exists(file)) {
    await loadConfig({ homeDir })
    io.stdout(`3. Kept ${file} as it is.\n`)
  } else {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, initialConfig(root, homeDir, gitlabBaseUrl(values.from)))
    io.stdout(`3. Wrote ${file}: fill in the Jira settings (see README, Configure it).\n`)
  }

  io.stdout(`Done. Next: pnpm ostraka install (or restart the server: launchctl kickstart -k gui/$(id -u)/com.ostraka.server).\n`)
  return 0
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The GitLab instance the backup lives on: `https://host` from an HTTP(S) URL or `git@host:group/project.git`. */
function gitlabBaseUrl(remote: string): string | undefined {
  if (/^https?:\/\//.test(remote)) return new URL(remote).origin
  const scp = /^[\w.-]+@([\w.-]+):/.exec(remote)
  return scp ? `https://${scp[1]}` : undefined
}

function initialConfig(root: string, homeDir: string, baseUrl: string | undefined): string {
  const fromHome = relative(homeDir, root)
  const contentDir = fromHome.startsWith('..') ? root : join('~', fromHome)
  return [
    '# Settings only, never secrets: tokens live in the Keychain. Written by ostraka init --from.',
    `contentDir: ${contentDir}`,
    ...(baseUrl ? ['gitlab:', `  base_url: ${baseUrl}`] : ['# gitlab:', '#   base_url: https://gitlab.com']),
    '# jira:',
    '#   site: https://acme.atlassian.net',
    '#   cloud_id: 00000000-0000-0000-0000-000000000000 # from <site>/_edge/tenant_info',
    '#   email: you@acme.com # your Atlassian account; the API token signs in with it',
    '#   board_id: 42 # its active sprint is shown',
    '#   my_tickets_jql: assignee = currentUser() AND statusCategory != Done',
    '',
  ].join('\n')
}
