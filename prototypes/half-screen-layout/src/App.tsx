// PROTOTYPE (#10): three half-screen layouts, switchable via ?variant=, inside a resizable frame.
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { StoreProvider } from './prototype/parts'
import { VARIANTS } from './prototype/variants'

const WIDTHS = { third: '33.333%', half: '50%', full: '100%' } as const
type Width = keyof typeof WIDTHS
type Density = 'comfy' | 'compact'

const params = () => new URLSearchParams(location.search)
const getParam = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  const v = params().get(k) as T
  return allowed.includes(v) ? v : fallback
}

export default function App() {
  const [variant, setVariant] = useState(() => getParam('variant', VARIANTS.map((v) => v.key), 'A'))
  const [width, setWidth] = useState<Width>(() => getParam('w', ['third', 'half', 'full'] as const, 'half'))
  const [dark, setDark] = useState(() => params().get('theme') === 'dark' || (!params().get('theme') && matchMedia('(prefers-color-scheme: dark)').matches))
  const [density, setDensity] = useState<Density>(() => getParam('density', ['comfy', 'compact'] as const, 'comfy'))

  useEffect(() => {
    const p = params()
    p.set('variant', variant)
    p.set('w', width)
    p.set('theme', dark ? 'dark' : 'light')
    p.set('density', density)
    history.replaceState(null, '', `?${p}`)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.setProperty('--spacing', density === 'compact' ? '0.21rem' : '0.25rem')
  }, [variant, width, dark, density])

  const idx = VARIANTS.findIndex((v) => v.key === variant)
  const cycle = (d: number) => setVariant(VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const { C, name } = VARIANTS[idx]
  return (
    <div className="flex h-dvh bg-[repeating-linear-gradient(45deg,var(--muted)_0_1px,transparent_1px_12px)]">
      {/* the app frame: a container, so variants respond to its width, not the window */}
      <main className="@container h-full overflow-hidden border-r bg-background shadow-xl" style={{ width: WIDTHS[width] }}>
        <StoreProvider key={variant}>
          <C />
        </StoreProvider>
      </main>
      {width !== 'full' && (
        <div className="hidden flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground md:flex">
          your editor / terminal lives here
        </div>
      )}

      {/* prototype switcher: not part of the design */}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100 shadow-2xl ring-1 ring-white/10">
        <button type="button" onClick={() => cycle(-1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="Previous (←)">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-44 text-center font-medium">
          {variant} <span className="text-zinc-400">({name})</span>
        </span>
        <button type="button" onClick={() => cycle(1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="Next (→)">
          <ChevronRight className="size-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-white/20" />
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
