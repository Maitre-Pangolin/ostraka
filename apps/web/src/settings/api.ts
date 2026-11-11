// Settings over the server API, as a TanStack Query hook. Read-only: config.yml is edited by hand.
import type { Config } from '@ostraka/core/config-schema'
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/api'

/** GET /api/settings (apps/server/src/app.ts). Never carries a token, only whether each Keychain item was found. */
export type Settings = {
  configFile: string
  content: { path: string; source: 'env' | 'config' | 'default' }
  gitlab: NonNullable<Config['gitlab']>
  jira: NonNullable<Config['jira']>
  keychain: { name: 'gitlab' | 'jira'; item: string; found: boolean }[]
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => request<Settings>('/settings') })
}
