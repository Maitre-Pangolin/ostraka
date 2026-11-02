// Changes to the content folder, from whoever made them (the app, the CLI, an agent's editor), as `{kind, id?}`.
import { mkdir } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { contentChangeAt, resolveContentRoot, type ContentChange, type ContentRootOptions } from '@ostraka/core'
import { watch, type FSWatcher } from 'chokidar'

const LIVE_AFTER_READY_MS = 100

export type ContentListener = (change: ContentChange) => void

export type ContentEvents = {
  /** Starts listening; resolves once changes are being watched, with the function that stops listening. */
  subscribe(listener: ContentListener): Promise<() => void>
}

/**
 * One watcher on the content folder, shared by every listener: started by the first subscriber, closed after the
 * last one leaves. Lock, temp and hidden files (the git folder) are not content, so a temp file renamed over its
 * target is one change; chokidar's `atomic` handling (on by default) merges a delete-then-recreate into one too.
 */
export function contentEvents(content: ContentRootOptions): ContentEvents {
  const listeners = new Set<ContentListener>()
  let watcher: Promise<FSWatcher> | undefined

  const start = async () => {
    const root = await resolveContentRoot(content)
    await mkdir(root, { recursive: true })
    const hidden = (path: string) =>
      relative(root, path)
        .split(sep)
        .some((segment) => segment.startsWith('.'))
    const started = watch(root, { ignoreInitial: true, depth: 1, ignored: hidden })
    started.on('all', (_event, path) => {
      const change = contentChangeAt(relative(root, path))
      if (change) for (const listener of listeners) listener(change)
    })
    await new Promise<void>((resolve) => started.once('ready', () => resolve()))
    // On macOS, fs.watch goes through one FSEvents stream that is restarted, off-thread, for each new folder.
    // Changes made in the moment after `ready` were seen to be lost (about half of them with 20 watchers
    // starting at once, none after this pause), so `ready` is only reported once the stream is running.
    await sleep(LIVE_AFTER_READY_MS)
    return started
  }

  const stop = async () => {
    const stopping = watcher
    watcher = undefined
    await (await stopping)?.close()
  }

  return {
    async subscribe(listener) {
      listeners.add(listener)
      watcher ??= start()
      try {
        await watcher
      } catch (error) {
        listeners.delete(listener)
        if (!listeners.size) watcher = undefined
        throw error
      }
      return () => {
        if (listeners.delete(listener) && !listeners.size) void stop()
      }
    },
  }
}
