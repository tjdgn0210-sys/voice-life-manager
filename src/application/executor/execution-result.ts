import type { EntityId } from '../../domain/common/primitives';

interface ExecutionResultBase {
  actionId: EntityId;
  /** Retain the ID even on failure if a partial side effect needs recovery. */
  affectedEntityId: EntityId | null;
}

export type ExecutionResult = ExecutionResultBase & (
  | { status: 'SUCCESS' }
  | { status: 'FAILED'; errorCode: string; errorMessage: string }
  | { status: 'PENDING_CLARIFICATION' }
  | { status: 'PENDING_CONFIRMATION' }
  | { status: 'SKIPPED_DEPENDENCY'; blockedByActionIds: [EntityId, ...EntityId[]] }
);

/** No overall success flag: inspect each action to expose partial success accurately. */
export interface CompoundExecutionResult {
  groupId: EntityId;
  results: ExecutionResult[];
}
