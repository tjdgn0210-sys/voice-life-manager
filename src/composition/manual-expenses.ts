import { randomUUID } from 'expo-crypto';

import { createManualExpenses } from '../application/expenses/manual-expenses';
import { getDatabase } from '../database/database';
import { createSqliteTransactionRepository } from '../database/repositories/sqlite-transaction-repository';
import { createSqliteTransactionCreationUnitOfWork } from '../database/sqlite-transaction-creation-unit-of-work';

// Session-only Undo policy. No persistent Undo table; restarting loses the opportunity.
const UNDO_WINDOW_MILLISECONDS = 60_000;

export async function initializeManualExpenses() {
  const database = await getDatabase();
  return createManualExpenses({
    transactions: createSqliteTransactionRepository(database),
    unitOfWork: createSqliteTransactionCreationUnitOfWork(database),
    nextActionId: randomUUID,
    nextLogId: randomUUID,
    // Separate entity namespaces can share the action UUID. No volatile ID map:
    // retries/restarts resolve the same transaction and reversal identity.
    idsForAction: actionId => ({ transactionId: actionId, undoId: actionId }),
    now: () => new Date().toISOString(),
    undoWindowMilliseconds: UNDO_WINDOW_MILLISECONDS,
  });
}
