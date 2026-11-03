import { CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAfter } from '@/lib/use-after'
import { useSettings } from './api'

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
  const { data, error, isPending } = useSettings()
  const showSkeleton = useAfter(300, isPending)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
      <h1 className="font-heading text-base font-semibold">Settings</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm wrap-anywhere whitespace-pre-wrap">
          Couldn’t load the settings: {error.message}
        </p>
      ) : isPending ? (
        showSkeleton && (
          <div aria-label="Loading settings" className="flex flex-col gap-2">
            {[40, 70, 55, 65].map((width) => (
              <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
            ))}
          </div>
        )
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
            <Row label="Account email">{data.jira.email}</Row>
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
