// The top bar's data: every Activity source the server polls, on one schedule. Jira joins GitLab here.
import { loadConfig, type ConfigOptions } from '@ostraka/core'
import type { Credentials } from '../keychain.ts'
import { systemClock, type Clock } from './clock.ts'
import { gitlabSource } from './gitlab.ts'
import type { Fetch } from './http.ts'
import { activityPoller, type Activity } from './poller.ts'

export type WorkOverviewOptions = {
  /** Calls to GitLab; a fake in tests, which never reach a real instance. */
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
    sources: [gitlabSource({ fetch, token: credentials.gitlab, baseUrl: async () => (await config()).gitlab?.base_url })],
  })
}
