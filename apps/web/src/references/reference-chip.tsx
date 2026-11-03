// A Reference shown as a chip: icon, number, status dot. Hovering (or focusing and clicking) opens a card with its
// title, pipeline and approvals or Jira status, and Open. Status comes from what the top bar polled; anything else
// is fetched when the card opens. The same chip shows in lists and, as an atom, inside the chip editor.
import { parseReference, referenceUrl, splitReferences, type Reference } from '@ostraka/core/references'
import { ExternalLink, GitPullRequest, Ticket } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useReferenceDetails, useReferenceIndex, useReferenceSites, type PolledReference, type ReferenceDetails } from './api'
import { CATEGORY_DOT, pipelineDot, pipelineLabel, polledStatus, UNKNOWN_DOT } from './status'

/** What the chip knows of a Reference: polled, fetched, or nothing yet. */
type Known = { polled?: PolledReference; details?: ReferenceDetails }

function statusOf({ polled, details }: Known): { dot: string; label: string } {
  if (polled) return polledStatus(polled)
  if (details?.kind === 'mr') return { dot: pipelineDot(details.pipeline?.status), label: pipelineLabel(details.pipeline?.status) }
  if (details?.kind === 'jira') return { dot: CATEGORY_DOT[details.category], label: details.status }
  return { dot: UNKNOWN_DOT, label: 'Status not loaded' }
}

const kindLabel = (reference: Reference) => (reference.kind === 'mr' ? 'Merge request' : 'Jira issue')
const shortLabel = (reference: Reference) => (reference.kind === 'mr' ? `!${reference.iid}` : reference.key)

export function ReferenceIcon({ reference, className }: { reference: Reference; className?: string }) {
  const Icon = reference.kind === 'mr' ? GitPullRequest : Ticket
  return <Icon aria-hidden className={cn('size-3 shrink-0', className)} />
}

export function StatusDot({ className }: { className: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', className)} />
}

export type ReferenceChipProps = {
  token: string
  /** Inside the chip editor: out of the Tab order, since the caret moves past it instead. */
  inEditor?: boolean
}

export function ReferenceChip({ token, inEditor }: ReferenceChipProps) {
  const reference = parseReference(token)
  const { polled } = useReferenceIndex()
  const [open, setOpen] = useState(false)
  const known = polled.get(token)
  const details = useReferenceDetails(token, open && !known && reference !== undefined)
  if (!reference) return <span>{token}</span>
  const status = statusOf({ polled: known, details: details.data })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        nativeButton={false}
        tabIndex={inEditor ? -1 : 0}
        aria-label={`${kindLabel(reference)} ${token}, ${status.label}`}
        onClick={(event) => event.stopPropagation()}
        render={<span data-reference-chip={token} />}
        className={cn(
          'bg-muted text-foreground/80 ring-border hover:bg-accent focus-visible:ring-ring/50 mx-px inline-flex h-4.5 max-w-full cursor-default items-center gap-1 rounded-md px-1 align-[-0.2em] text-[11px] leading-none font-medium whitespace-nowrap ring-1 outline-none select-none focus-visible:ring-3',
          known?.kind === 'jira' && known.ticket.category === 'done' && 'opacity-60',
        )}
      >
        <ReferenceIcon reference={reference} className="text-muted-foreground" />
        <span className="tabular-nums">{shortLabel(reference)}</span>
        <StatusDot className={status.dot} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-1.5" onClick={(event) => event.stopPropagation()}>
        <ReferenceCard token={token} reference={reference} polled={known} details={details} />
      </PopoverContent>
    </Popover>
  )
}

type DetailsQuery = ReturnType<typeof useReferenceDetails>

function ReferenceCard({
  token,
  reference,
  polled,
  details,
}: {
  token: string
  reference: Reference
  polled?: PolledReference
  details: DetailsQuery
}) {
  const sites = useReferenceSites()
  const fetched = details.data
  const url =
    (polled?.kind === 'mr' ? polled.mr.url : polled?.kind === 'jira' ? polled.ticket.url : fetched?.url) ?? referenceUrl(reference, sites)
  const title = polled?.kind === 'mr' ? polled.mr.title : polled?.kind === 'jira' ? polled.ticket.summary : fetched?.title
  const status = statusOf({ polled, details: fetched })
  return (
    <>
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <ReferenceIcon reference={reference} />
        <span className="min-w-0 truncate">{token}</span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground focus-visible:ring-ring/50 ml-auto flex shrink-0 items-center gap-0.5 rounded outline-none focus-visible:ring-3"
          >
            Open <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </div>
      {title !== undefined ? (
        <p className="text-sm leading-snug font-medium wrap-anywhere">{title}</p>
      ) : details.error ? (
        <p className="text-destructive text-xs wrap-anywhere">{details.error.message}</p>
      ) : (
        <Skeleton aria-label={`Loading ${token}`} className="h-4 w-4/5" />
      )}
      {(polled || fetched) && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <StatusDot className={status.dot} />
          <span>{status.label}</span>
          <ReferenceFacts polled={polled} details={fetched} />
        </p>
      )}
    </>
  )
}

/** After the status: approvals, author, draft and state for an MR; the sprint for a ticket in it. */
function ReferenceFacts({ polled, details }: Known) {
  const facts: string[] = []
  const mr = polled?.kind === 'mr' ? polled.mr : details?.kind === 'mr' ? details : undefined
  if (mr) {
    facts.push(mr.approvals === 1 ? '1 approval' : `${mr.approvals} approvals`)
    if (mr.author) facts.push(`by ${mr.author}`)
    if (mr.draft) facts.push('Draft')
    if (details?.kind === 'mr' && details.state !== 'opened') facts.push(details.state[0]!.toUpperCase() + details.state.slice(1))
  }
  if (polled?.kind === 'jira' && polled.sprint) facts.push(polled.sprint)
  return facts.map((fact) => <span key={fact}>· {fact}</span>)
}

/** Plain text with each Reference shown as a chip, as in a collapsed row's title. */
export function ReferenceText({ text }: { text: string }) {
  return splitReferences(text).map((piece, index) =>
    piece.kind === 'text' ? piece.text : <ReferenceChip key={`${index}-${piece.token}`} token={piece.token} />,
  )
}
