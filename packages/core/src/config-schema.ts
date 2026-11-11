// Zod only, no Node modules: the web app imports these types from `@ostraka/core/config-schema`.
import { z } from 'zod'

/**
 * `~/.config/ostraka/config.yml`. No secrets: tokens live in the macOS Keychain, read by the server only.
 * Keys it does not know are ignored.
 */
export const ConfigSchema = z.looseObject({
  /** The content folder; `~` expands to the home folder. `OSTRAKA_HOME` overrides it. */
  contentDir: z.string().min(1).optional(),
  gitlab: z
    .object({
      /** gitlab.com today; never assumed in code. */
      base_url: z.url({ protocol: /^https?$/ }).optional(),
    })
    .optional(),
  jira: z
    .object({
      /** The site URL, such as https://acme.atlassian.net. */
      site: z.url({ protocol: /^https?$/ }).optional(),
      /** Scoped tokens go through https://api.atlassian.com/ex/jira/<cloud_id>; from <site>/_edge/tenant_info. */
      cloud_id: z.guid().optional(),
      /** The Atlassian account's email: a scoped API token signs in with it (Basic auth). */
      email: z.email().optional(),
      /** The board whose active sprint is shown. */
      board_id: z.int().positive().optional(),
      /** The "my tickets" JQL. */
      my_tickets_jql: z.string().min(1).optional(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>
