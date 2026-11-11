import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { applyAppearance, loadAppearance, saveAppearance, type Appearance, type Density, type Theme } from './appearance-store'

type AppearanceContext = Appearance & { setTheme: (theme: Theme) => void; setDensity: (density: Density) => void }

const Context = createContext<AppearanceContext | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(loadAppearance)

  useEffect(() => {
    applyAppearance(appearance)
    saveAppearance(appearance)
  }, [appearance])

  const value: AppearanceContext = {
    ...appearance,
    setTheme: (theme) => setAppearance((a) => ({ ...a, theme })),
    setDensity: (density) => setAppearance((a) => ({ ...a, density })),
  }
  return <Context value={value}>{children}</Context>
}

// oxlint-disable-next-line react/only-export-components -- the hook belongs with its provider
export function useAppearance(): AppearanceContext {
  const value = useContext(Context)
  if (!value) throw new Error('useAppearance needs an <AppearanceProvider>')
  return value
}
