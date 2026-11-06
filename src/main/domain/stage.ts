import type { Stage } from './types'

const LABELS: Record<Stage, string> = {
  'to-review': 'To review',
  'reviewed-waiting': 'Reviewed, waiting',
  're-review': 'Re-review',
  done: 'Done',
  implement: 'Implement',
  testing: 'Testing',
  'in-review': 'In review',
  waiting: 'Waiting'
}

/** Every WorkDesk has the same Stages. The ones of a review are worked out from its pull requests; the others are set by hand. */
export const STAGES: readonly Stage[] = ['implement', 'testing', 'in-review', 'waiting', 'to-review', 're-review', 'reviewed-waiting', 'done']

export const initialStage = (): Stage => 'implement'

export const isValidStage = (stage: string): stage is Stage => (STAGES as readonly string[]).includes(stage)

export function stageLabel(stage: Stage): string {
  return LABELS[stage]
}

/** Waiting Stages sink to the bottom of the sidebar and are dimmed. */
export function isWaitingStage(stage: Stage): boolean {
  return stage === 'reviewed-waiting' || stage === 'waiting'
}

export interface StageState {
  stage: Stage
  stageOverridden: boolean
}

/** Set the Stage by hand; it overrides any derived Stage until cleared. */
export function setStageByHand(stage: Stage): StageState {
  if (!isValidStage(stage)) throw new Error(`Stage "${stage}" is not known`)
  return { stage, stageOverridden: true }
}

/** Apply a Stage worked out by the tool; a hand-set Stage always wins. */
export function applyDerivedStage(current: StageState, derived: Stage): StageState {
  if (current.stageOverridden) return current
  return { stage: derived, stageOverridden: false }
}

/** Give control back to the tool, which sets the derived Stage right away. */
export const clearOverride = (derived: Stage): StageState => ({ stage: derived, stageOverridden: false })
