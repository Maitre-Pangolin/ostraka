// Theme (light/dark) and density (compact/comfy), defaulting to light + compact.
// Kept in browser storage per viewer and applied to <html> as `.dark` and `data-density`.

export type Theme = 'light' | 'dark'
export type Density = 'compact' | 'comfy'
export type Appearance = { theme: Theme; density: Density }

const KEY = 'ostraka.appearance'
const DEFAULTS: Appearance = { theme: 'light', density: 'compact' }

export function loadAppearance(): Appearance {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>
    return {
      theme: stored.theme === 'dark' ? 'dark' : DEFAULTS.theme,
      density: stored.density === 'comfy' ? 'comfy' : DEFAULTS.density,
    }
  } catch {
    return DEFAULTS
  }
}

export function saveAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance))
  } catch {
    // Storage unavailable (private window): the choice lasts for this session only.
  }
}

export function applyAppearance({ theme, density }: Appearance) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.density = density
}
