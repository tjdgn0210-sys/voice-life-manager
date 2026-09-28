// Focused verification for the injected AI interpretation boundary. No provider or persistence adapter is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    assert(name.startsWith('.'), `Application boundary must not load external dependency: ${name}`);
    let resolved = path.resolve(path.dirname(file), name);
    if (!path.extname(resolved)) resolved += '.ts';
    return load(path.relative(root, resolved));
  }, mod, mod.exports);
  return mod.exports;
}

const { createCaptureParserInput, routeCaptureInput } = load('src/application/proposals/capture-parser-router.ts');
const { createCaptureInterpretationService } = load('src/application/proposals/interpret-capture-input.ts');
const { validateCreateTransaction } = load('src/application/validator/validate-create-transaction.ts');
const now = '2026-09-28T10:15:30.000Z';
let id = 0;
const input = text => createCaptureParserInput(text, `capture-${++id}`, 'TEXT', now);
let calls = 0;
const noCallInterpreter = { async interpret() { calls++; throw new Error('must not run'); } };
const serviceWithoutAi = createCaptureInterpretationService(noCallInterpreter);

async function main() {
  const localInput = input('점심 7000원');
  const local = await serviceWithoutAi(localInput);
  assert.equal(local.status, 'PARSED');
  assert.equal(local.source, 'LOCAL');
  assert.equal(local.proposal.sourceInput, localInput.sourceInput);
  assert.equal(calls, 0, 'local parse must not invoke interpreter');

  for (const text of ['오늘 점심 먹었어', '비트코인 가격 알려줘']) {
    const routed = routeCaptureInput(input(text));
    const result = await serviceWithoutAi(input(text));
    assert.equal(result.status, routed.status);
    assert.equal(calls, 0, `${routed.status} must not invoke interpreter`);
  }

  const aiInput = input('어제 친구랑 밥 먹고 내가 32000원 냈어');
  assert.equal(routeCaptureInput(aiInput).status, 'AI_REQUIRED');
  const validProposal = {
    actionId: aiInput.actionId,
    type: 'CREATE_TRANSACTION',
    sourceInput: aiInput.sourceInput,
    inputMethod: aiInput.inputMethod,
    dependsOnActionIds: [],
    payload: {
      transactionType: 'EXPENSE', amount: 32000, currencyCode: 'KRW',
      category: '식비', memo: '친구와 식사', occurredAt: now,
    },
  };
  const persisted = [];
  const runFake = async response => createCaptureInterpretationService({ async interpret() { calls++; return response; } })(aiInput);

  const parsed = await runFake({ status: 'PARSED', proposal: validProposal });
  assert.equal(parsed.status, 'PARSED');
  assert.equal(parsed.source, 'AI');
  assert.equal(parsed.proposal.sourceInput, aiInput.sourceInput);
  assert.deepEqual(validateCreateTransaction(parsed.proposal), { actionId: aiInput.actionId, status: 'VALID' });
  assert.equal(persisted.length, 0, 'interpretation must not persist; execution remains a separate caller responsibility');

  for (const response of [
    { status: 'NEEDS_CLARIFICATION', message: '언제 발생했나요?' },
    { status: 'UNSUPPORTED', message: '지원하지 않는 요청이에요.' },
    { status: 'FAILED', reason: 'NETWORK_ERROR', message: '네트워크 오류' },
    null,
    { status: 'PARSED', proposal: { ...validProposal, payload: { ...validProposal.payload, amount: -1 } } },
    { status: 'PARSED', proposal: { ...validProposal, payload: { ...validProposal.payload, transactionType: 'INCOME' } } },
    { status: 'PARSED', proposal: { ...validProposal, sourceInput: 'modified input' } },
    { status: 'PARSED', proposal: { ...validProposal, dependsOnActionIds: ['other'] } },
  ]) {
    const result = await runFake(response);
    assert.notEqual(result.status, 'PARSED', 'unsafe AI result must never be returned as parsed');
    assert.equal(persisted.length, 0);
  }
  const clarification = await runFake({ status: 'PARSED', proposal: { ...validProposal, payload: { ...validProposal.payload, amount: null } } });
  assert.equal(clarification.status, 'NEEDS_CLARIFICATION');
  assert.equal(persisted.length, 0);

  const unavailable = await createCaptureInterpretationService()(aiInput);
  assert.equal(unavailable.status, 'FAILED');
  assert.equal(unavailable.reason, 'PROVIDER_UNAVAILABLE');
  const throwing = await createCaptureInterpretationService({ async interpret() { throw new Error('network'); } })(aiInput);
  assert.equal(throwing.status, 'FAILED');
  assert.equal(throwing.reason, 'INTERPRETER_ERROR');

  const serviceSource = fs.readFileSync(path.join(root, 'src/application/proposals/interpret-capture-input.ts'), 'utf8');
  assert(!/(?:fetch\s*\(|axios|openai|sqlite|repository|executor)/iu.test(serviceSource));
  console.log('PASS: local routing avoids AI; injected AI outcomes are validated; malformed, invalid, clarification, unsupported and failure results cannot persist; default interpreter is unavailable.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
