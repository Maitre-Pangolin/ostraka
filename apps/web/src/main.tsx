import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { retryUnanswered } from './lib/api'
import { router } from './router'
import { AppearanceProvider } from './shell/appearance'
import { applyAppearance, loadAppearance } from './shell/appearance-store'

// Server state lives in TanStack Query only; there is no second client store.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryUnanswered } } })

// Before the first render, so a dark or comfy choice never flashes light or compact.
applyAppearance(loadAppearance())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppearanceProvider>
  </StrictMode>,
)
