import type { EntityId } from '../../domain/common/primitives';

export interface ClarificationRequest {
  actionId: EntityId;
  /** Payload path, e.g. payload.startAt or payload.targetId. */
  field: string;
  reason: 'MISSING' | 'AMBIGUOUS';
  question: string;
}

export type ValidationResult =
  | { actionId: EntityId; status: 'VALID' }
  | { actionId: EntityId; status: 'NEEDS_CLARIFICATION'; clarifications: [ClarificationRequest, ...ClarificationRequest[]] }
  | { actionId: EntityId; status: 'REQUIRES_CONFIRMATION'; reason: string }
  | { actionId: EntityId; status: 'INVALID'; errorCode: string; errorMessage: string };
