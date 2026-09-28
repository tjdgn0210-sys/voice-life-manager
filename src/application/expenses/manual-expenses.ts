import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import { createTransactionExecutor, type TransactionExecutionDependencies } from '../executor/create-transaction-executor';
import { validateCreateTransaction, type CreateTransactionProposal } from '../validator/validate-create-transaction';

/** Small application facade; production and development checks supply the same ports. */
export function createManualExpenses(dependencies: TransactionExecutionDependencies & {
  transactions: Pick<TransactionRepository, 'listRecent' | 'findById'>;
  nextActionId(): string;
}) {
  const executor = createTransactionExecutor(dependencies);
  let lastSavedId: string | null = null;
  return {
    newActionId: dependencies.nextActionId,
    now: dependencies.now,
    async save(proposal: CreateTransactionProposal) {
      const validation = validateCreateTransaction(proposal);
      if (validation.status !== 'VALID') return { validation, outcome: null };
      const outcome = await executor.execute(proposal, validation);
      if (outcome.result.status === 'SUCCESS') lastSavedId = outcome.result.affectedEntityId;
      return { validation, outcome };
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
