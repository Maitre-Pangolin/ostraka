// `ostraka backup` and `ostraka init --from <remote-url>`: back up now, and set up a new machine from the backup.
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { backup, backupState, cloneContent, configPath, loadConfig, resolveContentRoot, type LargeFile } from '@ostraka/core'
import { KEYCHAIN_ITEMS, type CredentialName, type Keychain } from '@ostraka/server'

export type BackupIo = {
  env: Record<string, string | undefined>
  homeDir?: string
  /** Where the push token comes from: `macKeychain()` from the `ostraka` binary, a fake in tests. */
  keychain?: Keychain
  /** Asks the user one line (the init walkthrough); without one, init prints the steps and does not wait. */
  readLine?: (prompt: string) => Promise<string>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export const BACKUP_USAGE = `  ostraka backup [--json]       Push the content folder to its remote now
  ostraka init --from <remote-url>
                                Set up a new machine: Keychain items, content, config.yml
`

function requireKeychain(io: BackupIo): Keychain {
  if (!io.keychain) throw new Error('No Keychain to read the push token from.')
  return io.keychain
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const warnLarge = (io: BackupIo, files: LargeFile[]) =>
  files.forEach(({ file, bytes }) => io.stderr(`Warning: ${file} is ${megabytes(bytes)}; keep content files under 10 MB.\n`))

export async function backupCommand(args: string[], io: BackupIo): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  if (positionals.length > 0) {
    io.stderr(`Usage:\n${BACKUP_USAGE}`)
    return 1
  }
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  // macOS prompts here: the item is created with `-T ""` so every read asks.
  const token = await requireKeychain(io).read(KEYCHAIN_ITEMS.push)
  const result = await backup({ ...options, token })
  const { largeFiles } = await backupState(options)
  const ok = result.status === 'backed-up' || result.status === 'empty'
  if (values.json) {
    io.stdout(`${JSON.stringify({ ...result, largeFiles }, null, 2)}\n`)
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
        `The content folder has no remote. Create a private project on the work gitlab.com, then:\n  git -C ${await resolveContentRoot(options)} remote add origin <url>\n`,
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
        `Backup failed: ${result.reason}${token === undefined ? `\n(No Keychain item ${KEYCHAIN_ITEMS.push}: see README, Credentials.)` : ''}\n`,
      )
      break
  }
  warnLarge(io, largeFiles)
  return ok ? 0 : 1
}

/** What each Keychain item holds, in the order the walkthrough asks for them: the push token first, to clone. */
const ITEM_PURPOSES: [CredentialName, string][] = [
  ['push', 'backup push and restore, a GitLab token with write_repository on the content project'],
  ['gitlab', 'GitLab, a fine-grained personal access token with read_api'],
  ['jira', 'Jira, a scoped API token with read:jira-work'],
]

const addItemCommand = (item: string) =>
  `read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`

export async function initCommand(args: string[], io: BackupIo): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { from: { type: 'string' } } })
  if (values.from === undefined || positionals.length > 0) {
    io.stderr(`Usage:\n${BACKUP_USAGE}`)
    return 1
  }
  const homeDir = io.homeDir ?? homedir()
  const options = { env: io.env, homeDir }
  const keychain = requireKeychain(io)
  const root = await resolveContentRoot(options)
  // Checked before the walkthrough too, so a machine already set up is told so straight away.
  if ((await readdir(root).catch(() => [])).length > 0)
    throw new Error(`${root} already exists and is not empty: init --from only sets up a new machine.`)

  io.stdout(
    `1. Keychain items. Tokens live only in the Keychain, created with -T "" so every read prompts.\n   Run each command in another terminal tab and paste the token at its silent prompt.\n`,
  )
  for (const [name, purpose] of ITEM_PURPOSES) {
    const item = KEYCHAIN_ITEMS[name]
    if (await keychain.has(item)) {
      io.stdout(`   ${item}: found\n`)
      continue
    }
    io.stdout(`   ${item}: ${purpose}\n     ${addItemCommand(item)}\n`)
    while (io.readLine && !(await keychain.has(item))) {
      const answer = await io.readLine(`   Press Enter once ${item} is created (or type skip): `)
      if (answer.trim().toLowerCase() === 'skip') break
    }
    if (io.readLine) io.stdout(`   ${item}: ${(await keychain.has(item)) ? 'found' : 'skipped'}\n`)
  }

  io.stdout(`2. Content: cloning ${values.from} into ${root}\n`)
  const token = (await keychain.has(KEYCHAIN_ITEMS.push)) ? await keychain.read(KEYCHAIN_ITEMS.push) : undefined
  const cloned = await cloneContent(values.from, { ...options, token })
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
    '#   board_id: 42 # its active sprint is shown',
    '#   my_tickets_jql: assignee = currentUser() AND statusCategory != Done',
    '',
  ].join('\n')
}
