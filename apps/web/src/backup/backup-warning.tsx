import { TriangleAlert } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useState } from 'react'
import { useBackupStatus } from './api'
import { backupWarnings, type BackupWarning as BackupWarningItem } from './warnings'

/**
 * The Backup warning in the top bar, after the work overview: nothing while all is well, otherwise one chip naming the most
 * serious problem, opening a popover with all of them. Below @md the chip is its icon, with the title as Tooltip.
 */
export function BackupWarning() {
  const { data, error, dataUpdatedAt } = useBackupStatus()
  if (error) {
    return (
      <p role="alert" className="text-destructive min-w-0 truncate" title={error.message}>
        Backup status unavailable: {error.message}
      </p>
    )
  }
  // Times are measured from when the status was fetched (each minute), which keeps the render pure.
  const warnings = data ? backupWarnings(data, new Date(dataUpdatedAt)) : []
  return warnings.length > 0 && <WarningChip warnings={warnings} />
}

function WarningChip({ warnings }: { warnings: BackupWarningItem[] }) {
  const [open, setOpen] = useState(false)
  const [first] = warnings
  const label = warnings.length > 1 ? `${first!.title} (+${warnings.length - 1})` : first!.title

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The Tooltip carries the label below @md, where only the icon shows (and the full one when truncated). */}
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={<PopoverTrigger />}
          aria-label={label}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:ring-ring/50 flex h-5.5 min-w-0 items-center gap-1 rounded-full border px-2 outline-none focus-visible:ring-3"
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="hidden truncate @md:inline">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80">
        {warnings.map((warning) => (
          <section key={warning.title} className="flex flex-col gap-1">
            <h2 className="text-destructive font-medium">{warning.title}</h2>
            <p className="text-muted-foreground wrap-anywhere whitespace-pre-wrap">{warning.detail}</p>
            {warning.files.length > 0 && (
              <ul className="font-mono text-xs">
                {warning.files.map((file) => (
                  <li key={file} className="wrap-anywhere">
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </PopoverContent>
    </Popover>
  )
}
