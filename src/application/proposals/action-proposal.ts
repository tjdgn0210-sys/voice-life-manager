import type { ActionType } from '../../domain/action/action-type';
import type { EntityId, InputMethod } from '../../domain/common/primitives';
import type { ActionPayloadMap } from './action-payloads';

/** Unvalidated proposals may be incomplete. This is not an executable authorization. */
export type ActionProposal = {
  [T in ActionType]: {
    /** Stable execution/idempotency identity, preserved across retries. */
    actionId: EntityId;
    type: T;
    sourceInput: string;
    inputMethod: InputMethod;
    /** Empty for independent actions. References are stable IDs, never array indexes. */
    dependsOnActionIds: EntityId[];
    payload: ActionPayloadMap[T];
  };
}[ActionType];

/** Validate unique IDs, existing dependencies, no cycles, and target type compatibility.
 * Independent actions may proceed while others await clarification or confirmation.
 */
export interface ActionProposalGroup {
  groupId: EntityId;
  proposals: ActionProposal[];
}
