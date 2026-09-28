// Development-only parser and TEXT capture check; uses disposable in-memory SQLite.
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
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = name => {
    assert(name.startsWith('.'), `Unexpected runtime dependency: ${name}`);
    let resolved = path.resolve(path.dirname(file), name);
    if (!path.extname(resolved)) resolved += '.ts';
    return load(path.relative(root, resolved));
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}

const { parseExpenseTextCommand } = load('src/application/proposals/parse-expense-text-command.ts');
const now = '2026-09-28T10:15:30.000Z';
let id = 0;
const parsed = (text, amount, category, memo) => {
  const result = parseExpenseTextCommand(text, `text-${++id}`, now);
  assert.equal(result.status, 'PARSED', `${text} should parse`);
  assert.equal(result.proposal.type, 'CREATE_TRANSACTION');
  assert.equal(result.proposal.inputMethod, 'TEXT');
  assert.equal(result.proposal.sourceInput, text);
  assert.equal(result.proposal.payload.transactionType, 'EXPENSE');
  assert.equal(result.proposal.payload.currencyCode, 'KRW');
  assert.equal(result.proposal.payload.amount, amount);
  assert.equal(result.proposal.payload.category, category);
  assert.equal(result.proposal.payload.memo, memo);
  assert.equal(result.proposal.payload.occurredAt, now);
  return result.proposal;
};

const examples = [
  ['점심 7000원', 7000, '식비', '점심'],
  ['점심 7,000원', 7000, '식비', '점심'],
  ['커피 4500원 썼어', 4500, '식비', '커피'],
  ['택시 12000원', 12000, '교통', '택시'],
  ['편의점에서 8300원 썼어', 8300, '생활', '편의점'],
  ['교통비 1500원', 1500, '교통', '교통비'],
  ['1만원', 10000, null, null],
  ['1만2천원', 12000, null, null],
  ['7천원', 7000, null, null],
];
for (const item of examples) parsed(...item);
assert.deepEqual(parseExpenseTextCommand('오늘 점심 먹었어', 'clarify', now),
  { status: 'NEEDS_CLARIFICATION', message: '금액을 입력해 주세요.' });
assert.deepEqual(parseExpenseTextCommand('뭔가 돈 좀 썼어', 'clarify', now),
  { status: 'NEEDS_CLARIFICATION', message: '금액을 입력해 주세요.' });
assert.equal(parseExpenseTextCommand('날씨가 좋네', 'unsupported', now).status, 'UNSUPPORTED');
assert.equal(parseExpenseTextCommand('월급 200만원 받았어', 'income', now).status, 'UNSUPPORTED');
assert.equal(parseExpenseTextCommand('어제 점심 7000원', 'dated', now).status, 'UNSUPPORTED');
assert.equal(parseExpenseTextCommand('점심 7000원 커피 4500원', 'multiple', now).status, 'UNSUPPORTED');
// Parser has no persistence/API path: the module graph is limited to pure proposal/category modules.
assert(!fs.readFileSync(path.join(root, 'src/application/proposals/parse-expense-text-command.ts'), 'utf8').includes('sqlite'));
console.log('PASS: Korean amount formats, category/memo mapping, missing amount, unsupported/date/income/multiple-value cases and exact source input.');

async function main() {
  const db = new DatabaseSync(':memory:');
  try {
    const api = {
      execAsync: async sql => db.exec(sql),
      runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
      getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
      getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
      withExclusiveTransactionAsync: async work => {
        db.exec('BEGIN');
        try { await work(api); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    };
    await load('src/database/migrations/migrate.ts').migrateDatabase(api);
    const transactions = load('src/database/repositories/sqlite-transaction-repository.ts').createSqliteTransactionRepository(api);
    const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');
    const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
    const { createTransactionUndo } = load('src/application/undo/undo-created-transaction.ts');
    let sequence = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const dependencies = {
      transactions,
      unitOfWork: createSqliteTransactionCreationUnitOfWork(api),
      nextActionId: nextId,
      nextLogId: nextId,
      idsForAction: actionId => ({ transactionId: actionId, undoId: actionId }),
      now: () => now,
      undoWindowMilliseconds: 60_000,
    };
    const expenses = createManualExpenses(dependencies);

    // Parser output goes through the same existing service, validator, executor, UoW and repositories.
    const proposal = parseExpenseTextCommand('커피 4500원 썼어', nextId(), now).proposal;
    const saved = await expenses.save(proposal);
    assert.equal(saved.validation.status, 'VALID');
    assert.equal(saved.outcome.result.status, 'SUCCESS');
    const entity = await transactions.findById(saved.outcome.result.affectedEntityId);
    assert.equal(entity.amount, 4500);
    assert.equal(entity.inputMethod, 'TEXT');
    assert.equal(entity.rawInput, '커피 4500원 썼어');
    const log = db.prepare('SELECT proposal_json FROM action_logs ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
    assert.equal(JSON.parse(log.proposal_json).sourceInput, '커피 4500원 썼어');
    assert.equal((await expenses.undo(saved.outcome.undoRecord.undoId)).status, 'SUCCESS');
    assert.equal(await transactions.findById(entity.id), null);
    console.log('PASS: TEXT proposal persists through the existing executor/SQLite/ActionLog path and existing Undo reverses it.');

    // Exercise Home's actual submit callback twice before any render can update disabled state.
    const jsx = (type, props) => ({ type, props });
    let homeStateIndex = 0;
    const mockModules = {
      react: { useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => {
        const index = homeStateIndex++;
        return [index === 4 ? '점심 7000원' : typeof value === 'function' ? value() : value, () => {}];
      } },
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'expo-router': { router: { push() {} }, useFocusEffect() {} },
      'react-native': { ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View' },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../domain/transaction/transaction': {},
      '../capture/expense-context': { useExpenses: () => expenses },
      '../capture/expense-styles': { expenseStyles: {} },
      '../../application/proposals/parse-expense-text-command': { parseExpenseTextCommand },
      './expense-undo-feedback': { ExpenseUndoFeedback: 'ExpenseUndoFeedback' },
    };
    const homeFile = path.join(root, 'src/features/home/home-screen.tsx');
    const homeCode = ts.transpileModule(fs.readFileSync(homeFile, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const homeModule = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${homeCode}\n})`, { filename: homeFile })(name => {
      assert(name in mockModules, `Unexpected Home import: ${name}`);
      return mockModules[name];
    }, homeModule, homeModule.exports);
    const tree = homeModule.exports.HomeScreen();
    const header = tree.props.children.props.ListHeaderComponent;
    function find(node, type) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === type) return node;
      for (const child of [node.props?.children, node.props?.ListHeaderComponent].flat(Infinity)) {
        const result = find(child, type);
        if (result) return result;
      }
      return null;
    }
    const submit = find(header, 'Pressable').props.onPress;
    // Check immediate double submission with a deferred save and stable one-action execution.
    const originalSave = expenses.save;
    let saves = 0;
    expenses.save = async proposal => {
      saves++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return originalSave(proposal);
    };
    // The first handler synchronously locks before the second rapid press.
    await Promise.all([submit(), submit()]);
    await new Promise(resolve => setTimeout(resolve, 15));
    expenses.save = originalSave;
    assert.equal(saves, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM transactions WHERE input_method='TEXT' AND deleted_at IS NULL").get().count, 1);
    console.log('PASS: Home text submit prevents repeated rapid submission before rerender.');
  } finally {
    db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
