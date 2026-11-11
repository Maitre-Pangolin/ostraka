import type { BackupState } from '@ostraka/core/backup-types'
import { describe, expect, it } from 'vitest'
import { backupWarnings } from '../src/backup/warnings.ts'

const NOW = new Date('2026-11-02T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
const OK: BackupState = { remote: true, backedUp: true, stale: false, largeFiles: [] }

describe('backupWarnings', () => {
  it('has nothing to say while backed up', () => {
    expect(backupWarnings(OK, NOW)).toEqual([])
  })

  it('stays quiet while Snapshots have waited less than 24 h', () => {
    expect(backupWarnings({ ...OK, backedUp: false, unbackedSince: hoursAgo(3) }, NOW)).toEqual([])
  })

  it('warns after 24 h of Snapshots not on the remote, saying to run ostraka backup', () => {
    const status: BackupState = { ...OK, backedUp: false, stale: true, unbackedSince: hoursAgo(30) }
    expect(backupWarnings(status, NOW)).toEqual([
      { title: 'Not backed up for 30 hours', detail: expect.stringMatching(/ostraka backup/), files: [] },
    ])
  })

  it('counts days past two', () => {
    const status: BackupState = { ...OK, backedUp: false, stale: true, unbackedSince: hoursAgo(80) }
    expect(backupWarnings(status, NOW).map(({ title }) => title)).toEqual(['Not backed up for 3 days'])
  })

  it('says nothing about waiting Snapshots when the content folder has no remote', () => {
    const status: BackupState = { remote: false, backedUp: false, stale: true, unbackedSince: hoursAgo(80), largeFiles: [] }
    expect(backupWarnings(status, NOW)).toEqual([])
  })

  it('warns about files over 10 MB, after the backup warning', () => {
    const status: BackupState = {
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

  it('warns about a file over 10 MB with no remote too', () => {
    const status: BackupState = { remote: false, backedUp: false, stale: false, largeFiles: [{ file: 'big.png', bytes: 11 * 1024 * 1024 }] }
    expect(backupWarnings(status, NOW).map(({ title }) => title)).toEqual(['File over 10 MB: big.png'])
  })
})
