// PROTOTYPE (#17): floating variant switcher. ← / → cycle (not while typing). Dev builds only. Throw away.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { VARIANT, VARIANTS } from './variant'

const go = (step: number) => {
  const i = VARIANTS.findIndex((v) => v.key === VARIANT)
  const p = new URLSearchParams(location.search)
  p.set('variant', VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length].key)
  // Reload: the seed data is stored differently per variant.
  location.search = p.toString()
}

export function PrototypeSwitcher() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!import.meta.env.DEV) return null
  const name = VARIANTS.find((v) => v.key === VARIANT)!.name
  return (
    <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900 px-1 py-1 text-xs text-white shadow-lg ring-1 ring-white/10">
      <button type="button" onClick={() => go(-1)} className="grid size-6 place-items-center rounded-full hover:bg-white/15" title="Previous variant (←)">
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="px-1.5 font-medium">
        #17 · {VARIANT} <span className="font-normal text-white/70">({name})</span>
      </span>
      <button type="button" onClick={() => go(1)} className="grid size-6 place-items-center rounded-full hover:bg-white/15" title="Next variant (→)">
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
