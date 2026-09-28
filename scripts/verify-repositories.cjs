// Development-only: node scripts/verify-repositories.cjs (Node 22.13+).
// Actual repository SQL against an in-memory SQLite database, never the app database.
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
  const localRequire = specifier => {
    assert(specifier.startsWith('.'), 'No runtime framework/native imports in repositories');
    return load(path.resolve(path.dirname(file), specifier) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}
const early = '2026-09-28T01:00:00.000Z';
const later = '2026-09-28T02:00:00.000Z';
const common = { createdAt: early, updatedAt: early, deletedAt: null };
const ids = rows => rows.map(row => row.id);

async function main() {
  const db = new DatabaseSync(':memory:');
  const api = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
    getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async work => {
      db.exec('BEGIN');
      try { await work(api); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  try {
    await load('src/database/migrations/migrate.ts').migrateDatabase(api);
    const repo = {};
    for (const [name, entity] of [['transaction','Transaction'],['task','Task'],['event','Event'],['note','Note'],['reminder','Reminder'],['action-log','ActionLog']]) {
      repo[name] = load(`src/database/repositories/sqlite-${name}-repository.ts`)[`createSqlite${entity}Repository`](api);
    }
    const transaction = { ...common, id:'t1', type:'EXPENSE', amount:8000, currencyCode:'KRW', category:null, memo:"Lunch'; DROP TABLE notes; --", occurredAt:early, inputMethod:'VOICE', rawInput:'점심 8천원' };
    const tr = repo.transaction;
    await tr.create(transaction);
    assert.deepEqual(await tr.findById('t1'), transaction);
    await tr.create({ ...transaction, id:'t2', occurredAt:later, type:'INCOME', amount:10000 });
    assert.deepEqual(ids(await tr.listRecent(10)), ['t2','t1']);
    assert.deepEqual(ids(await tr.listRecent(1)), ['t2']);
    assert.deepEqual(await tr.listRecent(0), []);
    for (const limit of [-1, 1.5, NaN, Infinity]) await assert.rejects(tr.listRecent(limit), RangeError);
    const changedTransaction = { ...transaction, amount:9000, category:'Food', memo:'updated', updatedAt:later };
    assert.equal(await tr.update({ ...changedTransaction, createdAt:later }), true);
    assert.deepEqual(await tr.findById('t1'), changedTransaction);
    await assert.rejects(tr.update({ ...transaction, amount:-1 }));
    assert.equal((await tr.findById('t1')).amount, 9000);
    assert.equal(await tr.update({ ...transaction, id:'missing' }), false);
    assert.equal(await tr.findById('missing'), null);
    assert.equal(await tr.softDelete('t1', later), true);
    assert.equal(await tr.findById('t1'), null);
    assert.deepEqual(ids(await tr.listRecent(10)), ['t2']);
    assert.equal(await tr.update(transaction), false);
    assert.equal(await tr.softDelete('t1', later), false);
    assert.deepEqual({ ...db.prepare("SELECT deleted_at, updated_at FROM transactions WHERE id='t1'").get() }, {deleted_at:later, updated_at:later});
    console.log('PASS: transactions round-trip, parameter binding, ordering/limits, update, immutable creation time, constraints and soft deletion.');

    const task = { ...common, id:'task1', title:'Task', dueAt:early, status:'OPEN', completedAt:null, sourceActionId:'action1' };
    const tasks = repo.task;
    await tasks.create(task);
    assert.deepEqual(await tasks.findById(task.id), task);
    await tasks.create({ ...task, id:'undated', dueAt:null });
    await tasks.create({ ...task, id:'later', dueAt:later });
    await tasks.create({ ...task, id:'completed', status:'COMPLETED', completedAt:later });
    await tasks.create({ ...task, id:'cancelled', status:'CANCELLED' });
    assert.deepEqual(ids(await tasks.listActive()), ['task1','later','undated']);
    assert.equal(await tasks.update({ ...task, title:'Updated', status:'COMPLETED', completedAt:later, updatedAt:later }), true);
    assert.equal((await tasks.findById('task1')).completedAt, later);
    assert.deepEqual(ids(await tasks.listActive()), ['later','undated']);
    assert.equal(await tasks.softDelete('later', later), true);
    assert.equal(await tasks.findById('later'), null);
    assert.deepEqual(ids(await tasks.listActive()), ['undated']);
    assert.equal(await tasks.update({ ...task, id:'missing' }), false);
    assert.equal(await tasks.softDelete('missing', later), false);
    console.log('PASS: tasks active-status filtering, dated-first ordering, updates and soft-delete exclusion.');

    const event = { ...common, id:'exact', title:'Meeting', kind:'EXACT', startAt:early, fuzzyTime:null, endAt:later, timezone:'Asia/Seoul', location:null, status:'UPCOMING', sourceActionId:'a-event' };
    const fuzzy = { ...event, id:'fuzzy', kind:'FUZZY', startAt:null, fuzzyTime:'저녁쯤', endAt:null };
    const events = repo.event;
    await events.create(event);
    await events.create(fuzzy);
    assert.deepEqual(await events.findById('exact'), event);
    assert.deepEqual(await events.findById('fuzzy'), fuzzy);
    await events.create({ ...event, id:'past', status:'PAST' });
    assert.deepEqual(ids(await events.listUpcoming()), ['exact','fuzzy']);
    // A timestamp in the past is still UPCOMING if stored that way: no lifecycle logic here.
    assert.equal((await events.findById('exact')).status, 'UPCOMING');
    const moved = { ...event, kind:'FUZZY', startAt:null, fuzzyTime:'내일 저녁', location:'강남', updatedAt:later };
    assert.equal(await events.update(moved), true);
    assert.deepEqual(await events.findById('exact'), moved);
    await assert.rejects(events.update({ ...event, startAt:null, fuzzyTime:null }));
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE events SET fuzzy_time=NULL WHERE id='exact'").run();
    db.exec('PRAGMA ignore_check_constraints = OFF');
    await assert.rejects(events.findById('exact'), /Invalid persisted Event/);
    await assert.rejects(events.listUpcoming(), /Invalid persisted Event/);
    assert.equal(await events.update(event), true);
    assert.equal(await events.softDelete('exact', later), true);
    assert.equal(await events.findById('exact'), null);
    assert.deepEqual(ids(await events.listUpcoming()), ['fuzzy']);
    console.log('PASS: EXACT/FUZZY round-trips, explicit-status query, full updates, corrupt shape rejection and soft deletion.');

    const note = { ...common, id:'n1', content:'메모', tags:['한글','quote"',''], inputMethod:'TEXT', rawInput:null };
    const notes = repo.note;
    await notes.create(note);
    assert.deepEqual(await notes.findById('n1'), note);
    await notes.create({ ...note, id:'n2', createdAt:later, tags:[] });
    assert.deepEqual(ids(await notes.listRecent(10)), ['n2','n1']);
    const edited = { ...note, content:'edited', tags:['new'], updatedAt:later };
    assert.equal(await notes.update(edited), true);
    assert.deepEqual(await notes.findById('n1'), edited);
    for (const corrupt of ['broken', '{}', '["ok",1]', 'null']) {
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.prepare("UPDATE notes SET tags_json=? WHERE id='n1'").run(corrupt);
      db.exec('PRAGMA ignore_check_constraints = OFF');
      assert.deepEqual((await notes.findById('n1')).tags, []);
      assert.equal(db.prepare("SELECT tags_json FROM notes WHERE id='n1'").get().tags_json, corrupt);
    }
    assert.equal(await notes.softDelete('n1', later), true);
    assert.equal(await notes.findById('n1'), null);
    assert.deepEqual(ids(await notes.listRecent(10)), ['n2']);
    console.log('PASS: notes JSON round-trip, recent ordering, updates, safe corrupt-tag fallback without rewriting and soft deletion.');

    const reminder = { id:'r1', targetType:'EVENT', targetId:'fuzzy', fireAt:later, timezone:'Asia/Seoul', relativeOffsetMinutes:-60, status:'SCHEDULED', deliveryMode:'LOCAL', createdAt:early, updatedAt:early, cancelledAt:null };
    const reminders = repo.reminder;
    await reminders.create(reminder);
    assert.deepEqual(await reminders.findById('r1'), reminder);
    await reminders.create({ ...reminder, id:'r2', status:'REQUESTED', fireAt:early, relativeOffsetMinutes:null });
    assert.deepEqual(ids(await reminders.listScheduled()), ['r1']);
    assert.deepEqual(ids(await reminders.findByTarget('EVENT','fuzzy')), ['r2','r1']);
    assert.deepEqual(await reminders.findByTarget('TASK','fuzzy'), []);
    const cancelled = { ...reminder, status:'CANCELLED', cancelledAt:later, updatedAt:later };
    assert.equal(await reminders.update(cancelled), true);
    assert.deepEqual(await reminders.findById('r1'), cancelled);
    assert.deepEqual(await reminders.listScheduled(), []);
    await assert.rejects(reminders.update({ ...reminder, status:'CANCELLED', cancelledAt:null }));
    assert.equal((await reminders.findById('r1')).status,'CANCELLED');
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE reminders SET cancelled_at=NULL WHERE id='r1'").run();
    db.exec('PRAGMA ignore_check_constraints = OFF');
    await assert.rejects(reminders.findById('r1'), /Invalid persisted Reminder/);
    await reminders.update(cancelled);
    assert.equal(await reminders.findById('missing'), null);
    assert.equal(await reminders.update({ ...reminder, id:'missing' }), false);
    console.log('PASS: reminders round-trip, scheduled/target queries, cancellation update and corrupt-state rejection; no scheduling side effects.');

    const logs = repo['action-log'];
    const proposal = { actionId:'a1', type:'CREATE_NOTE', sourceInput:'메모', inputMethod:'TEXT', dependsOnActionIds:[], payload:{content:'메모',tags:[]} };
    const log = { id:'l1', rawInput:'메모', proposal, validationResult:{actionId:'a1',status:'VALID'}, executionResult:{actionId:'a1',status:'SUCCESS',affectedEntityId:'n1'}, createdAt:early };
    await logs.append(log);
    assert.deepEqual(await logs.findRecent(10), [log]);
    const newer = { ...log, id:'l2', createdAt:later, validationResult:null, executionResult:null };
    await logs.append(newer);
    assert.deepEqual(await logs.findRecent(10), [newer,log]);
    assert.deepEqual(await logs.findRecent(1), [newer]);
    assert.deepEqual(Object.keys(logs).sort(), ['append','findRecent']);
    await assert.rejects(logs.append({ ...log, rawInput:'replace attempt' }));
    assert.throws(() => db.exec("UPDATE action_logs SET raw_input='changed'"), /append-only/);
    await assert.rejects(logs.append({ ...log, id:'non-json', proposal:{...proposal,payload:{amount:NaN}} }), /JSON-serializable/);
    for (const [column, corrupt] of [
      ['proposal_json','broken'], ['proposal_json','{}'], ['proposal_json','[]'],
      ['validation_result_json','broken'], ['validation_result_json','{"actionId":"a1","status":"UNKNOWN"}'],
      ['execution_result_json','broken'], ['execution_result_json','{"actionId":"a1","status":"FAILED","affectedEntityId":null}'],
    ]) {
      db.exec('PRAGMA ignore_check_constraints = ON');
      const row = { proposal_json:JSON.stringify(proposal),validation_result_json:null,execution_result_json:null,[column]:corrupt };
      db.prepare('INSERT INTO action_logs (id,raw_input,proposal_json,validation_result_json,execution_result_json,created_at) VALUES (?,?,?,?,?,?)').run('corrupt','private input',row.proposal_json,row.validation_result_json,row.execution_result_json,later);
      db.exec('PRAGMA ignore_check_constraints = OFF');
      await assert.rejects(logs.findRecent(10), /Invalid ActionLog evidence/);
      db.prepare('DELETE FROM action_logs WHERE id=?').run('corrupt');
    }
    console.log('PASS: append-only logs, JSON round-trip/nulls/order, duplicate-insert rejection, DB update protection and explicit corruption errors.');
    db.close();
    await assert.rejects(tr.listRecent(1));
    console.log('PASS: database errors propagate; no real application database opened.');
  } finally { if (db.isOpen) db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
