import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import { createTransactionExecutor, type TransactionExecutionDependencies } from '../executor/create-transaction-executor';
import { validateCreateTransaction, type CreateTransactionProposal } from '../validator/validate-create-transaction';
import { createTransactionUndo, type UndoResult } from '../undo/undo-created-transaction';
import type { UndoRecord } from '../undo/undo-record';

export interface ExpenseFeedback {
  undoId: string;
  label: string;
  reversibleUntil: string;
  status: 'SAVED' | 'UNDONE' | 'EXPIRED' | 'UNAVAILABLE';
}

/** Small application facade; production and development checks supply the same ports. */
export function createManualExpenses(dependencies: TransactionExecutionDependencies & {
  transactions: Pick<TransactionRepository, 'listRecent' | 'findById'>;
  nextActionId(): string;
}) {
  const executor = createTransactionExecutor(dependencies);
  const undo = createTransactionUndo(dependencies);
  // Session-only: a new service instance/app restart loses this Undo opportunity.
  // Only the most recently saved expense is offered; no persistent Undo history.
  let undoRecord: UndoRecord | null = null;
  let feedback: ExpenseFeedback | null = null;
  let lastSavedId: string | null = null;
  return {
    newActionId: dependencies.nextActionId,
    now: dependencies.now,
    async save(proposal: CreateTransactionProposal) {
      const validation = validateCreateTransaction(proposal);
      if (validation.status !== 'VALID') return { validation, outcome: null };
      const outcome = await executor.execute(proposal, validation);
      if (outcome.result.status === 'SUCCESS') {
        lastSavedId = outcome.result.affectedEntityId;
        undoRecord = outcome.undoRecord;
        feedback = undoRecord ? { undoId: undoRecord.undoId, reversibleUntil: undoRecord.reversibleUntil, status: 'SAVED',
          label: `${proposal.payload.category || '미분류'} ${proposal.payload.amount?.toLocaleString('ko-KR')}원 저장됨` } : null;
      }
      return { validation, outcome };
    },
    feedback(): ExpenseFeedback | null {
      if (feedback?.status === 'SAVED' && Date.parse(dependencies.now()) > Date.parse(feedback.reversibleUntil)) {
        feedback = { ...feedback, status: 'EXPIRED' };
      }
      return feedback ? { ...feedback } : null;
    },
    async undo(undoId: string): Promise<UndoResult> {
      if (!undoRecord || undoRecord.undoId !== undoId) return { status: 'UNAVAILABLE', message: '실행취소할 기록이 없습니다.' };
      if (feedback?.status === 'EXPIRED') return { status: 'EXPIRED', message: '실행취소 가능 시간이 끝났습니다.' };
      const target = undoRecord;
      const result = await undo(target);
      // A newer save must not be overwritten by an older in-flight result.
      if (undoRecord === target && feedback) {
        if (result.status === 'SUCCESS') {
          feedback = { ...feedback, status: 'UNDONE' };
          undoRecord = null;
        } else if (result.status === 'EXPIRED') feedback = { ...feedback, status: 'EXPIRED' };
        else if (result.status === 'UNAVAILABLE' || result.status === 'INELIGIBLE') {
          feedback = { ...feedback, status: 'UNAVAILABLE' };
          undoRecord = null;
        }
      }
      return result;
    },
    async list() {
      const recent = (await dependencies.transactions.listRecent(100)).filter(item => item.type === 'EXPENSE');
      // Show the last committed expense even when backdated beyond the recent window.
      const saved = lastSavedId ? await dependencies.transactions.findById(lastSavedId) : null;
      if (saved?.type === 'EXPENSE' && !recent.some(item => item.id === saved.id)) recent.unshift(saved);
      return recent;
    },
  };
}

export type ManualExpenses = ReturnType<typeof createManualExpenses>;
