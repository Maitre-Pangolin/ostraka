import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BackupWarning } from '@/backup/backup-warning'
import { Rail } from './rail'

/** Rail on the left; on the right the top bar over the current view. The content area is the container-query root. */
export function Shell() {
  return (
    <TooltipProvider>
      <div className="bg-background flex h-dvh overflow-hidden">
        <Rail />
        <div className="@container flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

/**
 * Work overview strip, shown on every view: GitLab and Jira counts on the left (still to come), source and Backup
 * warnings at the end.
 */
function TopBar() {
  return (
    <header aria-label="Work overview" className="bg-muted/40 flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-3" />
      <div className="flex min-w-0 shrink items-center justify-end gap-2">
        <BackupWarning />
      </div>
    </header>
  )
}

/** The empty state: one muted line naming the next action. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground mx-auto max-w-3xl p-3 text-sm">{children}</p>
}
