import { describe, expect, it } from 'vitest'
import { groupByRepo } from '../src/work/repos'

const mr = (reference: string) => ({ reference, title: reference })

describe('groupByRepo', () => {
  it('groups MRs by repo, repos with MRs to review first, keeping the server order in each list', () => {
    const groups = groupByRepo({
      reviewing: [mr('acme/platform/api!42'), mr('acme/web!7'), mr('acme/platform/api!40')],
      authored: [mr('acme/tools!3'), mr('acme/platform/api!48')],
    })
    expect(groups.map((repo) => [repo.name, repo.reviewing.map((m) => m.iid), repo.authored.map((m) => m.iid)])).toEqual([
      ['api', [42, 40], [48]],
      ['web', [7], []],
      ['tools', [], [3]],
    ])
    expect(groups[0]?.path).toBe('acme/platform/api')
  })

  it('keeps repos of the same name in different groups apart', () => {
    const groups = groupByRepo({ reviewing: [mr('a/applications!1')], authored: [mr('b/applications!2')] })
    expect(groups.map((repo) => repo.path)).toEqual(['a/applications', 'b/applications'])
  })
})
