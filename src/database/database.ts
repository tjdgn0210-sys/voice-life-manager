import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { migrateDatabase } from './migrations/migrate';

const DATABASE_NAME = 'voice-life-manager.db';

/** Infrastructure API for future repository implementations, not feature/UI queries. */
export type ApplicationDatabase = Pick<
  SQLiteDatabase,
  'getFirstAsync' | 'getAllAsync' | 'runAsync' | 'withExclusiveTransactionAsync'
>;

let initialization: Promise<ApplicationDatabase> | undefined;

/**
 * Expo SQLite's web adapter supports withTransactionAsync, but not the native
 * exclusive-transaction API. Keep the application-facing contract stable and
 * serialize all application-connection operations while a web transaction is
 * active. Queries inside the transaction use the raw connection passed to the
 * callback and therefore stay inside the same BEGIN/COMMIT boundary.
 */
function createApplicationDatabase(database: SQLiteDatabase): ApplicationDatabase {
  if (Platform.OS !== 'web') return database;

  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return new Proxy(database, {
    get(target, property) {
      if (property === 'withExclusiveTransactionAsync') {
        return (task: Parameters<SQLiteDatabase['withExclusiveTransactionAsync']>[0]) =>
          enqueue(() => target.withTransactionAsync(() => task(target as never)));
      }

      if (property === 'getFirstAsync' || property === 'getAllAsync' || property === 'runAsync') {
        const method = Reflect.get(target, property, target) as (...args: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => enqueue(() => method.apply(target, args));
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ApplicationDatabase;
}

async function openAndInitialize(): Promise<ApplicationDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  try {
    await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const applicationDatabase = createApplicationDatabase(database);
    await migrateDatabase(applicationDatabase);
    return applicationDatabase;
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
