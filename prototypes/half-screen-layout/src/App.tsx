// PROTOTYPE (#10): ostraka shell inside a resizable frame. ?view= picks the section.
import { cn } from '@/lib/utils'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Shell, type View } from './prototype/shell'
import { StoreProvider } from './prototype/store'

const WIDTHS = { third: '33.333%', half: '50%', full: '100%' } as const
type Width = keyof typeof WIDTHS
type Density = 'comfy' | 'compact'
const VIEWS: View[] = ['todos', 'notes', 'devlogs', 'sketches', 'settings']

const params = () => new URLSearchParams(location.search)
const getParam = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  const v = params().get(k) as T
  return allowed.includes(v) ? v : fallback
}

export default function App() {
  const [view, setView] = useState<View>(() => getParam('view', VIEWS, 'todos'))
  const [width, setWidth] = useState<Width>(() => getParam('w', ['third', 'half', 'full'] as const, 'half'))
  const [dark, setDark] = useState(() => params().get('theme') === 'dark' || (!params().get('theme') && matchMedia('(prefers-color-scheme: dark)').matches))
  const [density, setDensity] = useState<Density>(() => getParam('density', ['comfy', 'compact'] as const, 'comfy'))

  useEffect(() => {
    const p = params()
    p.set('view', view)
    p.set('w', width)
    p.set('theme', dark ? 'dark' : 'light')
    p.set('density', density)
    history.replaceState(null, '', `?${p}`)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.setProperty('--spacing', density === 'compact' ? '0.21rem' : '0.25rem')
  }, [view, width, dark, density])

  return (
    <div className="flex h-dvh bg-[repeating-linear-gradient(45deg,var(--muted)_0_1px,transparent_1px_12px)]">
      {/* the app frame: variants respond to its width (container queries), not the window */}
      <main className="h-full overflow-hidden border-r bg-background shadow-xl" style={{ width: WIDTHS[width] }}>
        <StoreProvider>
          <Shell view={view} setView={setView} dark={dark} />
        </StoreProvider>
      </main>
      {width !== 'full' && <div className="hidden flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground md:flex">your editor / terminal lives here</div>}

      {/* prototype controls: not part of the design */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100 shadow-2xl ring-1 ring-white/10">
        <span className="px-2 text-zinc-400">prototype</span>
        {(['third', 'half', 'full'] as const).map((w) => (
          <button key={w} type="button" onClick={() => setWidth(w)} className={cn('rounded-full px-2 py-1 hover:bg-white/10', width === w && 'bg-white/20')}>
            {w === 'third' ? '⅓' : w === 'half' ? '½' : 'full'}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/20" />
        <button type="button" onClick={() => setDensity(density === 'comfy' ? 'compact' : 'comfy')} className="rounded-full px-2 py-1 hover:bg-white/10">
          {density}
        </button>
        <button type="button" onClick={() => setDark(!dark)} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="Theme">
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
