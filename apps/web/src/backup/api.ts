// The Backup status over the server API, as a TanStack Query hook.
import type { BackupStatus } from '@ostraka/core/backup-types'
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/api'

/**
 * GET /api/backup (apps/server/src/app.ts). Not content, so no live update reaches it: pushes happen on the
 * server's own schedule, and the status is fetched again every minute.
 */
export function useBackupStatus() {
  return useQuery({ queryKey: ['backup'], queryFn: () => request<BackupStatus>('/backup'), refetchInterval: 60_000 })
}
