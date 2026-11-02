import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { getJson } from '@/lib/api'
import { DelayedSkeleton } from '@/shell/delayed-skeleton'

/** GET /api/settings (apps/server/src/app.ts). Never carries a token, only whether each Keychain item was found. */
type Settings = {
  configFile: string
  content: { path: string; source: 'env' | 'config' | 'default' }
  gitlab: { base_url?: string }
  jira: { site?: string; cloud_id?: string; board_id?: number; my_tickets_jql?: string }
  keychain: { name: 'gitlab' | 'jira' | 'push'; item: string; found: boolean }[]
}

const SOURCE = {
  env: 'from OSTRAKA_HOME',
  config: 'from config.yml',
  default: 'default',
} as const

const TOKEN_LABEL = {
  gitlab: 'GitLab token',
  jira: 'Jira token',
  push: 'Push token',
} as const

/** Settings: what the app reads from config.yml, and which Keychain items the server found at startup. Read-only. */
export function SettingsView() {
  const { data, error, isPending } = useQuery({ queryKey: ['settings'], queryFn: () => getJson<Settings>('/settings') })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
      <h1 className="font-heading text-base font-semibold">Settings</h1>
      {isPending ? (
        <DelayedSkeleton rows={6} />
      ) : error ? (
        <div role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          <p className="font-medium">Could not read the settings.</p>
          <pre className="mt-1 font-mono text-xs wrap-anywhere whitespace-pre-wrap">{error.message}</pre>
        </div>
      ) : (
        <>
          <Section title="Content">
            <Row label="Content folder" hint={SOURCE[data.content.source]}>
              {data.content.path}
            </Row>
          </Section>
          <Section title="GitLab">
            <Row label="Base URL">{data.gitlab.base_url}</Row>
          </Section>
          <Section title="Jira">
            <Row label="Site">{data.jira.site}</Row>
            <Row label="Cloud ID">{data.jira.cloud_id}</Row>
            <Row label="Board">{data.jira.board_id}</Row>
            <Row label="My tickets JQL">{data.jira.my_tickets_jql}</Row>
          </Section>
          <Section title="Keychain">
            {data.keychain.map(({ name, item, found }) => (
              <Row key={name} label={TOKEN_LABEL[name]} hint={item} plain>
                <span className={found ? 'inline-flex items-center gap-1.5' : 'text-muted-foreground inline-flex items-center gap-1.5'}>
                  {found ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                  {found ? 'Found' : 'Missing'}
                </span>
              </Row>
            ))}
          </Section>
          <p className="text-muted-foreground text-xs">
            Edit <span className="font-mono wrap-anywhere">{data.configFile}</span> to change these. Tokens live only in the Keychain, read
            once when the server starts; the README shows how to add them.
          </p>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      <dl className="divide-y rounded-lg border">{children}</dl>
    </section>
  )
}

/** One setting: label on the left from @md (stacked below it), the value in monospace unless `plain`, wrapping rather than scrolling. */
function Row({ label, hint, plain, children }: { label: string; hint?: string; plain?: boolean; children: ReactNode }) {
  const empty = children === undefined || children === null || children === ''
  return (
    <div className="grid gap-x-3 gap-y-0.5 px-3 py-2 text-sm @md:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {empty ? (
          <span className="text-muted-foreground">Not set</span>
        ) : (
          <span className={plain ? undefined : 'font-mono text-xs wrap-anywhere'}>{children}</span>
        )}
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </dd>
    </div>
  )
}
