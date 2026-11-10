// The Backup state over the server API, as a TanStack Query hook.
import type { BackupState } from '@ostraka/core/backup-types'
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/api'

/**
 * GET /api/backup (apps/server/src/backups.ts), read from the content repo with no network. Not content, so no live
 * update reaches it: Snapshots age and `ostraka backup` pushes from a terminal, so it is fetched again every minute.
 */
export function useBackupStatus() {
  return useQuery({ queryKey: ['backup'], queryFn: () => request<BackupState>('/backup'), refetchInterval: 60_000 })
}
