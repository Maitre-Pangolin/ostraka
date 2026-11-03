import { parseDevlogsView } from '@ostraka/core/devlog-days'
import { parseNotesView } from '@ostraka/core/note-schema'
import { parseSketchesView } from '@ostraka/core/sketch-schema'
import { parseTodoFilter } from '@ostraka/core/todo-filter'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { DevlogsView } from './devlogs/devlogs-view'
import { NotesView } from './notes/notes-view'
import { SettingsView } from './settings/settings-view'
import { EmptyState, Shell } from './shell/shell'
import { SketchesView } from './sketches/sketches-view'
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
  // The Todo filter lives in typed search params, so a filtered view survives a reload and can be linked.
  createRoute({ getParentRoute: () => rootRoute, path: '/todos', validateSearch: parseTodoFilter, component: TodosView }),
  // The open Note and the Ideas switch live in search params, so a reload keeps them and a Note can be linked.
  createRoute({ getParentRoute: () => rootRoute, path: '/notes', validateSearch: parseNotesView, component: NotesView }),
  // The open day or summary, or a date range with its Tag filter, live in search params, so a review can be linked.
  createRoute({ getParentRoute: () => rootRoute, path: '/devlogs', validateSearch: parseDevlogsView, component: DevlogsView }),
  // The open Sketch and its mode live in search params; without one the view opens on its list.
  createRoute({ getParentRoute: () => rootRoute, path: '/sketches', validateSearch: parseSketchesView, component: SketchesView }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsView }),
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
