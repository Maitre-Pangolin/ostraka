import { Outlet } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BackupWarning } from '@/backup/backup-warning'
import { SearchDialog } from '@/search/search-dialog'
import { SourceChips, WorkCounts, WorkDetails } from '@/work/work-overview'
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
      <SearchDialog />
    </TooltipProvider>
  )
}

/**
 * The top bar, on every view: the work overview's counts, which expand in place, then one item per thing that needs
 * attention (a failing source's chip, a backup warning). Add an item as another child of the row.
 */
function TopBar() {
  const [expanded, setExpanded] = useState(false)
  return (
    <header aria-label="Work overview" className="bg-muted/40 shrink-0 border-b">
      <div className="flex h-9 min-w-0 items-center gap-3 px-3 text-xs">
        <WorkCounts expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        <SourceChips />
        <BackupWarning />
      </div>
      {expanded && <WorkDetails />}
    </header>
  )
}

/** The empty state: one muted line naming the next action. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground mx-auto max-w-3xl p-3 text-sm">{children}</p>
}
