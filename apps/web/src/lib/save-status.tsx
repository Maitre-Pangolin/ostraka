// The quiet save status in the header of a file open in an editor (`useAutosave`): Editing, Saving…, Saved.
import { Check, Pencil } from 'lucide-react'
import type { SaveState } from './use-autosave'

export function SaveStatus({ state }: { state: SaveState }) {
  const label = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Editing'
  return (
    <span role="status" className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
      {state === 'saved' ? <Check aria-hidden className="size-3" /> : <Pencil aria-hidden className="size-3" />}
      <span className="hidden @md:inline">{label}</span>
      <span className="sr-only @md:hidden">{label}</span>
    </span>
  )
}
