// What the top bar says about the Backup, from GET /api/backup. No imports from '@/': tests run it as is.
import type { BackupStatus } from '@ostraka/core/backup-types'

export type BackupWarning = {
  /** One line for the top bar. */
  title: string
  /** What happened and what to do, for the popover. */
  detail: string
  /** The files concerned, each with what is wrong with it. */
  files: string[]
}

const HOUR = 3_600_000

function waited(since: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(since).getTime()) / HOUR)
  return hours < 48 ? `${hours} hours` : `${Math.floor(hours / 24)} days`
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The warnings to show, most serious first; none while the content is backed up or has waited less than 24 h. */
export function backupWarnings(status: BackupStatus, now: Date): BackupWarning[] {
  const warnings: BackupWarning[] = []
  const { problem } = status
  if (problem?.status === 'secrets') {
    const [first] = problem.files
    warnings.push({
      title: `Backup blocked: secret in ${problem.files.length === 1 ? first!.file : `${problem.files.length} files`}`,
      detail:
        'Nothing was pushed. Take the secret out of every Snapshot not backed up yet (a removed secret stays in history), then run ostraka backup.',
      files: problem.files.map(({ file, kinds }) => `${file}: ${kinds.join(', ')}`),
    })
  }
  if (problem?.status === 'rejected') {
    warnings.push({ title: 'Backup stopped: push rejected', detail: problem.reason, files: [] })
  }
  if (status.stale && status.unbackedSince !== undefined && problem?.status !== 'rejected') {
    const detail = !status.remote
      ? 'The content folder has no remote: see Back it up in the README.'
      : problem?.status === 'failed'
        ? problem.reason
        : 'Snapshots are waiting for the next push. Run ostraka backup to push now.'
    warnings.push({ title: `Not backed up for ${waited(status.unbackedSince, now)}`, detail, files: [] })
  }
  if (status.largeFiles.length > 0) {
    warnings.push({
      title:
        status.largeFiles.length === 1 ? `File over 10 MB: ${status.largeFiles[0]!.file}` : `${status.largeFiles.length} files over 10 MB`,
      detail: 'The backup is plain git: keep each content file under 10 MB.',
      files: status.largeFiles.map(({ file, bytes }) => `${file}: ${megabytes(bytes)}`),
    })
  }
  return warnings
}
