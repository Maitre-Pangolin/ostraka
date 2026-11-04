// A Mention shown as the Person's current display name. Hovering (or focusing and clicking) opens their contact
// card: a Slack DM first, then email, GitLab and Jira profile links, each value with a copy button. A Mention of an id
// not in the People directory stays plain text, with an offer to add that Person. The same chip shows in lists and,
// as an atom, inside the chip editor.
import { mentionToken, personLinks, type MentionSuggestion, type PersonLinks } from '@ostraka/core/mentions'
import { Check, Copy, GitBranch, Mail, MessageCircle, SquareKanban, UserPlus, UserRound } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { buttonVariants, Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useReferenceSites } from '@/references/api'
import { useAddPerson, usePeopleIndex, type Person } from './api'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export type MentionChipProps = {
  /** The Person's id, as written after `@`. */
  id: string
  /** Inside the chip editor: out of the Tab order, since the caret moves past it instead. */
  inEditor?: boolean
}

/** A Mention: the Person's name with their contact card, or, for an unknown id, plain text with an "add" offer. */
export function MentionChip({ id, inEditor }: MentionChipProps) {
  const { byId, loaded } = usePeopleIndex()
  const person = byId.get(id)
  if (person) return <KnownMention person={person} inEditor={inEditor} />
  if (!loaded || inEditor) return <span>{mentionToken(id)}</span>
  return <UnknownMention id={id} />
}

function KnownMention({ person, inEditor }: { person: Person; inEditor?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        nativeButton={false}
        tabIndex={inEditor ? -1 : 0}
        aria-label={`Mention of ${person.name}`}
        onClick={stop}
        render={<span data-mention-chip={person.id} />}
        className={cn(
          'text-primary hover:bg-primary/10 mx-px inline rounded px-0.5 font-medium whitespace-nowrap select-none',
          'cursor-default',
          focusRing,
        )}
      >
        {person.name}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2" onClick={stop}>
        <ContactCard person={person} />
      </PopoverContent>
    </Popover>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** How to reach a Person: Slack DM first, then email, GitLab and Jira, each value copyable. */
export function ContactCard({ person }: { person: Person }) {
  const links: PersonLinks = personLinks(person, useReferenceSites())
  const slack = person.slackHandle ? `@${person.slackHandle}` : person.slackId
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="bg-primary/15 text-primary grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
          {initials(person.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{person.name}</p>
          <p className="text-muted-foreground truncate text-[11px]">{mentionToken(person.id)}</p>
        </div>
      </div>
      {(links.slack || links.email) && (
        <div className="flex gap-1.5">
          {links.slack && (
            <a href={links.slack} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: 'sm' }), 'flex-1')}>
              <MessageCircle /> Slack DM
            </a>
          )}
          {links.email && (
            <a
              href={links.email}
              className={cn(buttonVariants({ size: 'sm', variant: links.slack ? 'outline' : 'default' }), !links.slack && 'flex-1')}
            >
              <Mail /> Email
            </a>
          )}
        </div>
      )}
      <dl className="flex flex-col gap-0.5">
        <ContactRow icon={<MessageCircle />} label="Slack" value={slack} href={links.slack} />
        <ContactRow icon={<Mail />} label="Email" value={person.email} href={links.email} />
        <ContactRow icon={<GitBranch />} label="GitLab" value={person.gitlabUsername} href={links.gitlab} />
        <ContactRow icon={<SquareKanban />} label="Jira" value={person.jiraAccountId} href={links.jira} />
      </dl>
    </>
  )
}

function ContactRow({ icon, label, value, href }: { icon: ReactNode; label: string; value?: string; href?: string }) {
  if (!value) return null
  return (
    <div className="flex h-6 min-w-0 items-center gap-2 text-xs">
      <dt className="text-muted-foreground flex w-16 shrink-0 items-center gap-1.5 [&_svg]:size-3">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={cn('hover:text-primary rounded underline-offset-2 hover:underline', focusRing)}
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
      <CopyButton value={value} label={label} />
    </div>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={cn('text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5', focusRing)}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

/** `quentin-dupre` → `Quentin Dupre`: the name guessed for a Person added from a Mention. */
const nameFromId = (id: string) =>
  id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/** A Mention of an id not in the People directory: plain text, then an offer to add that Person. */
function UnknownMention({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="whitespace-nowrap">
      {mentionToken(id)}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Add Person ${id}`}
          title={`${mentionToken(id)} isn’t in the People directory: add`}
          onClick={stop}
          className={cn('text-muted-foreground hover:text-foreground ml-0.5 inline-flex rounded align-[-0.1em]', focusRing)}
        >
          <UserPlus className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-2" onClick={stop}>
          <AddPersonForm id={id} onAdded={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </span>
  )
}

function AddPersonForm({ id, onAdded }: { id: string; onAdded: () => void }) {
  const [name, setName] = useState(() => nameFromId(id))
  const [email, setEmail] = useState('')
  const add = useAddPerson()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate({ id, name: name.trim(), ...(email.trim() && { email: email.trim() }) }, { onSuccess: onAdded })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-medium">{mentionToken(id)}</span>
        <span className="text-muted-foreground"> isn’t in the People directory.</span>
      </p>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Name</span>
        <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className="h-7" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Company email (optional)</span>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-7" />
      </label>
      {add.error && <p className="text-destructive text-xs wrap-anywhere">{add.error.message}</p>}
      <Button type="submit" size="sm" disabled={add.isPending || !name.trim()} className="self-end">
        <UserPlus /> Add Person
      </Button>
    </form>
  )
}

/** A Person offered while a Mention is typed: their name, then the id it writes. */
export function MentionSuggestionLabel({ suggestion }: { suggestion: MentionSuggestion }) {
  return (
    <>
      <UserRound aria-hidden className="text-muted-foreground size-3 shrink-0" />
      <span className="min-w-0 truncate">{suggestion.name}</span>
      <span className="text-muted-foreground min-w-0 truncate text-[11px]">{suggestion.token}</span>
    </>
  )
}

/** The contact card of a Mention highlighted in an editor, anchored to it while hovered. */
export function MentionHoverCard({
  id,
  anchor,
  onOpenChange,
  onHover,
}: {
  id: string
  anchor: Element
  onOpenChange: (open: boolean) => void
  /** The pointer entered (`true`) or left the card. */
  onHover: (inside: boolean) => void
}) {
  const person = usePeopleIndex().byId.get(id)
  if (!person) return null
  return (
    <Popover open onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        align="start"
        className="w-72 gap-2"
        initialFocus={false}
        finalFocus={false}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <ContactCard person={person} />
      </PopoverContent>
    </Popover>
  )
}
