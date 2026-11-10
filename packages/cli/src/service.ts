// `ostraka start | stop | restart | status`: the LaunchAgent `install` wrote, through launchctl, so the app runs
// in the background rather than in a terminal.
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HOSTNAME, PORT } from '@ostraka/server'
import { LAUNCH_AGENT_LABEL, launchAgentLogs, launchAgentPath, realSystem, type System } from './install.ts'
import type { Io } from './main.ts'

export const SERVICE_USAGE = `  ostraka start | stop | restart
                                Start the app in the background, stop it cleanly (pending changes become a
                                Snapshot first) or restart it after an update; needs \`ostraka install\`
  ostraka status                Whether the app is running, and its pid
`

const URL = `http://${HOSTNAME}:${PORT}`
// How long `stop` waits for the app to commit its pending changes and exit.
const STOP_WAIT_MS = 15_000
const POLL_MS = 200

/** What launchd says about the LaunchAgent: not loaded (never installed, or turned off), stopped, or running. */
type State = { loaded: false } | { loaded: true; pid?: number }

type Service = { system: System; plist: string; logs: string; domain: string; target: string }

export async function serviceCommand(action: 'start' | 'stop' | 'restart' | 'status', io: Io): Promise<number> {
  const system = io.system ?? realSystem()
  if (system.platform !== 'darwin') throw new Error(`ostraka ${action} drives the LaunchAgent, so it only runs on macOS.`)
  const homeDir = io.homeDir ?? homedir()
  const domain = `gui/${system.uid}`
  const service: Service = {
    system,
    plist: launchAgentPath(homeDir),
    logs: launchAgentLogs(homeDir),
    domain,
    target: `${domain}/${LAUNCH_AGENT_LABEL}`,
  }
  const isInstalled = await access(service.plist).then(
    () => true,
    () => false,
  )
  if (action === 'status') return status(service, isInstalled, io)
  if (!isInstalled) throw new Error(`Ostraka isn't installed as a background app yet: run \`ostraka install\` first.`)
  if (action === 'start') return start(service, io)
  if (action === 'stop') return stop(service, io)
  return restart(service, io)
}

async function state({ system, target }: Service): Promise<State> {
  const { code, stdout = '' } = await system.launchctl(['print', target])
  if (code !== 0) return { loaded: false }
  const pid = /^\s*pid = (\d+)\s*$/m.exec(stdout)?.[1]
  return pid ? { loaded: true, pid: Number(pid) } : { loaded: true }
}

async function launchctl({ system }: Service, args: string[]) {
  const { code, stderr } = await system.launchctl(args)
  if (code !== 0) throw new Error(`launchctl ${args.join(' ')} failed (${code}): ${stderr.trim()}`)
}

async function start(service: Service, io: Io): Promise<number> {
  const now = await state(service)
  if (now.loaded && now.pid) {
    io.stdout(`Ostraka is already running (pid ${now.pid}) on ${URL}\n`)
    return 0
  }
  // A loaded LaunchAgent is kickstarted; one turned off (or never loaded) is loaded, which starts it (RunAtLoad).
  if (now.loaded) await launchctl(service, ['kickstart', service.target])
  else await launchctl(service, ['bootstrap', service.domain, service.plist])
  io.stdout(`Ostraka is starting on ${URL} (logs in ${join(service.logs, 'server.log')})\n`)
  return 0
}

async function stop(service: Service, io: Io): Promise<number> {
  const now = await state(service)
  if (!now.loaded || !now.pid) {
    io.stdout(`Ostraka isn't running.\n`)
    return 0
  }
  // SIGTERM lets the server commit pending changes as a Snapshot and exit 0, so launchd leaves it stopped
  // (it restarts only after a crash) until the next login or `ostraka start`.
  await launchctl(service, ['kill', 'SIGTERM', service.target])
  for (let waited = 0; waited < STOP_WAIT_MS; waited += POLL_MS) {
    const after = await state(service)
    if (!after.loaded || !after.pid) {
      io.stdout(`Stopped. It starts again at login, or with \`ostraka start\`.\n`)
      return 0
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  io.stderr(`Ostraka (pid ${now.pid}) is still stopping after ${STOP_WAIT_MS / 1000} s; see ${join(service.logs, 'server.log')}.\n`)
  return 1
}

async function restart(service: Service, io: Io): Promise<number> {
  const now = await state(service)
  // kickstart -k stops the running app the way launchd stops a job, SIGTERM first, so it snapshots too.
  if (now.loaded) await launchctl(service, ['kickstart', '-k', service.target])
  else await launchctl(service, ['bootstrap', service.domain, service.plist])
  io.stdout(`Ostraka is restarting on ${URL} (logs in ${join(service.logs, 'server.log')})\n`)
  return 0
}

async function status(service: Service, isInstalled: boolean, io: Io): Promise<number> {
  const now: State = isInstalled ? await state(service) : { loaded: false }
  if (now.loaded && now.pid) {
    io.stdout(`Running in the background (pid ${now.pid}) on ${URL}\n`)
    return 0
  }
  if (await answers(io)) {
    io.stdout(`An app answers on ${URL}, but not the background one: probably \`ostraka serve\` in a terminal.\n`)
    return 0
  }
  if (!isInstalled) io.stdout(`Not running, and not installed as a background app: run \`ostraka install\`.\n`)
  else if (now.loaded) io.stdout(`Stopped. It starts at login, or now with \`ostraka start\`.\n`)
  else io.stdout(`Turned off (the LaunchAgent isn't loaded). \`ostraka start\` loads and starts it.\n`)
  return 1
}

/** Whether something answers `GET /api/health` on the app's address. */
async function answers(io: Io): Promise<boolean> {
  const fetch = io.fetch ?? globalThis.fetch
  try {
    const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}
