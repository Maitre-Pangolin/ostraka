import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useAppearance } from '@/shell/appearance'

// Toasts exist only for Undo (apps/web/AGENTS.md), so no status icons. The theme follows the rail's choice.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useAppearance()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
