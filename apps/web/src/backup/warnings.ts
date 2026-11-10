// What the top bar says about the Backup, from GET /api/backup. No imports from '@/': tests run it as is.
import type { BackupState } from '@ostraka/core/backup-types'

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

/**
 * The warnings to show, most serious first, all known locally with no network: Snapshots not on the remote's branch
 * for over 24 h (only when the content folder has a remote), and files over 10 MB.
 */
export function backupWarnings(status: BackupState, now: Date): BackupWarning[] {
  const warnings: BackupWarning[] = []
  if (status.remote && status.stale && status.unbackedSince !== undefined) {
    warnings.push({
      title: `Not backed up for ${waited(status.unbackedSince, now)}`,
      detail:
        'Snapshots older than 24 hours are not on the remote yet, as of the last push. The app never pushes: run ostraka backup in a terminal.',
      files: [],
    })
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
