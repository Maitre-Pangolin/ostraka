import { Link } from '@tanstack/react-router'
import { BookText, CheckSquare, Lightbulb, Moon, Rows3, Rows4, Settings, Shapes, Sun, Tags, type LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppearance } from './appearance'

const SECTIONS = [
  { to: '/todos', icon: CheckSquare, label: 'Todos' },
  { to: '/notes', icon: Lightbulb, label: 'Notes' },
  { to: '/devlogs', icon: BookText, label: 'Dev logs' },
  { to: '/sketches', icon: Shapes, label: 'Sketches' },
] as const

const ITEM =
  'grid size-9 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:bg-background data-[status=active]:text-primary data-[status=active]:shadow-xs data-[status=active]:ring-1 data-[status=active]:ring-border'

function RailItem({ label, icon: Icon, render }: { label: string; icon: LucideIcon; render: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={render} aria-label={label} className={ITEM}>
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The left rail: sections on top; density, theme, Tags and Settings at the bottom. */
export function Rail() {
  const { theme, setTheme, density, setDensity } = useAppearance()
  return (
    <nav aria-label="Sections" className="bg-muted/40 flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
      <span
        aria-hidden
        className="bg-primary font-heading text-primary-foreground mb-2 grid size-7 place-items-center rounded-lg text-sm font-bold"
      >
        o
      </span>
      {SECTIONS.map(({ to, icon, label }) => (
        <RailItem key={to} label={label} icon={icon} render={<Link to={to} />} />
      ))}
      <span className="flex-1" />
      <RailItem
        label={density === 'compact' ? 'Compact (switch to comfy)' : 'Comfy (switch to compact)'}
        icon={density === 'compact' ? Rows4 : Rows3}
        render={<button type="button" onClick={() => setDensity(density === 'compact' ? 'comfy' : 'compact')} />}
      />
      <RailItem
        label={theme === 'dark' ? 'Dark (switch to light)' : 'Light (switch to dark)'}
        icon={theme === 'dark' ? Moon : Sun}
        render={<button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />}
      />
      <RailItem label="Tags" icon={Tags} render={<Link to="/tags" />} />
      <RailItem label="Settings" icon={Settings} render={<Link to="/settings" />} />
    </nav>
  )
}
