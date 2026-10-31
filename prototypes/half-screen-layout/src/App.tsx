// PROTOTYPE (#10): ostraka shell filling the window. ?view= picks the section; theme and density live in the app.
import { useEffect, useState } from 'react'
import { Shell, type View } from './prototype/shell'
import { StoreProvider } from './prototype/store'

export type Density = 'comfy' | 'compact'
const VIEWS: View[] = ['todos', 'notes', 'devlogs', 'sketches', 'settings']

const params = () => new URLSearchParams(location.search)
const getParam = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  const v = params().get(k) as T
  return allowed.includes(v) ? v : fallback
}

export default function App() {
  const [view, setView] = useState<View>(() => getParam('view', VIEWS, 'todos'))
  // Defaults: light and compact (the user's preference).
  const [dark, setDark] = useState(() => params().get('theme') === 'dark')
  const [density, setDensity] = useState<Density>(() => getParam('density', ['comfy', 'compact'] as const, 'compact'))

  useEffect(() => {
    const p = params()
    p.set('view', view)
    p.set('theme', dark ? 'dark' : 'light')
    p.set('density', density)
    p.delete('w')
    history.replaceState(null, '', `?${p}`)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.setProperty('--spacing', density === 'compact' ? '0.21rem' : '0.25rem')
  }, [view, dark, density])

  return (
    <main className="h-dvh overflow-hidden bg-background">
      <StoreProvider>
        <Shell view={view} setView={setView} dark={dark} setDark={setDark} density={density} setDensity={setDensity} />
      </StoreProvider>
    </main>
  )
}
