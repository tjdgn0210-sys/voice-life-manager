import type { TransactionCreationRepositories, TransactionCreationUnitOfWork } from '../application/repositories/transaction-creation-unit-of-work';
import type { ApplicationDatabase } from './database';
import { createSqliteActionLogRepository } from './repositories/sqlite-action-log-repository';
import { createSqliteTransactionRepository } from './repositories/sqlite-transaction-repository';

/** Expo's Android/iOS exclusive API opens an isolated transaction connection.
 * Reuse existing SQL/mappers against that handle, never the outer connection.
 * No result is exposed until the native commit has completed successfully.
 */
export function createSqliteTransactionCreationUnitOfWork(
  database: ApplicationDatabase,
): TransactionCreationUnitOfWork {
  return {
    async run<T>(work: (repositories: TransactionCreationRepositories) => Promise<T>): Promise<T> {
      let result!: T;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const transactions = createSqliteTransactionRepository(transaction);
        const actionLogs = createSqliteActionLogRepository(transaction);
        result = await work({
          transactions: { findById: transactions.findById, create: transactions.create },
          actionLogs: { append: actionLogs.append },
        });
      });
      return result;
    },
  };
}
