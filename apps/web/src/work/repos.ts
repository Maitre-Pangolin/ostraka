// The expanded GitLab section lists MRs per repo: each repo by its name, then the MRs I review and the MRs I opened.
import { parseReference } from '@ostraka/core/references'

/** An MR as grouped here: anything with its Reference token (`group/project!iid`), plus the iid read from it. */
type Mr = { reference: string }
export type WithIid<T extends Mr> = T & { iid: number }

export type RepoGroup<T extends Mr> = {
  /** The project's full path, `group/sub/project`. */
  path: string
  /** Its last segment, the repo's name. */
  name: string
  reviewing: WithIid<T>[]
  authored: WithIid<T>[]
}

/**
 * MRs grouped by repo: repos with an MR to review first, then the rest, each in the order the server listed its first
 * MR (most recently updated first). Within a repo both lists keep the server's order.
 */
export function groupByRepo<T extends Mr>({ reviewing, authored }: { reviewing: T[]; authored: T[] }): RepoGroup<T>[] {
  const repos = new Map<string, RepoGroup<T>>()
  const add = (mr: T, role: 'reviewing' | 'authored') => {
    const parsed = parseReference(mr.reference)
    const path = parsed?.kind === 'mr' ? parsed.project : mr.reference
    const iid = parsed?.kind === 'mr' ? parsed.iid : 0
    let repo = repos.get(path)
    if (!repo) {
      repo = { path, name: path.split('/').at(-1) ?? path, reviewing: [], authored: [] }
      repos.set(path, repo)
    }
    repo[role].push({ ...mr, iid })
  }
  for (const mr of reviewing) add(mr, 'reviewing')
  for (const mr of authored) add(mr, 'authored')
  return [...repos.values()]
}
