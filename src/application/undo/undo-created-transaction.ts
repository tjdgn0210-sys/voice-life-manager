import type { TransactionExecutionDependencies } from '../executor/create-transaction-executor';
import type { ActionProposal } from '../proposals/action-proposal';
import { isUtcDateTime } from '../validator/utc-date-time';
import type { UndoRecord } from './undo-record';

export type UndoResult =
  | { status: 'SUCCESS'; affectedEntityId: string }
  | { status: 'UNAVAILABLE' | 'EXPIRED' | 'INELIGIBLE' | 'BUSY' | 'FAILED'; message: string };

/** Consumes trusted session evidence from a committed creation, not arbitrary UI payloads.
 * Only unchanged MANUAL EXPENSE creation is supported. No physical deletion or Undo table.
 */
export function createTransactionUndo(dependencies: TransactionExecutionDependencies & { nextActionId(): string }) {
  let busy = false;
  return async function undo(record: UndoRecord | null): Promise<UndoResult> {
    if (busy) return { status: 'BUSY', message: '실행취소 처리 중입니다.' };
    if (!record) return { status: 'UNAVAILABLE', message: '실행취소할 기록이 없습니다.' };
    // Snapshot before awaiting; evidence must not change under the transaction.
    const evidence = { ...record };
    busy = true;
    try {
      if (evidence.actionType !== 'CREATE_TRANSACTION' || !evidence.undoId || !evidence.actionId
        || !evidence.affectedEntityId || !isUtcDateTime(evidence.createdAt) || !isUtcDateTime(evidence.reversibleUntil)
        || Date.parse(evidence.reversibleUntil) < Date.parse(evidence.createdAt)
        || dependencies.idsForAction(evidence.actionId).transactionId !== evidence.affectedEntityId) {
        return { status: 'INELIGIBLE', message: '이 기록은 실행취소할 수 없습니다.' };
      }
      const actionId = dependencies.nextActionId();
      const logId = dependencies.nextLogId();
      if (!actionId.trim() || !logId.trim()) throw new Error('Invalid Undo IDs');
      const proposal: ActionProposal = {
        actionId, type: 'DELETE_TRANSACTION', sourceInput: '', inputMethod: 'MANUAL', dependsOnActionIds: [],
        payload: { targetId: evidence.affectedEntityId, undoOf: { undoId: evidence.undoId, actionId: evidence.actionId } },
      };
      return await dependencies.unitOfWork.run<UndoResult>(async ({ transactions, actionLogs }) => {
        const checkClock = () => {
          const now = dependencies.now();
          if (!isUtcDateTime(now) || Date.parse(now) < Date.parse(evidence.createdAt)) throw new Error('Invalid Undo clock');
          return now;
        };
        if (Date.parse(checkClock()) > Date.parse(evidence.reversibleUntil)) {
          return { status: 'EXPIRED', message: '실행취소 가능 시간이 끝났습니다.' };
        }
        const entity = await transactions.findById(evidence.affectedEntityId);
        if (!entity) return { status: 'UNAVAILABLE', message: '기록이 없거나 이미 취소되었습니다.' };
        if (entity.type !== 'EXPENSE' || entity.inputMethod !== 'MANUAL' || entity.deletedAt !== null
          || entity.createdAt !== evidence.createdAt || entity.updatedAt !== entity.createdAt) {
          return { status: 'INELIGIBLE', message: '기록이 변경되어 실행취소할 수 없습니다.' };
        }
        const now = checkClock(); // Recheck after the asynchronous read, immediately before mutation.
        if (Date.parse(now) > Date.parse(evidence.reversibleUntil)) {
          return { status: 'EXPIRED', message: '실행취소 가능 시간이 끝났습니다.' };
        }
        if (!await transactions.softDelete(entity.id, now)) throw new Error('Undo target changed');
        await actionLogs.append({
          id: logId, rawInput: '', proposal, validationResult: { actionId, status: 'VALID' },
          executionResult: { actionId, affectedEntityId: entity.id, status: 'SUCCESS' }, createdAt: now,
        });
        return { status: 'SUCCESS', affectedEntityId: entity.id };
      });
    } catch {
      // Do not make a second durable mutation to log a failed atomic operation.
      return { status: 'FAILED', message: '실행취소를 확인하지 못했습니다. 목록을 확인하고 다시 시도해 주세요.' };
    } finally { busy = false; }
  };
}
