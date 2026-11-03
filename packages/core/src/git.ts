// The `git` binary on the content folder, with nothing inherited that would point it at another repo.
import { spawn } from 'node:child_process'

// Variables that would point git at another repo than the content folder (set when called from a git hook, say).
const REPO_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX']

export type GitResult = { code: number; stdout: string; stderr: string }

export type GitRunOptions = {
  /** Added to the environment (after the repo location variables are removed). */
  env?: Record<string, string>
  /** Kills git after this long (network commands); the result then has a non-zero code. */
  timeoutMs?: number
}

/** Runs git in `root` and reports how it went; never throws for a non-zero exit. */
export function runGit(root: string, args: string[], { env: extra = {}, timeoutMs }: GitRunOptions = {}): Promise<GitResult> {
  const env: Record<string, string | undefined> = { ...process.env, ...extra }
  for (const name of REPO_LOCATION_VARS) delete env[name]
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', root, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }))
    child.on('close', (code, signal) =>
      resolve({ code: code ?? 1, stdout, stderr: signal ? `${stderr}git was stopped (${signal}), timed out?` : stderr }),
    )
  })
}

/** Runs git in `root` and returns its trimmed output; throws with git's message on a non-zero exit. */
export async function git(root: string, args: string[], options?: GitRunOptions): Promise<string> {
  const result = await runGit(root, args, options)
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
  return result.stdout.trim()
}
