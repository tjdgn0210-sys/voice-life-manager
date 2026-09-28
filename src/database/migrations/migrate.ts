import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations, type Migration } from './index';

type MigrationDatabase = Pick<SQLiteDatabase, 'withExclusiveTransactionAsync'>;

/** Startup-only: callers must not expose the connection until this resolves.
 * Version reads, schema changes, and version writes share one transaction.
 * Any failure rolls back the entire pending batch; no resets or downgrade attempts.
 * Expo's Android/iOS exclusive API uses a separate connection (useNewConnection).
 * All SQL below uses its transaction handle, so unrelated work on the application
 * connection cannot join this transaction. No additional locking layer is needed.
 */
export async function migrateDatabase(
  database: MigrationDatabase,
  plan: readonly Migration[] = migrations,
): Promise<void> {
  const ordered = [...plan].sort((a, b) => a.version - b.version);
  for (const [index, migration] of ordered.entries()) {
    if (!Number.isSafeInteger(migration.version) || migration.version !== index + 1) {
      throw new Error('Migration versions must be contiguous integers starting at 1.');
    }
  }
  const latestVersion = ordered.length;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (!row || !Number.isInteger(row.user_version) || row.user_version < 0) {
      throw new Error('Unable to read a valid database schema version.');
    }
    if (row.user_version > latestVersion) {
      throw new Error('Database schema is newer than this app. Update the app to continue.');
    }

    for (const migration of ordered) {
      if (migration.version <= row.user_version) continue;
      await transaction.execAsync(migration.sql);
      // PRAGMA cannot bind a value; version is a validated, application-owned integer.
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
  });
}
