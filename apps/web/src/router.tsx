import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { EmptyState, Shell } from './shell/shell'
import { TodosView } from './todos/todos-view'

const rootRoute = createRootRoute({ component: Shell })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/todos' })
  },
})

const view = <P extends string>(path: P, empty: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <EmptyState>{empty}</EmptyState> })

const routeTree = rootRoute.addChildren([
  indexRoute,
  createRoute({ getParentRoute: () => rootRoute, path: '/todos', component: TodosView }),
  view('/notes', 'No Notes yet. Start one to keep your thoughts.'),
  view('/devlogs', "No Dev logs yet. Run the Dev log skill to write today's."),
  view('/sketches', 'No Sketches yet. Start one to draw a diagram.'),
  view('/settings', 'No settings yet. Switch theme and density from the rail.'),
])

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => <EmptyState>Nothing here. Pick a section on the left.</EmptyState>,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
