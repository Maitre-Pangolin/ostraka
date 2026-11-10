// `ostraka serve`: the app and its API on 127.0.0.1, until stopped.
import { HOSTNAME, macKeychain, PORT, startServer } from '@ostraka/server'
import type { Io } from './main.ts'

export async function serveCommand(io: Io): Promise<number> {
  // macOS may prompt once per Keychain item here: they are created with `-T ""` so every read asks.
  const server = await startServer({ keychain: macKeychain(), warn: (message) => io.stderr(`${message}\n`) })
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  // Stopping commits pending content changes as a Snapshot, then exits 0, so launchd (which restarts the app only
  // after a crash) leaves it stopped after `ostraka stop`.
  const stop = () =>
    void server.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        io.stderr(`Stopping failed: ${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(1)
      },
    )
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}
