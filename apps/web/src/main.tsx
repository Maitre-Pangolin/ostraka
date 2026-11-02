import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { router } from './router'
import { AppearanceProvider } from './shell/appearance'
import { applyAppearance, loadAppearance } from './shell/appearance-store'

// Before the first render, so a dark or comfy choice never flashes light or compact.
applyAppearance(loadAppearance())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <RouterProvider router={router} />
    </AppearanceProvider>
  </StrictMode>,
)
