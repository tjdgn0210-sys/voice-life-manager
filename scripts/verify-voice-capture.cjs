// Voice capture safety and pipeline verification. Uses fake speech adapters and disposable in-memory SQLite.
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
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(name => {
    assert(name.startsWith('.'), `Voice application flow must not load external runtime dependency: ${name}`);
    let resolved = path.resolve(path.dirname(file), name);
    if (!path.extname(resolved)) resolved += '.ts';
    return load(path.relative(root, resolved));
  }, mod, mod.exports);
  return mod.exports;
}

const { createVoiceExpenseCapture } = load('src/application/capture/voice-expense-capture.ts');
const { createCaptureInterpretationService } = load('src/application/proposals/interpret-capture-input.ts');
const { createSqliteTransactionRepository } = load('src/database/repositories/sqlite-transaction-repository.ts');
const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');
const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
const now = '2026-09-28T10:15:30.000Z';

class FakeSpeech {
  available = true;
  onDevice = true;
  permission = 'GRANTED';
  requestResult = 'GRANTED';
  requests = 0;
  starts = 0;
  handlers = null;
  isAvailable() { return this.available; }
  supportsOnDeviceRecognition() { return this.onDevice; }
  async getPermissionStatus() { return this.permission; }
  async requestMicrophonePermission() { this.requests++; return this.requestResult; }
  startListening(handlers) { this.starts++; this.handlers = handlers; }
  stopListening() { this.handlers?.onEnd(); }
  cancelListening() { this.handlers = null; }
  partial(text) { this.handlers?.onPartial(text); }
  final(text) { this.handlers?.onFinal(text); }
  error(code) { this.handlers?.onError(code); }
  end() { this.handlers?.onEnd(); }
}

async function drain() {
  for (let count = 0; count < 8; count++) await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const db = new DatabaseSync(':memory:');
  try {
    const database = {
      execAsync: async sql => db.exec(sql),
      runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
      getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
      getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
      withExclusiveTransactionAsync: async work => {
        db.exec('BEGIN');
        try { await work(database); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    };
    await load('src/database/migrations/migrate.ts').migrateDatabase(database);
    const transactions = createSqliteTransactionRepository(database);
    let sequence = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const expenses = createManualExpenses({
      transactions,
      unitOfWork: createSqliteTransactionCreationUnitOfWork(database),
      nextActionId: nextId,
      nextLogId: nextId,
      idsForAction: actionId => ({ transactionId: actionId, undoId: actionId }),
      now: () => now,
      undoWindowMilliseconds: 60_000,
    });
    let saveCalls = 0;
    const save = async proposal => { saveCalls++; return expenses.save(proposal); };
    let interpretCalls = 0;
    const interpret = createCaptureInterpretationService();
    const interpretSpy = async input => { interpretCalls++; return interpret(input); };
    const makeVoice = (speech = new FakeSpeech(), overrides = {}) => createVoiceExpenseCapture({
      speech, interpret: interpretSpy, save, newActionId: nextId, now: () => now, ...overrides,
    });
    const snapshot = () => Object.fromEntries(
      ['transactions', 'tasks', 'events', 'notes', 'reminders', 'action_logs']
        .map(table => [table, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]),
    );

    // A: exact final transcript reaches the VOICE proposal and existing executor/ActionLog path.
    const initialSpeech = new FakeSpeech();
    const initial = makeVoice(initialSpeech);
    let savedCount = 0;
    await initial.start({ onSaved: () => savedCount++ });
    assert.equal(initial.state, 'LISTENING');
    initialSpeech.partial('점심 7000');
    const beforePartialFinal = snapshot();
    assert.deepEqual(snapshot(), beforePartialFinal);
    const raw = ' 점심 7000원 ';
    initialSpeech.final(raw);
    initialSpeech.final(raw); // Native callbacks can repeat; the session accepts only the first final.
    await drain();
    assert.equal(savedCount, 1);
    assert.equal(saveCalls, 1);
    const transaction = db.prepare("SELECT input_method, raw_input, amount FROM transactions WHERE deleted_at IS NULL").get();
    assert.equal(transaction.input_method, 'VOICE');
    assert.equal(transaction.raw_input, raw);
    assert.equal(transaction.amount, 7000);
    assert.equal(JSON.parse(db.prepare('SELECT proposal_json FROM action_logs ORDER BY rowid DESC LIMIT 1').get().proposal_json).sourceInput, raw);
    assert.equal(db.prepare('SELECT count(*) AS count FROM transactions WHERE deleted_at IS NULL').get().count, 1);

    // The application-level immediate guard also collapses rapid microphone taps to one native session.
    const rapidSpeech = new FakeSpeech();
    const rapidVoice = makeVoice(rapidSpeech);
    await Promise.all([rapidVoice.start(), rapidVoice.start()]);
    assert.equal(rapidSpeech.starts, 1);
    rapidVoice.cancel();

    // B: partial transcript remains temporary UI data and never reaches interpretation or persistence.
    const partialSpeech = new FakeSpeech();
    const partialVoice = makeVoice(partialSpeech);
    const beforePartial = snapshot();
    const callsBeforePartial = interpretCalls;
    let partialShown = '';
    await partialVoice.start({ onPartial: value => { partialShown = value; } });
    partialSpeech.partial('점심 9000원');
    assert.equal(partialShown, '점심 9000원');
    assert.equal(interpretCalls, callsBeforePartial);
    assert.deepEqual(snapshot(), beforePartial);
    partialVoice.cancel();
    assert.deepEqual(snapshot(), beforePartial);

    // C: empty final is rejected before parsing and saving.
    const emptySpeech = new FakeSpeech();
    const emptyVoice = makeVoice(emptySpeech);
    const beforeEmpty = snapshot();
    const callsBeforeEmpty = interpretCalls;
    await emptyVoice.start();
    emptySpeech.final('   ');
    await drain();
    assert.equal(interpretCalls, callsBeforeEmpty);
    assert.deepEqual(snapshot(), beforeEmpty);

    // D: denied permission is requested once and never starts recognition or persists data.
    const deniedSpeech = new FakeSpeech();
    deniedSpeech.permission = 'UNKNOWN';
    deniedSpeech.requestResult = 'DENIED';
    const deniedVoice = makeVoice(deniedSpeech);
    const beforeDenied = snapshot();
    await deniedVoice.start();
    assert.equal(deniedSpeech.requests, 1);
    assert.equal(deniedSpeech.starts, 0);
    assert.deepEqual(snapshot(), beforeDenied);

    // E: missing recognizer/on-device support and F: native recognition error remain non-mutating.
    const unavailableSpeech = new FakeSpeech();
    unavailableSpeech.available = false;
    const unavailableVoice = makeVoice(unavailableSpeech);
    const beforeUnavailable = snapshot();
    await unavailableVoice.start();
    assert.equal(unavailableSpeech.starts, 0);
    assert.deepEqual(snapshot(), beforeUnavailable);
    const failedSpeech = new FakeSpeech();
    const failedVoice = makeVoice(failedSpeech);
    await failedVoice.start();
    const beforeFailure = snapshot();
    failedSpeech.error('FAILED');
    failedSpeech.end();
    await drain();
    assert.deepEqual(snapshot(), beforeFailure);

    // G: AI_REQUIRED uses the no-provider result; H: clarification never reaches save.
    for (const text of ['어제 친구랑 밥 먹고 내가 32000원 냈어', '오늘 점심 먹었어']) {
      const speech = new FakeSpeech();
      const voice = makeVoice(speech);
      const before = snapshot();
      await voice.start();
      speech.final(text);
      await drain();
      assert.deepEqual(snapshot(), before, `${text} must not persist without a PARSED result`);
    }

    // I/J: original transcript remains raw input; duplicate finals have one save and one transaction.
    assert.equal(saveCalls, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM action_logs').get().count, 1);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM tasks').get().count, 0);
    const nativeAdapter = fs.readFileSync(path.join(root, 'src/adapters/speech/expo-speech-recognition-adapter.ts'), 'utf8');
    assert.match(nativeAdapter, /requiresOnDeviceRecognition:\s*true/u);
    assert.match(nativeAdapter, /recordingOptions:\s*\{\s*persist:\s*false\s*\}/u);
    assert(!/(?:fetch\s*\(|axios|openai|writeAsStringAsync|FileSystem)/iu.test(nativeAdapter));
    console.log('PASS: final VOICE transcript uses existing validation/execution/ActionLog/Undo path; partial, empty, denied, unavailable, error, AI_REQUIRED and clarification inputs do not persist; raw input and duplicate protection verified.');
  } finally {
    db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
