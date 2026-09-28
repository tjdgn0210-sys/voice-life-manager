// Development-only: node scripts/verify-transaction-execution.cjs (Node 22.13+).
// Uses real repositories/migrations and disposable in-memory SQLite; no app DB or native APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = name => {
    assert(name.startsWith('.'), 'Application flow must not import a native runtime');
    return load(path.resolve(path.dirname(file), name) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}
const { validateCreateTransaction } = load('src/application/validator/validate-create-transaction.ts');
const { createTransactionExecutor } = load('src/application/executor/create-transaction-executor.ts');
const timestamp = '2026-09-28T02:00:00.000Z';
const occurredAt = '2026-09-28T01:00:00.000Z';
const proposal = (id, changes = {}) => ({ actionId:id, type:'CREATE_TRANSACTION', sourceInput:'점심 8천원', inputMethod:'VOICE', dependsOnActionIds:[], payload:{transactionType:'EXPENSE', amount:8000, currencyCode:'KRW', category:null, memo:null, occurredAt, ...changes} });

async function main() {
  const db = new DatabaseSync(':memory:');
  let rejectCommit = false;
  const api = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql,...params) => db.prepare(sql).run(...params),
    getFirstAsync: async (sql,...params) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql,...params) => db.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async work => {
      db.exec('BEGIN');
      try { await work(api); if (rejectCommit) throw Error('simulated commit failure'); db.exec('COMMIT'); }
      catch(error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  try {
    await load('src/database/migrations/migrate.ts').migrateDatabase(api);
    const transactions = load('src/database/repositories/sqlite-transaction-repository.ts').createSqliteTransactionRepository(api);
    const actionLogs = load('src/database/repositories/sqlite-action-log-repository.ts').createSqliteActionLogRepository(api);
    const stableIds = new Map();
    let sequence = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
    const idsForAction = id => {
      if (!stableIds.has(id)) stableIds.set(id, { transactionId:nextId(), undoId:nextId() });
      return stableIds.get(id);
    };
    const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');
    // Fail if the implementation accidentally uses the outer connection instead of the scoped handle.
    const unitOfWork = createSqliteTransactionCreationUnitOfWork({
      ...api,
      getFirstAsync: async () => { throw Error('Outer connection read is forbidden'); },
      getAllAsync: async () => { throw Error('Outer connection read is forbidden'); },
      runAsync: async () => { throw Error('Outer connection write is forbidden'); },
    });
    const deps = {unitOfWork, idsForAction, nextLogId:nextId, now:()=>timestamp, undoWindowMilliseconds:60000};
    const executor = createTransactionExecutor(deps);
    const execute = (p, instance=executor) => instance.execute(p,validateCreateTransaction(p));
    for (const amount of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'8000']) {
      assert.equal(validateCreateTransaction(proposal('invalid',{amount})).status,'INVALID');
    }
    for (const field of ['amount','occurredAt','currencyCode','transactionType']) {
      for (const value of [null,undefined]) {
        const checked=validateCreateTransaction(proposal('missing',{[field]:value}));
        assert.equal(checked.status,'NEEDS_CLARIFICATION');
        assert(checked.clarifications.some(q=>q.field===`payload.${field}` && q.actionId==='missing' && q.question));
      }
    }
    for (const input of [null,{}, {...proposal('bad'),type:'CREATE_TASK'}, {...proposal('bad'),inputMethod:'OTHER'}, {...proposal('bad'),dependsOnActionIds:['bad']}, {...proposal('bad'),payload:null}, proposal('bad',{transactionType:'OTHER'}), proposal('bad',{currencyCode:'krw'}), proposal('bad',{occurredAt:'2026-02-30T01:00:00Z'}), proposal('bad',{occurredAt:'tomorrow'}), proposal('bad',{occurredAt:'2026-09-28T10:00:00+09:00'})]) {
      assert.equal(validateCreateTransaction(input).status,'INVALID');
    }
    assert.equal(validateCreateTransaction(proposal('seconds',{occurredAt:'2026-09-28T01:00:00Z'})).status,'VALID');
    assert.equal((await execute(proposal('zero',{amount:0}))).result.status,'FAILED');
    assert.equal((await execute(proposal('missing',{amount:null}))).result.status,'PENDING_CLARIFICATION');
    assert.equal((await execute({...proposal('dependent'),dependsOnActionIds:['another']})).result.status,'SKIPPED_DEPENDENCY');
    assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM action_logs').get().n,0);
    console.log('PASS: valid shape checks, positive safe integers, missing-field questions, UTC dates, invalid structures and blocked dependencies.');

    const expense=proposal('expense');
    assert.deepEqual(validateCreateTransaction(expense),{actionId:'expense',status:'VALID'});
    const result=await execute(expense);
    assert.equal(result.result.status,'SUCCESS');
    const transaction=await transactions.findById(idsForAction('expense').transactionId);
    assert.deepEqual(transaction,{id:idsForAction('expense').transactionId,type:'EXPENSE',amount:8000,currencyCode:'KRW',category:null,memo:null,occurredAt,inputMethod:'VOICE',rawInput:expense.sourceInput,createdAt:timestamp,updatedAt:timestamp,deletedAt:null});
    const [log]=await actionLogs.findRecent(1);
    assert.equal(log.proposal.actionId,'expense');
    assert.equal(log.executionResult.status,'SUCCESS');
    assert.equal(log.executionResult.affectedEntityId,transaction.id);
    assert.equal(result.undoRecord.actionId,'expense');
    assert.equal(result.undoRecord.affectedEntityId,transaction.id);
    assert.deepEqual(result.undoRecord.reversalData,{});
    assert.deepEqual(result.undoRecord.affectedReminderIds,[]);
    assert.equal(result.undoRecord.reversibleUntil,'2026-09-28T02:01:00.000Z');
    assert.equal('pendingActionLog' in result,false);
    assert.equal((await execute(proposal('income',{transactionType:'INCOME',amount:10000,currencyCode:'USD'}))).result.status,'SUCCESS');
    assert((await transactions.listRecent(10)).every(t=>t.amount>0));
    console.log('PASS: EXPENSE/INCOME execution, positive persisted amounts, deterministic IDs/time, durable log and minimal Undo record.');

    const pending=proposal('concurrent');
    const first=execute(pending);
    const second=execute(pending);
    assert.equal(first,second);
    assert.equal((await execute({...pending,payload:{...pending.payload,amount:9000}})).result.errorCode,'ACTION_ID_CONFLICT');
    await first;
    const retried=await execute(pending);
    assert.equal(retried.result.status,'SUCCESS');
    assert.equal(db.prepare('SELECT count(*) n FROM transactions WHERE id=?').get(idsForAction('concurrent').transactionId).n,1);
    const restarted=createTransactionExecutor({...deps,now:()=> '2026-09-28T02:00:30.000Z'});
    const replay=await execute(pending,restarted);
    assert.equal(replay.result.status,'SUCCESS');
    assert.equal(replay.undoRecord.reversibleUntil,'2026-09-28T02:01:00.000Z');
    assert.equal((await execute(proposal('concurrent',{amount:9000}))).result.errorCode,'ACTION_ID_CONFLICT');
    console.log('PASS: shared in-flight work, stable-ID retry/replay without duplicate entities, conflict rejection and no Undo-window extension.');

    const counts = () => ({
      transactions: db.prepare('SELECT count(*) n FROM transactions').get().n,
      logs: db.prepare('SELECT count(*) n FROM action_logs').get().n,
    });
    const beforeWrite = counts();
    db.exec("CREATE TRIGGER test_reject_transaction BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT, 'simulated transaction insert failure'); END");
    const writeFailure=await execute(proposal('write-failure'));
    assert.equal(writeFailure.result.status,'FAILED');
    assert.equal(writeFailure.result.errorCode,'TRANSACTION_PERSISTENCE_FAILED');
    assert.equal(await transactions.findById(idsForAction('write-failure').transactionId),null);
    assert.equal(writeFailure.undoRecord,null);
    assert.deepEqual(counts(),beforeWrite);
    db.exec('DROP TRIGGER test_reject_transaction');

    const beforeLog = counts();
    db.exec("CREATE TRIGGER test_reject_log BEFORE INSERT ON action_logs BEGIN SELECT RAISE(ABORT, 'simulated log insert failure'); END");
    const rolledBack=await execute(proposal('log-failure'));
    assert.equal(rolledBack.result.status,'FAILED');
    assert.equal(rolledBack.result.errorCode,'ACTION_LOG_PERSISTENCE_FAILED');
    assert.equal(await transactions.findById(rolledBack.result.affectedEntityId),null);
    assert.equal(rolledBack.undoRecord,null);
    assert.deepEqual(counts(),beforeLog);
    // An unsuccessful replay cannot delete a previously committed transaction/evidence.
    const failedReplay=await execute(expense);
    assert.equal(failedReplay.result.status,'FAILED');
    assert.equal(failedReplay.undoRecord,null);
    assert.deepEqual(counts(),beforeLog);
    assert(await transactions.findById(transaction.id));
    db.exec('DROP TRIGGER test_reject_log');
    const successfulRetry = await execute(proposal('log-failure'));
    assert.equal(successfulRetry.result.status,'SUCCESS');
    assert(successfulRetry.undoRecord);
    assert.equal(db.prepare('SELECT count(*) n FROM transactions WHERE id=?').get(rolledBack.result.affectedEntityId).n,1);
    assert((await actionLogs.findRecent(100)).some(l=>l.proposal.actionId==='log-failure' && l.executionResult.status==='SUCCESS'));
    const afterRetry = counts();
    assert.equal(afterRetry.transactions,beforeLog.transactions+1);
    assert.equal(afterRetry.logs,beforeLog.logs+1);
    assert.equal((await execute(proposal('log-failure'))).result.status,'SUCCESS');
    assert.equal(counts().transactions,afterRetry.transactions);

    const beforeCommit = counts();
    rejectCommit = true;
    const commitFailure = await execute(proposal('commit-failure'));
    rejectCommit = false;
    assert.equal(commitFailure.result.status,'FAILED');
    assert.equal(commitFailure.result.errorCode,'ATOMIC_COMMIT_FAILED');
    assert.equal(commitFailure.undoRecord,null);
    assert.deepEqual(counts(),beforeCommit);
    assert.equal(await transactions.findById(idsForAction('commit-failure').transactionId),null);
    const failLookup=createTransactionExecutor({...deps,unitOfWork:{run:work=>unitOfWork.run(repositories=>work({
      ...repositories,transactions:{...repositories.transactions,findById:async()=>{throw Error('read');}},
    }))}});
    assert.equal((await execute(proposal('lookup'),failLookup)).result.errorCode,'TRANSACTION_LOOKUP_FAILED');
    console.log('PASS: real SQLite insert failures roll back both writes; commit failure returns FAILED; retries preserve one transaction; no out-of-transaction failure logging.');
    const badClock=createTransactionExecutor({...deps,now:()=> 'invalid'});
    assert.equal((await execute(proposal('clock'),badClock)).result.errorCode,'EXECUTION_SETUP_FAILED');
    const stale=proposal('stale');
    const validation=validateCreateTransaction(stale);
    stale.payload.amount=-1;
    assert.equal((await executor.execute(stale,validation)).result.status,'FAILED');
    assert.equal((await executor.execute(proposal('no-validation'),{actionId:'other',status:'VALID'})).result.errorCode,'VALIDATION_REQUIRED');
    const mutable=proposal('mutable');
    const immutableWrite=execute(mutable);
    mutable.payload.amount=999999;
    mutable.sourceInput='changed after call';
    const immutableResult=await immutableWrite;
    assert.equal((await transactions.findById(immutableResult.result.affectedEntityId)).amount,8000);
    console.log('PASS: setup errors, stale validation rejection, input snapshot isolation and transaction-scoped repository reuse.');
  } finally {db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
