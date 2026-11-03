// Status dots for things from another system: a Jira ticket by its status category, an MR by its head pipeline.
import type { StatusCategory } from '@/work/api'

/** A ticket's dot: to do muted, in progress `primary`, done `success`. */
export const CATEGORY_DOT: Record<StatusCategory, string> = {
  new: 'bg-muted-foreground/50',
  indeterminate: 'bg-primary',
  done: 'bg-success',
}

const STILL_RUNNING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'manual'])

/** An MR's dot from its head pipeline: passed `success`, failed `destructive`, still running `primary`, else muted. */
export function pipelineDot(status: string | undefined): string {
  if (status === 'success') return 'bg-success'
  if (status === 'failed') return 'bg-destructive'
  if (status && STILL_RUNNING.has(status)) return 'bg-primary'
  return status ? 'bg-muted-foreground/50' : 'border border-muted-foreground/50'
}

/** "Pipeline passed", "Pipeline waiting for resource"… */
export function pipelineLabel(status: string | undefined): string {
  if (!status) return 'No pipeline'
  if (status === 'success') return 'Pipeline passed'
  return `Pipeline ${status.replaceAll('_', ' ')}`
}

/** A Reference nothing is known about yet: not polled, its details not fetched. */
export const UNKNOWN_DOT = 'border border-dashed border-muted-foreground/60'
