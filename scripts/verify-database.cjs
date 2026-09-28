// Development-only: node scripts/verify-database.cjs (Node 22.13+ with node:sqlite).
// Runs actual migration TypeScript/SQL against disposable SQLite databases.
// Does not load React Native, alter the application database, or require a test framework.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createLoader(expoStub, platformOS = 'ios') {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: file,
    }).outputText;
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = (specifier) => {
      if (specifier === 'expo-sqlite' && expoStub) return expoStub;
      if (specifier === 'react-native') return { Platform: { OS: platformOS } };
      if (!specifier.startsWith('.')) throw new Error(`Unexpected runtime import: ${specifier}`);
      const resolved = path.resolve(path.dirname(file), specifier);
      return load(resolved + '.ts');
    };
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

// Mirrors the async API surface used by the migration runner, with real SQLite rollback.
function adapter(db) {
  const api = {
    execAsync: async (sql) => { db.exec(sql); },
    getFirstAsync: async (sql) => db.prepare(sql).get() ?? null,
    closeAsync: async () => db.close(),
    withExclusiveTransactionAsync: async (work) => {
      db.exec('BEGIN');
      try {
        await work(api);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return api;
}

const load = createLoader();
const { migrateDatabase } = load(path.join(root, 'src/database/migrations/migrate.ts'));
const expectedTables = ['action_logs', 'events', 'notes', 'reminders', 'tasks', 'transactions'];
const now = '2026-09-28T00:00:00.000Z';

function insert(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
}

function verifyConstraints(db) {
  const common = { created_at: now, updated_at: now };
  const transaction = { ...common, id: 'txn', type: 'EXPENSE', amount: 8000, currency_code: 'KRW', occurred_at: now, input_method: 'VOICE' };
  insert(db, 'transactions', transaction);
  insert(db, 'transactions', { ...transaction, id: 'income', type: 'INCOME' });
  for (const amount of [-1, 0, 1.5, 9007199254740992]) {
    assert.throws(() => insert(db, 'transactions', { ...transaction, id: 'invalid', amount }));
  }
  assert.throws(() => insert(db, 'transactions', { ...transaction, id: 'invalid', type: 'OTHER' }));
  assert.throws(() => insert(db, 'transactions', { ...transaction, id: null }));
  const task = { ...common, id: 'task', title: 'Task', status: 'OPEN', source_action_id: 'action' };
  insert(db, 'tasks', task);
  assert.throws(() => insert(db, 'tasks', { ...task, id: 'bad', status: 'PAST' }));
  const event = { ...common, id: 'exact', title: 'Meet', time_kind: 'EXACT', start_at: now, fuzzy_time: null, timezone: 'Asia/Seoul', status: 'PAST', source_action_id: 'action' };
  insert(db, 'events', event);
  insert(db, 'events', { ...event, id: 'fuzzy', time_kind: 'FUZZY', start_at: null, fuzzy_time: 'evening' });
  for (const patch of [
    { start_at: null }, { fuzzy_time: 'evening' },
    { time_kind: 'FUZZY', start_at: null, fuzzy_time: null },
    { time_kind: 'FUZZY', start_at: null, fuzzy_time: ' ' },
    { time_kind: 'UNKNOWN' }, { status: 'OPEN' },
  ]) assert.throws(() => insert(db, 'events', { ...event, id: 'invalid', ...patch }));
  assert.equal(db.prepare("SELECT status FROM events WHERE id = 'exact'").get().status, 'PAST');
  const reminder = { ...common, id: 'reminder', target_type: 'EVENT', target_id: 'exact', fire_at: now, timezone: 'Asia/Seoul', relative_offset_minutes: -60, status: 'SCHEDULED', delivery_mode: 'LOCAL', cancelled_at: null };
  insert(db, 'reminders', reminder);
  insert(db, 'reminders', { ...reminder, id: 'cancelled', status: 'CANCELLED', cancelled_at: now, relative_offset_minutes: null });
  for (const patch of [
    { fire_at: null }, { status: 'CANCELLED' }, { cancelled_at: now },
    { relative_offset_minutes: 0.5 }, { status: 'DELIVERED' },
    { target_type: 'NOTE' }, { delivery_mode: 'PUSH' },
  ]) assert.throws(() => insert(db, 'reminders', { ...reminder, id: 'invalid', ...patch }));
  const note = { ...common, id: 'note', content: 'Remember', tags_json: '["tag"]', input_method: 'TEXT' };
  insert(db, 'notes', note);
  for (const tags_json of ['broken', '{}', 'null']) {
    assert.throws(() => insert(db, 'notes', { ...note, id: 'bad', tags_json }));
  }
  const log = { id: 'log', raw_input: 'test', proposal_json: '{"actionId":"action"}', validation_result_json: null, execution_result_json: null, created_at: now };
  insert(db, 'action_logs', log);
  for (const proposal_json of ['broken', '[]', 'null']) {
    assert.throws(() => insert(db, 'action_logs', { ...log, id: 'bad', proposal_json }));
  }
  assert.throws(() => db.exec("UPDATE action_logs SET raw_input = 'changed'"), /append-only/);
  assert(!db.prepare('PRAGMA table_info(action_logs)').all().some(c => c.name === 'updated_at'));
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
  assert.equal(indexes.length, 5);
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vlm-database-check-'));
  const filename = path.join(temporary, 'smoke.db');
  let db;
  try {
    db = new DatabaseSync(filename);
    const api = adapter(db);
    await migrateDatabase(api);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name), expectedTables);
    verifyConstraints(db);
    await migrateDatabase(api);
    assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
    db.close();
    db = new DatabaseSync(filename);
    await migrateDatabase(adapter(db));
    assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
    console.log('PASS: schema, constraints, five indexes, append-only update protection, repeat startup and data preservation after reopening.');

    db.exec('PRAGMA user_version = 2');
    await assert.rejects(migrateDatabase(adapter(db)), /newer/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    console.log('PASS: newer schema rejected without reset or downgrade.');
  } finally {
    if (db?.isOpen) db.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const isolated = new DatabaseSync(':memory:');
  try {
    const api = adapter(isolated);
    await assert.rejects(migrateDatabase(api, [{ version: 1, sql: 'CREATE TABLE rollback_probe (id TEXT); INSERT INTO missing_table VALUES (1);' }]));
    assert.equal(isolated.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(isolated.prepare("SELECT count(*) n FROM sqlite_master WHERE name='rollback_probe'").get().n, 0);
    await assert.rejects(migrateDatabase(api, [{ version: 2, sql: '' }]), /contiguous/);
    await assert.rejects(migrateDatabase(api, [{ version: 1, sql: '' }, { version: 1, sql: '' }]), /contiguous/);
    await assert.rejects(migrateDatabase(api, [{ version: 1.5, sql: '' }]), /integers/);
    const first = { version: 1, sql: 'CREATE TABLE ordering_probe (value INTEGER); INSERT INTO ordering_probe VALUES (1);' };
    await assert.rejects(migrateDatabase(api, [first, { version: 2, sql: 'INSERT INTO missing_table VALUES (2);' }]));
    assert.equal(isolated.prepare('PRAGMA user_version').get().user_version, 0);
    await migrateDatabase(api, [{ version: 2, sql: 'INSERT INTO ordering_probe VALUES (2);' }, first]);
    assert.deepEqual(isolated.prepare('SELECT value FROM ordering_probe ORDER BY rowid').all().map(r => r.value), [1, 2]);
    await migrateDatabase(api, [first, { version: 2, sql: 'THIS MUST NOT RUN' }, { version: 3, sql: 'INSERT INTO ordering_probe VALUES (3);' }]);
    assert.equal(isolated.prepare('PRAGMA user_version').get().user_version, 3);
    console.log('PASS: transactional batch rollback, ordered upgrades, invalid plans rejected, applied versions skipped.');
  } finally { isolated.close(); }

  let opens = 0;
  let closes = 0;
  let connection;
  const loadWithStub = createLoader({ openDatabaseAsync: async () => {
    opens++;
    const native = new DatabaseSync(':memory:');
    connection = native;
    const api = adapter(native);
    const exec = api.execAsync;
    api.execAsync = async sql => { if (opens === 1) throw new Error('simulated init failure'); await exec(sql); };
    api.closeAsync = async () => { closes++; native.close(); };
    return api;
  } });
  const { getDatabase } = loadWithStub(path.join(root, 'src/database/database.ts'));
  const failed = getDatabase();
  assert.equal(failed, getDatabase());
  await assert.rejects(failed, /simulated/);
  assert.equal(closes, 1);
  const retry = getDatabase();
  assert.equal(retry, getDatabase());
  await retry;
  assert.equal(opens, 2);
  assert.equal(getDatabase(), retry);
  assert.equal(connection.prepare('PRAGMA user_version').get().user_version, 1);
  connection.close();
  console.log('PASS: shared initializer promise, failed connection cleanup, explicit retry and successful connection reuse.');

  let webConnection;
  let activeWebTransaction = false;
  let overlappingWebTransactions = false;
  const loadWebWithStub = createLoader({ openDatabaseAsync: async () => {
    const native = new DatabaseSync(':memory:');
    webConnection = native;
    const api = adapter(native);
    api.getAllAsync = async sql => native.prepare(sql).all();
    api.runAsync = async (sql, ...params) => native.prepare(sql).run(...params);
    api.withTransactionAsync = async work => {
      native.exec('BEGIN');
      try { await work(); native.exec('COMMIT'); }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    };
    api.withExclusiveTransactionAsync = async () => {
      throw new Error('Native exclusive transactions must not be used on web.');
    };
    return api;
  } }, 'web');
  const { getDatabase: getWebDatabase } = loadWebWithStub(path.join(root, 'src/database/database.ts'));
  const webDatabase = await getWebDatabase();
  assert.equal(webConnection.prepare('PRAGMA user_version').get().user_version, 1);
  await Promise.all([
    webDatabase.withExclusiveTransactionAsync(async () => {
      assert.equal(activeWebTransaction, false);
      activeWebTransaction = true;
      await new Promise(resolve => setTimeout(resolve, 15));
      activeWebTransaction = false;
    }),
    webDatabase.withExclusiveTransactionAsync(async () => {
      overlappingWebTransactions ||= activeWebTransaction;
      activeWebTransaction = true;
      await new Promise(resolve => setTimeout(resolve, 5));
      activeWebTransaction = false;
    }),
  ]);
  assert.equal(overlappingWebTransactions, false);
  assert.equal(activeWebTransaction, false);
  webConnection.close();
  console.log('PASS: web database startup uses supported transactions and serializes application transactions.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
