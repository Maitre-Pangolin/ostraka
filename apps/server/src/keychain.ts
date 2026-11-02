import { execFile } from 'node:child_process'

/** The Keychain items the server reads at startup, by service name. Created with `-T ""` (see README). */
export const KEYCHAIN_ITEMS = {
  gitlab: 'ostraka-gitlab',
  jira: 'ostraka-jira',
  push: 'ostraka-push',
} as const

export type CredentialName = keyof typeof KEYCHAIN_ITEMS

/** Reads one generic password by service name; undefined when there is no such item. */
export type Keychain = {
  read(service: string): Promise<string | undefined>
}

/**
 * A token held in memory. It never serialises: JSON, string templates and `util.inspect` all print
 * `[redacted]`, so a route or a log line that picks one up by mistake leaks nothing.
 */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** The token itself, for an outgoing request header only. */
  reveal(): string {
    return this.#value
  }

  toJSON() {
    return '[redacted]'
  }

  toString() {
    return '[redacted]'
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return 'Secret([redacted])'
  }
}

export type Credentials = Readonly<Partial<Record<CredentialName, Secret>>>

/** Reads every item once, one after the other (each read may prompt). A missing or unreadable item is left out. */
export async function readCredentials(keychain: Keychain, warn: (message: string) => void = () => {}): Promise<Credentials> {
  const credentials: Partial<Record<CredentialName, Secret>> = {}
  for (const [name, service] of Object.entries(KEYCHAIN_ITEMS) as [CredentialName, string][]) {
    try {
      const value = await keychain.read(service)
      if (value) credentials[name] = new Secret(value)
    } catch (error) {
      warn(`Could not read Keychain item ${service}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return Object.freeze(credentials)
}

export type RunSecurity = (args: string[]) => Promise<{ code: number; stdout: string }>

// `security` exits with 44 (errSecItemNotFound) when there is no such item.
const ITEM_NOT_FOUND = 44

const runSecurity: RunSecurity = (args) =>
  new Promise((resolve) => {
    execFile('/usr/bin/security', args, { encoding: 'utf8' }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout })
    })
  })

/**
 * The login Keychain through `security find-generic-password -w`. Items created with `-T ""` make macOS
 * prompt on every read, so this runs once per server start. Error messages never include the output.
 */
export function macKeychain(run: RunSecurity = runSecurity): Keychain {
  return {
    async read(service) {
      const { code, stdout } = await run(['find-generic-password', '-s', service, '-w'])
      if (code === ITEM_NOT_FOUND) return undefined
      if (code !== 0) throw new Error(`security exited with ${code} (access denied or Keychain locked?)`)
      return stdout.replace(/\n$/, '')
    },
  }
}
