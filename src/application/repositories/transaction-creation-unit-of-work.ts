import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import type { ActionLogRepository } from './action-log-repository';

/** Only the repository operations required by CREATE_TRANSACTION, scoped to one atomic write. */
export interface TransactionCreationRepositories {
  transactions: Pick<TransactionRepository, 'findById' | 'create'>;
  actionLogs: Pick<ActionLogRepository, 'append'>;
}

export interface TransactionCreationUnitOfWork {
  /** Resolves only after commit; rejects on callback/commit failure and rolls back.
   * Await every repository call. Do not retain scoped repositories outside this callback.
   * Never swallow a write failure inside work: rejection is the rollback signal.
   */
  run<T>(work: (repositories: TransactionCreationRepositories) => Promise<T>): Promise<T>;
}
