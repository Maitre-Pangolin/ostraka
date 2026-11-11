// The top bar's data: every Activity source the server polls (GitLab, Jira), on one schedule.
import { loadConfig, type ConfigOptions } from '@ostraka/core'
import type { Credentials } from '../keychain.ts'
import { systemClock, type Clock } from './clock.ts'
import { gitlabSource } from './gitlab.ts'
import type { Fetch } from './http.ts'
import { jiraSource } from './jira.ts'
import { activityPoller, type Activity } from './poller.ts'

export type WorkOverviewOptions = {
  /** Calls to GitLab and Jira; a fake in tests, which never reach a real instance. */
  fetch: Fetch
  credentials: Credentials
  /** Where config.yml lives. */
  content?: ConfigOptions
  clock?: Clock
}

export function workOverview({ fetch, credentials, content = {}, clock = systemClock }: WorkOverviewOptions): Activity {
  const config = () => loadConfig({ homeDir: content.homeDir })
  return activityPoller({
    clock,
    sources: [
      gitlabSource({ fetch, token: credentials.gitlab, baseUrl: async () => (await config()).gitlab?.base_url }),
      jiraSource({ fetch, token: credentials.jira, config: async () => (await config()).jira, now: clock.now }),
    ],
  })
}
