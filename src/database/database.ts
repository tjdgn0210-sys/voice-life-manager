import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrateDatabase } from './migrations/migrate';

const DATABASE_NAME = 'voice-life-manager.db';

/** Infrastructure API for future repository implementations, not feature/UI queries. */
export type ApplicationDatabase = Pick<
  SQLiteDatabase,
  'getFirstAsync' | 'getAllAsync' | 'runAsync' | 'withExclusiveTransactionAsync'
>;

let initialization: Promise<ApplicationDatabase> | undefined;

async function openAndInitialize(): Promise<ApplicationDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  try {
    await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrateDatabase(database);
    return database;
  } catch (error) {
    try {
      await database.closeAsync();
    } catch {
      // Preserve the original initialization error; never delete the database to recover.
      console.error('Failed to close the database after initialization failure.');
    }
    throw error;
  }
}

/** One shared initialized connection per module lifetime. Concurrent callers share startup.
 * Failed initialization rejects all callers and permits a later explicit retry.
 * The successful connection stays open for the application lifetime.
 */
export function getDatabase(): Promise<ApplicationDatabase> {
  if (!initialization) {
    initialization = openAndInitialize().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
