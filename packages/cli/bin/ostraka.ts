#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { run } from '../src/main.ts'

// No Keychain here: only the app server (`ostraka serve`) reads credentials.
process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  async readLine(prompt) {
    const lines = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return await lines.question(prompt)
    } finally {
      lines.close()
    }
  },
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
})
