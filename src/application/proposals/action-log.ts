import type { EntityId, ISODateTime } from '../../domain/common/primitives';
import type { ExecutionResult } from '../executor/execution-result';
import type { ValidationResult } from '../validator/validation-result';
import type { ActionProposal } from './action-proposal';

/** Append-only, local MVP evidence; never raw audio or Error objects.
 * Null results mean that stage had not run when this entry was created.
 * Later progress appends a new entry with a new id and the same proposal.actionId;
 * never overwrite prior entries. Embedded actionIds must match the proposal.
 * Values must be JSON-safe (finite numbers, strings, arrays, objects, null).
 * readonly is shallow; future storage must enforce append-only behavior as well.
 */
export interface ActionLog {
  readonly id: EntityId;
  readonly rawInput: string;
  readonly proposal: ActionProposal;
  readonly validationResult: ValidationResult | null;
  readonly executionResult: ExecutionResult | null;
  readonly createdAt: ISODateTime;
}
