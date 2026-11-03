import { History, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import { useFileHistory, useFileVersion, useRestoreFile, type FileSnapshot } from './api'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** When a Snapshot was made, in the reader's time zone: "2 Nov 2026, 14:03". */
const snapshotDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** The History button that opens a file's history in a view's header: an icon below `@md`, its Tooltip the label. */
export function HistoryButton({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            aria-label="History"
            aria-pressed={open}
            onClick={onClick}
            className={cn('text-muted-foreground', open && 'text-primary', className)}
          />
        }
      >
        <History />
        <span className="hidden @md:inline">History</span>
      </TooltipTrigger>
      <TooltipContent>{open ? 'Close the history' : 'Snapshots of this file, and restoring one'}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A content file's history, for any view that shows one file (a Note, a Dev log, a Sketch, `todos.json`): its
 * Snapshots newest first, the chosen one's text, and Restore, which writes that text as the current file and
 * commits it as a new Snapshot. A restore shows an Undo toast (restoring the Snapshot just before it), then
 * `onRestored` lets the view show the file again.
 */
export function FileHistory({ path, onClose, onRestored }: { path: string; onClose: () => void; onRestored?: () => void }) {
  const history = useFileHistory(path)
  const [chosen, setChosen] = useState<FileSnapshot>()
  const { restore, undo } = useRestoreFile(path)
  const [unchanged, setUnchanged] = useState<string>()
  const slow = useAfter(300, history.isPending)

  const restoreChosen = (snapshot: FileSnapshot) =>
    restore.mutate(snapshot.commit, {
      onSuccess: ({ restored, before }) => {
        if (!restored) return setUnchanged(snapshot.commit)
        toast('File restored', {
          description: `${path} as of ${snapshotDate(snapshot.date)}`,
          duration: 5000,
          ...(before && { action: { label: 'Undo', onClick: () => undo(before) } }),
        })
        onRestored?.()
      },
    })

  return (
    <section aria-label={`History of ${path}`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <History aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
        <h2 className="shrink-0 text-sm font-medium">History</h2>
        <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">{path}</span>
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" aria-label="Close the history" onClick={onClose} className="text-muted-foreground">
          <X />
        </Button>
      </div>
      {history.error && <p className="text-destructive px-3 py-2 text-sm">{history.error.message}</p>}
      {history.data && !history.data.length && (
        <EmptyState>No Snapshots of this file yet. One is made a minute after a change settles.</EmptyState>
      )}
      {(slow || !!history.data?.length) && (
        <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
          <ol
            aria-label="Snapshots"
            className="max-h-48 shrink-0 overflow-y-auto border-b @3xl:max-h-none @3xl:w-64 @3xl:border-r @3xl:border-b-0"
          >
            {slow && <SkeletonRows />}
            {history.data?.map((snapshot) => (
              <li key={snapshot.commit}>
                <button
                  type="button"
                  onClick={() => (setChosen(snapshot), setUnchanged(undefined), restore.reset())}
                  aria-current={snapshot.commit === chosen?.commit || undefined}
                  className={cn(
                    'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 border-b px-3 py-1.5 text-left',
                    focusRing,
                    snapshot.commit === chosen?.commit && 'bg-accent',
                  )}
                >
                  <span className="text-sm">{snapshotDate(snapshot.date)}</span>
                  <span className="text-muted-foreground truncate text-[11px]">{snapshot.message}</span>
                </button>
              </li>
            ))}
          </ol>
          {chosen ? (
            <Version
              path={path}
              snapshot={chosen}
              restoring={restore.isPending}
              error={restore.error?.message}
              unchanged={unchanged === chosen.commit}
              onRestore={() => restoreChosen(chosen)}
            />
          ) : (
            history.data && <EmptyState>Pick a Snapshot to see the file as it was then.</EmptyState>
          )}
        </div>
      )}
    </section>
  )
}

/** One Snapshot's text, with Restore. */
function Version({
  path,
  snapshot,
  restoring,
  error,
  unchanged,
  onRestore,
}: {
  path: string
  snapshot: FileSnapshot
  restoring: boolean
  error: string | undefined
  unchanged: boolean
  onRestore: () => void
}) {
  const version = useFileVersion(path, snapshot.commit)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1">
        <span className="min-w-0 truncate text-xs">
          As of <span className="font-medium">{snapshotDate(snapshot.date)}</span>
        </span>
        <span className="flex-1" />
        <Button size="xs" variant="outline" onClick={onRestore} disabled={restoring || !version.data}>
          <RotateCcw /> {restoring ? 'Restoring…' : 'Restore this version'}
        </Button>
      </div>
      {error && <p className="text-destructive border-b px-3 py-1.5 text-xs">{error}</p>}
      {unchanged && <p className="text-muted-foreground border-b px-3 py-1.5 text-xs">The file is already this version.</p>}
      {version.error && <p className="text-destructive px-3 py-2 text-sm">{version.error.message}</p>}
      {version.data && (
        <pre className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
          {version.data.text}
        </pre>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <>
      {[50, 65, 40].map((width) => (
        <li key={width} aria-hidden className="flex flex-col gap-1.5 border-b px-3 py-2">
          <span className="bg-muted h-3 rounded" style={{ width: `${width}%` }} />
          <span className="bg-muted h-2 w-1/3 rounded" />
        </li>
      ))}
    </>
  )
}
