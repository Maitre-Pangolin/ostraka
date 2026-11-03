// The mentioned-Person filter, shared by the Todo filters and the stacked Dev logs: a People chip opening a checklist
// of the People directory (by name, searchable past six), and the chosen Persons as removable chips. Matching is
// core's (`person` in `TodoFilter` and `DevlogFilter`): a Person is kept when the text mentions them.
import { foldText, mentionToken } from '@ostraka/core/mentions'
import { UserRound } from 'lucide-react'
import { ActiveChip, FilterPicker } from '@/todos/filters'
import { usePeopleIndex } from './api'

/** The People chip: chosen ids in, a toggled id out. Ignored Persons are left out unless chosen. */
export function PeoplePicker({ chosen, onToggle }: { chosen: string[]; onToggle: (id: string) => void }) {
  const { people, byId, isPerson } = usePeopleIndex()
  const nameOf = (id: string) => byId.get(id)?.name ?? mentionToken(id)
  const options = [
    ...people.filter((person) => !person.ignored || chosen.includes(person.id)).map((person) => person.id),
    ...chosen.filter((id) => !isPerson(id)),
  ].toSorted((a, b) => foldText(nameOf(a)).localeCompare(foldText(nameOf(b))))
  return (
    <FilterPicker
      label="People"
      icon={<UserRound className="size-3.5" />}
      options={options}
      chosen={chosen}
      onToggle={onToggle}
      render={(id) => (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{nameOf(id)}</span>
          <span className="text-muted-foreground truncate text-[11px]">{mentionToken(id)}</span>
        </span>
      )}
      name={(id) => `Mentions ${nameOf(id)}`}
      searchText={(id) => foldText(`${nameOf(id)} ${id} ${byId.get(id)?.aliases.join(' ') ?? ''}`)}
      empty="No People in the directory yet."
    />
  )
}

/** The chosen Persons as removable chips, labelled "All of" when there are several. */
export function PersonFilterChips({ chosen, onRemove }: { chosen: string[]; onRemove: (id: string) => void }) {
  const { byId } = usePeopleIndex()
  if (!chosen.length) return null
  return (
    <>
      {chosen.length > 1 && <span className="text-muted-foreground text-[11px] font-medium">All of</span>}
      {chosen.map((id) => {
        const name = byId.get(id)?.name ?? mentionToken(id)
        return (
          <ActiveChip key={id} label={`Mentions ${name}`} onRemove={() => onRemove(id)}>
            <UserRound aria-hidden className="text-muted-foreground size-3" />
            {name}
          </ActiveChip>
        )
      })}
    </>
  )
}
