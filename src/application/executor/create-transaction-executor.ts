import type { EntityId, ISODateTime } from '../../domain/common/primitives';
import type { Transaction } from '../../domain/transaction/transaction';
import type { ActionLog } from '../proposals/action-log';
import type { TransactionCreationUnitOfWork } from '../repositories/transaction-creation-unit-of-work';
import type { UndoRecord } from '../undo/undo-record';
import type { ValidationResult } from '../validator/validation-result';
import { isUtcDateTime } from '../validator/utc-date-time';
import {
  validateCreateTransaction,
  type CreateTransactionProposal,
  type ResolvedTransactionPayload,
} from '../validator/validate-create-transaction';
import type { ExecutionResult } from './execution-result';

export interface TransactionExecutionDependencies {
  unitOfWork: TransactionCreationUnitOfWork;
  /** Must return the same UUID-style IDs for the same action across retries/restarts. */
  idsForAction(actionId: EntityId): { transactionId: EntityId; undoId: EntityId };
  /** New UUID-style evidence ID per attempt: logs remain append-only. */
  nextLogId(): EntityId;
  now(): ISODateTime;
  /** Explicit product policy supplied by the caller; no default duration is chosen here. */
  undoWindowMilliseconds: number;
}

export interface TransactionExecutionOutcome {
  result: ExecutionResult;
  undoRecord: UndoRecord | null;
}

function outcome(result: ExecutionResult, undoRecord: UndoRecord | null = null): TransactionExecutionOutcome {
  return { result, undoRecord };
}

function failed(actionId: EntityId, affectedEntityId: EntityId | null,
  errorCode: string, errorMessage: string): ExecutionResult {
  return { actionId, affectedEntityId, status: 'FAILED', errorCode, errorMessage };
}

/** First execution slice only. No SQL, native APIs, parsing, dependency orchestration or Undo engine.
 * A stable entity ID plus INSERT (never upsert) prevents duplicate creation on retry.
 * Creation and evidence append share a unit of work; rejected writes roll back together.
 * Undo evidence is constructed only after the unit of work confirms commit.
 */
export function createTransactionExecutor(dependencies: TransactionExecutionDependencies) {
  const inFlight = new Map<EntityId, { fingerprint: string; promise: Promise<TransactionExecutionOutcome> }>();

  async function persist(proposal: CreateTransactionProposal,
    validation: Extract<ValidationResult, { status: 'VALID' }>): Promise<TransactionExecutionOutcome> {
    const { actionId } = proposal;
    const payload = proposal.payload as ResolvedTransactionPayload; // Rechecked before reaching persist.
    let ids: ReturnType<TransactionExecutionDependencies['idsForAction']>;
    let timestamp: ISODateTime;
    let logId: EntityId;
    try {
      ids = dependencies.idsForAction(actionId);
      timestamp = dependencies.now();
      logId = dependencies.nextLogId();
      if (!ids.transactionId.trim() || !ids.undoId.trim() || !logId.trim()
        || !isUtcDateTime(timestamp) || !Number.isSafeInteger(dependencies.undoWindowMilliseconds)
        || dependencies.undoWindowMilliseconds <= 0) throw new Error('Invalid execution dependencies.');
    } catch {
      return outcome(failed(actionId, null, 'EXECUTION_SETUP_FAILED', 'ID, time, or Undo policy setup failed; no write was attempted.'));
    }
    const expected: Transaction = {
      id: ids.transactionId, type: payload.transactionType, amount: payload.amount,
      currencyCode: payload.currencyCode, category: payload.category, memo: payload.memo,
      occurredAt: payload.occurredAt, inputMethod: proposal.inputMethod, rawInput: proposal.sourceInput,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    let failureCode = 'ATOMIC_PERSISTENCE_FAILED';
    let failureMessage = 'Atomic persistence failed; no successful commit was confirmed.';
    try {
      const committed = await dependencies.unitOfWork.run(async ({ transactions, actionLogs }) => {
        failureCode = 'TRANSACTION_LOOKUP_FAILED';
        failureMessage = 'Could not check the stable transaction ID inside the atomic operation.';
        const existing = await transactions.findById(ids.transactionId);
        if (existing && (existing.type !== expected.type || existing.amount !== expected.amount
          || existing.currencyCode !== expected.currencyCode || existing.category !== expected.category
          || existing.memo !== expected.memo || existing.occurredAt !== expected.occurredAt
          || existing.inputMethod !== expected.inputMethod || existing.rawInput !== expected.rawInput
          || existing.deletedAt !== null || existing.updatedAt !== existing.createdAt)) {
          failureCode = 'ACTION_ID_CONFLICT';
          failureMessage = 'The stable transaction ID belongs to different or modified data.';
          throw new Error(failureCode);
        }
        const entity = existing ?? expected;
        failureCode = 'UNDO_SETUP_FAILED';
        failureMessage = 'Could not calculate the reversal deadline; no write was attempted.';
        // Preflight the deadline before writing; construct the UndoRecord only after commit.
        const deadline = new Date(Date.parse(entity.createdAt) + dependencies.undoWindowMilliseconds).toISOString();
        if (!isUtcDateTime(entity.createdAt) || !isUtcDateTime(deadline)) throw new Error(failureCode);
        failureCode = 'TRANSACTION_PERSISTENCE_FAILED';
        failureMessage = 'Transaction insertion failed; the atomic operation was not committed.';
        if (!existing) await transactions.create(entity);
        const result: ExecutionResult = { actionId, affectedEntityId: entity.id, status: 'SUCCESS' };
        const log: ActionLog = {
          id: logId, rawInput: proposal.sourceInput, proposal, validationResult: validation,
          executionResult: result, createdAt: timestamp,
        };
        failureCode = 'ACTION_LOG_PERSISTENCE_FAILED';
        failureMessage = 'ActionLog insertion failed; the atomic operation was not committed.';
        await actionLogs.append(log);
        failureCode = 'ATOMIC_COMMIT_FAILED';
        failureMessage = 'Atomic commit could not be confirmed; reconcile using the stable transaction ID.';
        return { entity, deadline, result };
      });
      const undoRecord: UndoRecord = {
        undoId: ids.undoId, actionId, actionType: 'CREATE_TRANSACTION', affectedEntityId: committed.entity.id,
        reversibleUntil: committed.deadline, reversalData: {}, affectedReminderIds: [],
        createdAt: committed.entity.createdAt,
      };
      return outcome(committed.result, undoRecord);
    } catch {
      // No second database mutation to log failure, and no Undo record for an unconfirmed commit.
      // The ID is a reconciliation key, not a claim that this attempt persisted a row.
      return outcome(failed(actionId, ids.transactionId, failureCode, failureMessage));
    }
  }

  function execute(proposal: CreateTransactionProposal, validation: ValidationResult): Promise<TransactionExecutionOutcome> {
    // Defensive recheck prevents a stale/forged VALID result from authorizing changed input.
    const checked = validateCreateTransaction(proposal);
    const actionId = checked.actionId;
    if (checked.status === 'INVALID') {
      return Promise.resolve(outcome(failed(actionId, null, checked.errorCode, checked.errorMessage)));
    }
    if (checked.status === 'NEEDS_CLARIFICATION') {
      return Promise.resolve(outcome({ actionId, affectedEntityId: null, status: 'PENDING_CLARIFICATION' }));
    }
    if (validation.actionId !== actionId || validation.status !== 'VALID') {
      return Promise.resolve(outcome(failed(actionId, null, 'VALIDATION_REQUIRED', 'A matching VALID validation result is required.')));
    }
    if (proposal.dependsOnActionIds.length) {
      const [first, ...rest] = proposal.dependsOnActionIds;
      return Promise.resolve(outcome({ actionId, affectedEntityId: null, status: 'SKIPPED_DEPENDENCY', blockedByActionIds: [first, ...rest] }));
    }
    // Snapshot primitives before any await; later caller mutations cannot alter the write/log.
    const snapshot: CreateTransactionProposal = {
      actionId, type: 'CREATE_TRANSACTION', sourceInput: proposal.sourceInput,
      inputMethod: proposal.inputMethod, dependsOnActionIds: [],
      payload: {
        transactionType: proposal.payload.transactionType, amount: proposal.payload.amount,
        currencyCode: proposal.payload.currencyCode, category: proposal.payload.category,
        memo: proposal.payload.memo, occurredAt: proposal.payload.occurredAt,
      },
    };
    const fingerprint = JSON.stringify(snapshot);
    const active = inFlight.get(actionId);
    if (active) {
      return active.fingerprint === fingerprint ? active.promise : Promise.resolve(outcome(
        failed(actionId, null, 'ACTION_ID_CONFLICT', 'This action ID is already executing different input.')));
    }
    const promise = persist(snapshot, { actionId, status: 'VALID' }).finally(() => { inFlight.delete(actionId); });
    inFlight.set(actionId, { fingerprint, promise });
    return promise;
  }
  return { execute };
}
