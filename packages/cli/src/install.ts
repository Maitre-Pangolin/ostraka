import { execFile } from 'node:child_process'
import { access, chmod, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What `install` needs from the machine, injected so tests never touch launchd. */
export type System = {
  platform: NodeJS.Platform
  /** Absolute path to the node binary the LaunchAgent and the shim run. */
  nodePath: string
  uid: number
  launchctl: (args: string[]) => Promise<{ code: number; stderr: string }>
}

export const realSystem = (): System => ({
  platform: process.platform,
  nodePath: process.execPath,
  uid: process.getuid?.() ?? 0,
  launchctl: (args) =>
    new Promise((resolve) => {
      execFile('/bin/launchctl', args, { encoding: 'utf8' }, (error, _stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stderr })
      })
    }),
})

export const LAUNCH_AGENT_LABEL = 'com.ostraka.server'

const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '')
const BIN = join(REPO_DIR, 'packages', 'cli', 'bin', 'ostraka.ts')
/** The repo's agent skills, the single source of the ones linked into ~/.claude/skills. */
const SKILLS_DIR = join(REPO_DIR, '.claude', 'skills')
/** The People instruction for ~/.claude/CLAUDE.md and Cursor's User Rules, which the user adds themselves. */
const GLOBAL_INSTRUCTION = join(SKILLS_DIR, 'people', 'global-instruction.md')

export type InstallResult = {
  plist: string
  shim: string
  logs: string
  /** `~/.claude/skills/<name>`, each a link to the repo's skill folder. */
  skills: string[]
  /** Skill paths already taken by something `install` didn't link there, left as they are. */
  skippedSkills: string[]
  /** The old Cursor `/devlog` command, when it is still there: the devlog skill replaces it. */
  oldDevlogCommand?: string
  /** The global People instruction, when ~/.claude/CLAUDE.md doesn't run `ostraka people find` yet. */
  globalInstruction?: string
}

/**
 * Writes the LaunchAgent (`ostraka serve` at login, restarted after a crash, logs in ~/Library/Logs/ostraka)
 * and the shim at ~/.local/bin/ostraka, then (re)loads the agent in the user's GUI session, where the
 * Keychain prompts can show. The environment is not copied into either file, so no secret lands on disk.
 */
export async function install(homeDir: string, system: System): Promise<InstallResult> {
  if (system.platform !== 'darwin') throw new Error('ostraka install sets up a LaunchAgent, so it only runs on macOS.')

  const logs = join(homeDir, 'Library', 'Logs', 'ostraka')
  const plist = join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
  const shim = join(homeDir, '.local', 'bin', 'ostraka')

  await mkdir(logs, { recursive: true })
  await mkdir(dirname(plist), { recursive: true })
  await writeFile(plist, launchAgent(system.nodePath, logs))
  await mkdir(dirname(shim), { recursive: true })
  await writeFile(shim, `#!/bin/sh\n# Written by \`ostraka install\`.\nexec ${shellQuote(system.nodePath)} ${shellQuote(BIN)} "$@"\n`)
  await chmod(shim, 0o755)
  const { skills, skippedSkills } = await linkSkills(homeDir)
  const oldDevlogCommand = join(homeDir, '.cursor', 'commands', 'devlog.md')
  const hasOldDevlogCommand = await access(oldDevlogCommand).then(
    () => true,
    () => false,
  )
  const claudeMd = await readFile(join(homeDir, '.claude', 'CLAUDE.md'), 'utf8').catch(() => '')
  const needsGlobalInstruction = !claudeMd.includes('ostraka people find')

  const domain = `gui/${system.uid}`
  // Not loaded yet is fine: bootout only clears a previous install so bootstrap picks up the new file.
  await system.launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`])
  const { code, stderr } = await system.launchctl(['bootstrap', domain, plist])
  if (code !== 0) throw new Error(`launchctl bootstrap ${domain} ${plist} failed (${code}): ${stderr.trim()}`)

  return {
    plist,
    shim,
    logs,
    skills,
    skippedSkills,
    ...(hasOldDevlogCommand && { oldDevlogCommand }),
    ...(needsGlobalInstruction && { globalInstruction: GLOBAL_INSTRUCTION }),
  }
}

/**
 * Links each skill folder of the repo into ~/.claude/skills, the user-level location Claude Code reads and Cursor
 * reads for compatibility, so the skills work from any project and edits in the repo apply at once. A link from an
 * earlier install is replaced; anything else already there is left alone.
 */
async function linkSkills(homeDir: string): Promise<{ skills: string[]; skippedSkills: string[] }> {
  const userSkills = join(homeDir, '.claude', 'skills')
  await mkdir(userSkills, { recursive: true })
  const skills: string[] = []
  const skippedSkills: string[] = []
  for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const link = join(userSkills, entry.name)
    const existing = await lstat(link).catch(() => undefined)
    if (existing && !existing.isSymbolicLink()) {
      skippedSkills.push(link)
      continue
    }
    if (existing) await rm(link)
    await symlink(join(SKILLS_DIR, entry.name), link)
    skills.push(link)
  }
  return { skills, skippedSkills }
}

const string = (value: string) => `<string>${xmlEscape(value)}</string>`

function launchAgent(nodePath: string, logs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${string(nodePath)}
    ${string(BIN)}
    ${string('serve')}
  </array>
  <key>WorkingDirectory</key>
  ${string(REPO_DIR)}
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

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
