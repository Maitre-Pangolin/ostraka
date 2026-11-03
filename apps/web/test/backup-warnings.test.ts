import type { BackupStatus } from '@ostraka/core/backup-types'
import { describe, expect, it } from 'vitest'
import { backupWarnings } from '../src/backup/warnings.ts'

const NOW = new Date('2026-11-02T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
const OK: BackupStatus = { remote: true, backedUp: true, stale: false, largeFiles: [], stopped: false }

describe('backupWarnings', () => {
  it('has nothing to say while backed up', () => {
    expect(backupWarnings(OK, NOW)).toEqual([])
  })

  it('stays quiet while Snapshots have waited less than 24 h, even after a failed push', () => {
    const status: BackupStatus = {
      ...OK,
      backedUp: false,
      unbackedSince: hoursAgo(3),
      problem: { status: 'failed', reason: 'Could not resolve host' },
    }
    expect(backupWarnings(status, NOW)).toEqual([])
  })

  it('warns after 24 h without a backup, with the last failure', () => {
    const status: BackupStatus = {
      ...OK,
      backedUp: false,
      stale: true,
      unbackedSince: hoursAgo(30),
      problem: { status: 'failed', reason: 'Authentication failed' },
    }
    expect(backupWarnings(status, NOW)).toEqual([{ title: 'Not backed up for 30 hours', detail: 'Authentication failed', files: [] }])
  })

  it('counts days past two, and points at the README when there is no remote', () => {
    const status: BackupStatus = { ...OK, remote: false, backedUp: false, stale: true, unbackedSince: hoursAgo(80) }
    expect(backupWarnings(status, NOW)).toEqual([
      { title: 'Not backed up for 3 days', detail: expect.stringMatching(/no remote.*README/), files: [] },
    ])
  })

  it('shows the files a secret blocked, at once', () => {
    const status: BackupStatus = {
      ...OK,
      backedUp: false,
      unbackedSince: hoursAgo(1),
      problem: { status: 'secrets', files: [{ file: 'notes/setup.md', kinds: ['GitLab token'] }] },
    }
    expect(backupWarnings(status, NOW)).toEqual([
      {
        title: 'Backup blocked: secret in notes/setup.md',
        detail: expect.stringMatching(/Nothing was pushed/),
        files: ['notes/setup.md: GitLab token'],
      },
    ])
  })

  it('shows why pushing stopped, at once', () => {
    const status: BackupStatus = {
      ...OK,
      backedUp: false,
      stopped: true,
      unbackedSince: hoursAgo(1),
      problem: { status: 'rejected', reason: 'Push rejected (fetch first).' },
    }
    expect(backupWarnings(status, NOW)).toEqual([
      { title: 'Backup stopped: push rejected', detail: 'Push rejected (fetch first).', files: [] },
    ])
  })

  it('warns about files over 10 MB, most serious warning first', () => {
    const status: BackupStatus = {
      ...OK,
      backedUp: false,
      stale: true,
      unbackedSince: hoursAgo(25),
      largeFiles: [
        { file: 'sketches/big.png', bytes: 12 * 1024 * 1024 },
        { file: 'notes/video.mov', bytes: 50 * 1024 * 1024 },
      ],
    }
    expect(backupWarnings(status, NOW).map(({ title }) => title)).toEqual(['Not backed up for 25 hours', '2 files over 10 MB'])
    expect(backupWarnings(status, NOW)[1]!.files).toEqual(['sketches/big.png: 12.0 MB', 'notes/video.mov: 50.0 MB'])
  })
})
