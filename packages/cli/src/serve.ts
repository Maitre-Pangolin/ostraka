// `ostraka serve`: the app and its API on 127.0.0.1, until stopped.
import { HOSTNAME, macKeychain, PORT, startServer } from '@ostraka/server'
import type { Io } from './main.ts'

export async function serveCommand(io: Io): Promise<number> {
  // macOS may prompt once per Keychain item here: they are created with `-T ""` so every read asks.
  const server = await startServer({ keychain: macKeychain(), warn: (message) => io.stderr(`${message}\n`) })
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  // Stopping commits pending content changes as a Snapshot before the process exits.
  const stop = () => void server.stop()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}
