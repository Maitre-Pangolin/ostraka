import { execFile } from 'node:child_process'
import { access, chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { Io } from './main.ts'

/** What `install` needs from the machine, injected so tests never touch launchd, git or pnpm. */
export type System = {
  platform: NodeJS.Platform
  /** Absolute path to the node binary the LaunchAgent and the shim run. */
  nodePath: string
  /** That node's version, `process.versions.node`. */
  nodeVersion: string
  uid: number
  launchctl: (args: string[]) => Promise<{ code: number; stdout?: string; stderr: string }>
  /** Runs a program (git, pnpm) and collects what it printed. */
  run: (command: string, args: string[], options: { cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>
}

export const realSystem = (): System => ({
  platform: process.platform,
  nodePath: process.execPath,
  nodeVersion: process.versions.node,
  uid: process.getuid?.() ?? 0,
  launchctl: (args) =>
    new Promise((resolve) => {
      execFile('/bin/launchctl', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
      })
    }),
  run: (command, args, { cwd }) =>
    new Promise((resolve) => {
      execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
      })
    }),
})

export const LAUNCH_AGENT_LABEL = 'com.ostraka.server'
export const launchAgentPath = (homeDir: string) => join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
export const launchAgentLogs = (homeDir: string) => join(homeDir, 'Library', 'Logs', 'ostraka')
/** The installed copy of the app, which the LaunchAgent, the shim and the skill links point at. */
export const appDir = (homeDir: string) => join(homeDir, 'Library', 'Application Support', 'ostraka', 'app')

/** The repo this command runs from: a working checkout, or the installed copy itself when run through the shim. */
const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '')
const BIN = join('packages', 'cli', 'bin', 'ostraka.ts')
const SKILLS = join('.claude', 'skills')
/** The People instruction for ~/.claude/CLAUDE.md and Cursor's User Rules, which the user adds themselves. */
const GLOBAL_INSTRUCTION = join(SKILLS, 'people', 'global-instruction.md')
// Node runs the TypeScript sources directly (type stripping), from 24 on.
const MIN_NODE = 24

export type InstallOptions = {
  /** The branch (or tag) of the source repo to install. */
  ref: string
  skipTests: boolean
  /** One line per step, as it starts. */
  log: (line: string) => void
}

export type InstallResult = {
  app: string
  /** Where the copy was cloned from, and what it is: `main at 1a2b3c4 Subject`. */
  source: string
  version: string
  plist: string
  shim: string
  logs: string
  /** `~/.claude/skills/<name>`, each a link to the installed copy's skill folder. */
  skills: string[]
  /** Skill paths already taken by something `install` didn't link there, left as they are. */
  skippedSkills: string[]
  /** The old Cursor `/devlog` command, when it is still there: the devlog skill replaces it. */
  oldDevlogCommand?: string
  /** The global People instruction, when ~/.claude/CLAUDE.md doesn't run `ostraka people find` yet. */
  globalInstruction?: string
}

/**
 * Installs the app as a copy of its own, so what runs never depends on what a working checkout has checked out:
 * clones `ref` of the source repo next to the installed copy, installs, builds and tests it there, and only then
 * swaps it in (the previous copy stays as `app.prev`). Then writes the LaunchAgent (`ostraka serve` at login,
 * restarted after a crash, logs in ~/Library/Logs/ostraka) and the shim at ~/.local/bin/ostraka, both pointing at
 * the copy, links its skills, and (re)loads the agent in the user's GUI session, where the Keychain prompts can
 * show; reloading stops the running app with SIGTERM, so pending changes become a Snapshot first. The environment is
 * not copied into any file, so no secret lands on disk. A failed step leaves the installed copy as it was.
 */
export async function install(homeDir: string, system: System, options: InstallOptions): Promise<InstallResult> {
  if (system.platform !== 'darwin') throw new Error('ostraka install sets up a LaunchAgent, so it only runs on macOS.')
  const major = Number(system.nodeVersion.split('.')[0])
  if (!(major >= MIN_NODE)) {
    throw new Error(
      `Node ${system.nodeVersion} (${system.nodePath}) is too old: the app needs Node ${MIN_NODE} or newer. Switch to it (nvm use ${MIN_NODE}) and run this again.`,
    )
  }

  const app = appDir(homeDir)
  const source = await sourceRepo(app, system)
  const next = `${app}.next`
  await mkdir(dirname(app), { recursive: true })
  await rm(next, { recursive: true, force: true })
  const step = async (line: string, command: string, args: string[], cwd: string) => {
    options.log(line)
    const { code, stdout, stderr } = await system.run(command, args, { cwd })
    if (code === 0) return stdout
    await rm(next, { recursive: true, force: true })
    const output = `${stdout}${stderr}`.trim().split('\n').slice(-20).join('\n')
    throw new Error(`${command} ${args.join(' ')} failed (${code}); the installed copy is unchanged.\n${output}`)
  }
  await step(`Copying ${options.ref} from ${source}…`, 'git', ['clone', '--quiet', '--branch', options.ref, source, next], dirname(app))
  const version = (await step('Reading the version…', 'git', ['log', '-1', '--format=%h %s'], next)).trim()
  await step('Installing dependencies…', 'pnpm', ['install', '--frozen-lockfile'], next)
  await step('Building the web app…', 'pnpm', ['build'], next)
  if (!options.skipTests) await step('Testing (a few minutes; --skip-tests skips this)…', 'pnpm', ['test'], next)
  await rm(`${app}.prev`, { recursive: true, force: true })
  if (await exists(app)) await rename(app, `${app}.prev`)
  await rename(next, app)

  const logs = launchAgentLogs(homeDir)
  const plist = launchAgentPath(homeDir)
  const shim = join(homeDir, '.local', 'bin', 'ostraka')
  await mkdir(logs, { recursive: true })
  await mkdir(dirname(plist), { recursive: true })
  await writeFile(plist, launchAgent(system.nodePath, app, logs))
  await mkdir(dirname(shim), { recursive: true })
  await writeFile(
    shim,
    `#!/bin/sh\n# Written by \`ostraka install\`.\nexec ${shellQuote(system.nodePath)} ${shellQuote(join(app, BIN))} "$@"\n`,
  )
  await chmod(shim, 0o755)
  const { skills, skippedSkills } = await linkSkills(homeDir, join(app, SKILLS))
  const oldDevlogCommand = join(homeDir, '.cursor', 'commands', 'devlog.md')
  const hasOldDevlogCommand = await exists(oldDevlogCommand)
  const claudeMd = await readFile(join(homeDir, '.claude', 'CLAUDE.md'), 'utf8').catch(() => '')
  const needsGlobalInstruction = !claudeMd.includes('ostraka people find')

  const domain = `gui/${system.uid}`
  // Not loaded yet is fine: bootout only clears a previous install so bootstrap picks up the new file.
  await system.launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`])
  const { code, stderr } = await system.launchctl(['bootstrap', domain, plist])
  if (code !== 0) throw new Error(`launchctl bootstrap ${domain} ${plist} failed (${code}): ${stderr.trim()}`)

  return {
    app,
    source,
    version: `${options.ref} at ${version}`,
    plist,
    shim,
    logs,
    skills,
    skippedSkills,
    ...(hasOldDevlogCommand && { oldDevlogCommand }),
    ...(needsGlobalInstruction && { globalInstruction: join(app, GLOBAL_INSTRUCTION) }),
  }
}

/**
 * The repo to copy from: the checkout this command runs from, or, when it runs from the installed copy (through the
 * shim), the checkout that copy was cloned from.
 */
async function sourceRepo(app: string, system: System): Promise<string> {
  const [repo, installed] = await Promise.all([realpath(REPO_DIR), realpath(app).catch(() => undefined)])
  if (repo !== installed) return REPO_DIR
  const { code, stdout } = await system.run('git', ['remote', 'get-url', 'origin'], { cwd: app })
  if (code !== 0 || !stdout.trim())
    throw new Error(`The installed copy at ${app} has no origin to update from: run \`pnpm ostraka install\` from your checkout.`)
  return stdout.trim()
}

/**
 * Links each skill folder of the installed copy into ~/.claude/skills, the user-level location Claude Code reads and
 * Cursor reads for compatibility, so the skills work from any project. A link from an earlier install is replaced;
 * anything else already there is left alone.
 */
async function linkSkills(homeDir: string, skillsDir: string): Promise<{ skills: string[]; skippedSkills: string[] }> {
  const userSkills = join(homeDir, '.claude', 'skills')
  await mkdir(userSkills, { recursive: true })
  const skills: string[] = []
  const skippedSkills: string[] = []
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const link = join(userSkills, entry.name)
    const existing = await lstat(link).catch(() => undefined)
    if (existing && !existing.isSymbolicLink()) {
      skippedSkills.push(link)
      continue
    }
    if (existing) await rm(link)
    await symlink(join(skillsDir, entry.name), link)
    skills.push(link)
  }
  return { skills, skippedSkills }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

const string = (value: string) => `<string>${xmlEscape(value)}</string>`

function launchAgent(nodePath: string, app: string, logs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${string(nodePath)}
    ${string(join(app, BIN))}
    ${string('serve')}
  </array>
  <key>WorkingDirectory</key>
  ${string(app)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${string(`${dirname(nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  ${string(join(logs, 'server.log'))}
  <key>StandardErrorPath</key>
  ${string(join(logs, 'server.log'))}
</dict>
</plist>
`
}

/** The node binary a written LaunchAgent runs, read back from it (`status` checks it still exists). */
export function launchAgentNode(plist: string): string | undefined {
  const node = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1]
  return node && node.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export const INSTALL_USAGE = `  ostraka install [--ref <branch>] [--skip-tests]
                                Install the app as its own copy of \`main\` (or <branch>), built and tested,
                                start it at login (LaunchAgent), put \`ostraka\` in ~/.local/bin and link its
                                skills into ~/.claude/skills
  ostraka update [--ref <branch>] [--skip-tests]
                                Replace the installed copy with the latest \`main\` (or <branch>) once it builds
                                and passes its tests, then restart the app
`

function installOptions(args: string[], io: Io): InstallOptions {
  const { values } = parseArgs({ args, options: { ref: { type: 'string' }, 'skip-tests': { type: 'boolean' } } })
  return { ref: values.ref ?? 'main', skipTests: values['skip-tests'] ?? false, log: (line) => io.stdout(`${line}\n`) }
}

/** `ostraka install`: installs, then says what was set up and what is left to the user. */
export async function installCommand(args: string[], io: Io): Promise<number> {
  const { app, version, plist, shim, logs, skills, skippedSkills, oldDevlogCommand, globalInstruction } = await install(
    io.homeDir ?? homedir(),
    io.system ?? realSystem(),
    installOptions(args, io),
  )
  io.stdout(`Installed:   ${app} (${version})\n`)
  io.stdout(`LaunchAgent: ${plist} (starts at login, restarts after a crash; logs in ${logs})\n`)
  io.stdout(`CLI shim:    ${shim}\n`)
  for (const skill of skills) io.stdout(`Skill:       ${skill} (a link to the installed copy)\n`)
  for (const skill of skippedSkills) {
    io.stdout(`Skill:       ${skill} is not a link from \`ostraka install\`, so it was left as is; move it away and run install again.\n`)
  }
  if (oldDevlogCommand) io.stdout(`${oldDevlogCommand} is the old Cursor /devlog command: the devlog skill replaces it, so delete it.\n`)
  if (globalInstruction) {
    io.stdout(
      `So agents check the People directory first, add ${globalInstruction} to ~/.claude/CLAUDE.md and paste it once into Cursor › Settings › Rules › User Rules.\n`,
    )
  }
  if (!(io.env.PATH ?? '').split(delimiter).includes(dirname(shim))) {
    io.stdout(`${dirname(shim)} is not on your PATH. Add it in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"\n`)
  }
  return 0
}

/** `ostraka update`: the same steps as install, for an app that is installed already. */
export async function updateCommand(args: string[], io: Io): Promise<number> {
  const homeDir = io.homeDir ?? homedir()
  if (!(await exists(launchAgentPath(homeDir))))
    throw new Error('Ostraka isn’t installed yet: run `pnpm ostraka install` from your checkout.')
  const { app, version } = await install(homeDir, io.system ?? realSystem(), installOptions(args, io))
  io.stdout(`Updated ${app} to ${version}, and restarted the app.\n`)
  return 0
}
