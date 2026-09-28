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
    const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
    const { initialExpenseForm, expenseProposal, localOccurrence } = load('src/features/capture/expense-form.ts');
    const manual = createManualExpenses({ ...deps, transactions, nextActionId:nextId });
    const form = { ...initialExpenseForm(timestamp), amount:'7000', date:'2020-01-02', time:'12:34' };
    const manualProposal = expenseProposal(manual.newActionId(), form);
    const manualSaved = await manual.save(manualProposal);
    assert.equal(manualSaved.outcome.result.status,'SUCCESS');
    assert(manualSaved.outcome.undoRecord);
    const manualEntity = await transactions.findById(manualSaved.outcome.result.affectedEntityId);
    assert.equal(manualEntity.amount,7000);
    assert.equal(manualEntity.inputMethod,'MANUAL');
    assert.equal(manualEntity.currencyCode,'KRW');
    assert.equal(manualEntity.category,null);
    assert.equal(manualEntity.memo,null);
    assert.equal(new Date(manualEntity.occurredAt).getHours(),12);
    assert.equal(new Date(manualEntity.occurredAt).getMinutes(),34);
    assert((await manual.list()).some(item=>item.id===manualEntity.id));
    assert((await manual.list()).every(item=>item.type==='EXPENSE'));
    const manualCounts = counts();
    await manual.save(manualProposal);
    assert.equal(counts().transactions,manualCounts.transactions);
    for (const amount of ['0','-1','1.5','7,000','1e3','words']) {
      assert.equal((await manual.save(expenseProposal(nextId(), {...form,amount}))).validation.status,'INVALID');
    }
    assert.equal((await manual.save(expenseProposal(nextId(), {...form,amount:''}))).validation.status,'NEEDS_CLARIFICATION');
    assert.equal((await manual.save(expenseProposal(nextId(), {...form,date:''}))).validation.status,'NEEDS_CLARIFICATION');
    for (const [date,time] of [['2026-02-30','12:00'],['2026-09-28','25:00'],['2026/09/28','12:00']]) {
      assert.equal(validateCreateTransaction(expenseProposal(nextId(), {...form,date,time})).status,'INVALID');
    }
    assert.equal(localOccurrence('2026-09-28',''),null);
    // Exercise the outside-window branch with real SQLite rows and repository reads.
    for (let i=0;i<101;i++) await transactions.create({...manualEntity,id:nextId(),occurredAt:timestamp});
    assert(!(await transactions.listRecent(100)).some(item=>item.id===manualEntity.id));
    assert.equal((await manual.list())[0].id,manualEntity.id);
    const beforeManualFailure = counts();
    rejectCommit = true;
    assert.equal((await manual.save(expenseProposal(nextId(), form))).outcome.result.status,'FAILED');
    rejectCommit = false;
    assert.deepEqual(counts(),beforeManualFailure);
    assert.equal((await manual.list())[0].id,manualEntity.id);
    console.log('PASS: manual form -> validator -> atomic executor -> repository list, stable retry, invalid input, local date conversion, backdated refresh and failed-save state.');
    const { createTransactionUndo } = load('src/application/undo/undo-created-transaction.ts');
    let undoNow = timestamp;
    const undoDeps = {...deps,transactions,nextActionId:nextId,now:()=>undoNow};
    const undoExecutor = createTransactionUndo(undoDeps);
    // Create through the same facade used by the screens, with an injectable clock.
    const undoSession = createManualExpenses(undoDeps);
    async function newUndoTarget() {
      undoNow = timestamp;
      const value = await undoSession.save(expenseProposal(nextId(),form));
      assert.equal(value.outcome.result.status,'SUCCESS');
      return value.outcome.undoRecord;
    }
    const record = await newUndoTarget();
    const originalLog = (await actionLogs.findRecent(1000)).find(log=>log.proposal.actionId===record.actionId);
    const beforeUndo = counts();
    undoNow = '2026-09-28T02:00:30.000Z';
    assert.equal((await undoSession.undo(record.undoId)).status,'SUCCESS');
    assert.equal(await transactions.findById(record.affectedEntityId),null);
    assert(!(await undoSession.list()).some(item=>item.id===record.affectedEntityId));
    assert.equal(db.prepare('SELECT deleted_at FROM transactions WHERE id=?').get(record.affectedEntityId).deleted_at,undoNow);
    assert.deepEqual(counts(),{transactions:beforeUndo.transactions,logs:beforeUndo.logs+1});
    const undoLog = (await actionLogs.findRecent(1000)).find(log=>log.proposal.payload.undoOf?.undoId===record.undoId);
    assert.equal(undoLog.proposal.type,'DELETE_TRANSACTION');
    assert.equal(undoLog.proposal.payload.undoOf.actionId,record.actionId);
    assert.equal(undoLog.executionResult.status,'SUCCESS');
    assert.notEqual(undoLog.proposal.actionId,record.actionId);
    assert.deepEqual((await actionLogs.findRecent(1000)).find(log=>log.id===originalLog.id),originalLog);
    assert.equal(undoSession.feedback().status,'UNDONE');
    assert.equal((await undoExecutor(record)).status,'UNAVAILABLE');
    assert.equal((await undoSession.undo(record.undoId)).status,'UNAVAILABLE');
    assert.equal((await undoExecutor(null)).status,'UNAVAILABLE');
    assert.equal((await undoExecutor({...record,actionType:'CREATE_TASK'})).status,'INELIGIBLE');

    const expiredRecord = await newUndoTarget();
    const beforeExpired = counts();
    undoNow = '2026-09-28T02:01:00.001Z';
    assert.equal((await undoExecutor(expiredRecord)).status,'EXPIRED');
    assert.equal(undoSession.feedback().status,'EXPIRED');
    assert.deepEqual(counts(),beforeExpired);
    assert(await transactions.findById(expiredRecord.affectedEntityId));
    const boundaryRecord = await newUndoTarget();
    undoNow = boundaryRecord.reversibleUntil;
    assert.equal((await undoExecutor(boundaryRecord)).status,'SUCCESS');
    const changedRecord = await newUndoTarget();
    const changedEntity = await transactions.findById(changedRecord.affectedEntityId);
    await transactions.update({...changedEntity,memo:'edited',updatedAt:'2026-09-28T02:00:01.000Z'});
    assert.equal((await undoExecutor(changedRecord)).status,'INELIGIBLE');
    assert(await transactions.findById(changedRecord.affectedEntityId));
    const missingAction = nextId();
    assert.equal((await undoExecutor({...record,actionId:missingAction,affectedEntityId:idsForAction(missingAction).transactionId})).status,'UNAVAILABLE');

    const rollbackRecord = await newUndoTarget();
    const beforeUndoFailure = counts();
    for (const trigger of [
      "CREATE TRIGGER test_undo_failure BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT,'delete failed'); END",
      "CREATE TRIGGER test_undo_failure BEFORE INSERT ON action_logs BEGIN SELECT RAISE(ABORT,'log failed'); END",
    ]) {
      db.exec(trigger);
      assert.equal((await undoExecutor(rollbackRecord)).status,'FAILED');
      db.exec('DROP TRIGGER test_undo_failure');
      assert(await transactions.findById(rollbackRecord.affectedEntityId));
      assert.deepEqual(counts(),beforeUndoFailure);
    }
    rejectCommit = true;
    assert.equal((await undoExecutor(rollbackRecord)).status,'FAILED');
    rejectCommit = false;
    assert(await transactions.findById(rollbackRecord.affectedEntityId));
    assert.deepEqual(counts(),beforeUndoFailure);
    const delayedExpiry = createTransactionUndo({...undoDeps,unitOfWork:{run:work=>unitOfWork.run(repositories=>work({
      ...repositories,transactions:{...repositories.transactions,findById:async id=>{
        const value=await repositories.transactions.findById(id);
        undoNow='2026-09-28T02:01:00.001Z';
        return value;
      }},
    }))}});
    assert.equal((await delayedExpiry(rollbackRecord)).status,'EXPIRED');
    assert(await transactions.findById(rollbackRecord.affectedEntityId));
    assert.deepEqual(counts(),beforeUndoFailure);
    undoNow=timestamp;
    const concurrent = await Promise.all([undoExecutor(rollbackRecord),undoExecutor(rollbackRecord)]);
    assert.deepEqual(concurrent.map(value=>value.status),['SUCCESS','BUSY']);
    assert.equal(counts().logs,beforeUndoFailure.logs+1);
    assert.equal(createManualExpenses(undoDeps).feedback(),null); // Restart has no Undo evidence.
    console.log('PASS: Undo soft deletion, separate linked evidence, expiry/boundary, missing/modified/duplicate targets, session reset and mutation/log/commit rollback.');

    // Invoke the actual UI button callback twice before a React rerender. Stub only
    // rendering/hooks/native surfaces; the application and SQLite remain real.
    const uiRecord = await newUndoTarget();
    const jsx = (type,props) => ({type,props});
    const mocks = {
      react: {useCallback:fn=>fn,useRef:value=>({current:value}),useState:value=>[typeof value==='function'?value():value,()=>{}]},
      'react/jsx-runtime': {jsx,jsxs:jsx,Fragment:'Fragment'},
      'expo-router': {useFocusEffect:()=>{}},
      'react-native': {AppState:{},Pressable:'Pressable',Text:'Text',View:'View'},
      '../capture/expense-context': {useExpenses:()=>undoSession},
      '../capture/expense-styles': {expenseStyles:{}},
    };
    const uiFile = path.join(root,'src/features/home/expense-undo-feedback.tsx');
    const uiCode = ts.transpileModule(fs.readFileSync(uiFile,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const uiModule = {exports:{}};
    vm.runInThisContext(`(function(require,module,exports){${uiCode}\n})`)(name=>{assert(name in mocks,name);return mocks[name];},uiModule,uiModule.exports);
    let refreshes = 0;
    const tree = uiModule.exports.ExpenseUndoFeedback({onResult:()=>refreshes++});
    function button(node) {
      if (!node || typeof node!=='object') return null;
      if (node.type==='Pressable') return node;
      for (const child of [node.props?.children].flat(Infinity)) {const match=button(child);if(match)return match;}
      return null;
    }
    const press = button(tree).props.onPress;
    const beforeTaps = counts();
    await Promise.all([press(),press()]);
    assert.equal(refreshes,1);
    assert.equal(counts().logs,beforeTaps.logs+1);
    assert.equal(await transactions.findById(uiRecord.affectedEntityId),null);
    assert.equal(button(uiModule.exports.ExpenseUndoFeedback({onResult:()=>{}})),null);
    await newUndoTarget();
    undoNow = '2026-09-28T02:01:01.000Z';
    assert.equal(button(uiModule.exports.ExpenseUndoFeedback({onResult:()=>{}})),null);
    console.log('PASS: actual Undo button handler rejects rapid duplicate taps, refreshes once, and renders no Undo button after success/expiry.');
  } finally {db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
