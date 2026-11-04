// The work overview's API: each Activity source's latest data, and whether a window shows the app.
import { Hono } from 'hono'
import type { Activity } from './poller.ts'

export function activityRoutes(activity: Activity) {
  const routes = new Hono()

  // Each Activity source's latest data, or why it is failing or off.
  routes.get('/', (c) => c.json({ sources: activity.statuses() }))

  // A window shows or hides the app: the server owns the schedule, the window only says whether it is seen.
  routes.post('/visibility', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { client?: unknown; visible?: unknown } | undefined
    if (typeof body?.client !== 'string' || typeof body.visible !== 'boolean') {
      return c.json({ error: 'Expected { client: string, visible: boolean }' }, 400)
    }
    activity.setVisibility(body.client, body.visible)
    return c.body(null, 204)
  })

  return routes
}
