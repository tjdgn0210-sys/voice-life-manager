// Focused application-layer capture routing check; does not open a database or make network calls.
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
    assert(name.startsWith('.'), `Router must not load external runtime dependency: ${name}`);
    let resolved = path.resolve(path.dirname(file), name);
    if (!path.extname(resolved)) resolved += '.ts';
    return load(path.relative(root, resolved));
  }, mod, mod.exports);
  return mod.exports;
}

const { createCaptureParserInput, routeCaptureInput } = load('src/application/proposals/capture-parser-router.ts');
const now = '2026-09-28T10:15:30.000Z';
let sequence = 0;
function route(text, method = 'TEXT') {
  return routeCaptureInput(createCaptureParserInput(text, `route-${++sequence}`, method, now));
}

for (const text of ['점심 7000원', '커피 4500원 썼어']) {
  const result = route(text);
  assert.equal(result.status, 'PARSED');
  assert.equal(result.proposal.inputMethod, 'TEXT');
  assert.equal(result.proposal.sourceInput, text);
}
for (const text of ['오늘 점심 먹었어', '택시 탔어']) {
  const result = route(text);
  assert.equal(result.status, 'NEEDS_CLARIFICATION', text);
  assert(!('proposal' in result));
}
for (const text of [
  '어제 친구랑 밥 먹고 내가 32000원 냈어',
  '지난주 금요일에 친구 선물로 5만원 썼어',
  '내일 3시에 치과 예약',
]) {
  const result = route(text);
  assert.equal(result.status, 'AI_REQUIRED', text);
  assert(!('proposal' in result));
  assert.match(result.message, /아직 자동 처리할 수 없어요/);
}
for (const text of ['비트코인 가격 알려줘', '오늘 날씨 어때']) {
  const result = route(text);
  assert.equal(result.status, 'UNSUPPORTED', text);
  assert(!('proposal' in result));
  assert.equal(result.message, '이 요청은 아직 지원하지 않아요.');
}

const voiceText = '커피 4500원 썼어';
const voiceResult = route(voiceText, 'VOICE');
assert.equal(voiceResult.status, 'PARSED');
assert.equal(voiceResult.proposal.inputMethod, 'VOICE');
assert.equal(voiceResult.proposal.sourceInput, voiceText);

const original = '  점심 7000원  ';
const separated = createCaptureParserInput(original, 'raw-input', 'TEXT', now);
assert.equal(separated.sourceInput, original);
assert.equal(separated.normalizedInput, '점심 7000원');
const preserved = routeCaptureInput(separated);
assert.equal(preserved.status, 'PARSED');
assert.equal(preserved.proposal.sourceInput, original);

const routerSource = fs.readFileSync(path.join(root, 'src/application/proposals/capture-parser-router.ts'), 'utf8');
assert(!/(?:fetch\s*\(|axios|openai|sqlite|react-native|from ['"]react['"])/iu.test(routerSource));
console.log('PASS: all four route outcomes, TEXT/VOICE input context, raw input preservation, no-proposal safety, and no provider/network/database dependencies.');
