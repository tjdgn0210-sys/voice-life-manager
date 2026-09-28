import type { InputMethod } from '../../domain/common/primitives';
import type { CreateTransactionProposal } from '../validator/validate-create-transaction';
import { categoryForExpenseText } from './expense-category-map';
import { parseExpenseTextCommand } from './parse-expense-text-command';

export type CaptureInputMethod = Extract<InputMethod, 'TEXT' | 'VOICE'>;

/** Original text is retained unchanged; normalized text is only a parsing aid. */
export interface CaptureParserInput {
  sourceInput: string;
  normalizedInput: string;
  actionId: string;
  inputMethod: CaptureInputMethod;
  now: string;
}

export type CaptureParserResult =
  | { status: 'PARSED'; proposal: CreateTransactionProposal }
  | { status: 'NEEDS_CLARIFICATION'; message: string }
  | { status: 'AI_REQUIRED'; message: string }
  | { status: 'UNSUPPORTED'; message: string };

const aiRequiredMessage = '이 문장은 조금 더 복잡해서 아직 자동 처리할 수 없어요.';
const unsupportedMessage = '이 요청은 아직 지원하지 않아요.';

export function createCaptureParserInput(
  sourceInput: string,
  actionId: string,
  inputMethod: CaptureInputMethod,
  now: string,
): CaptureParserInput {
  return {
    sourceInput,
    normalizedInput: sourceInput.normalize('NFKC').trim().replace(/\s+/gu, ' '),
    actionId,
    inputMethod,
    now,
  };
}

function hasMoneyAmount(text: string): boolean {
  return /(?<![\d,.-])(?:\d{1,3}(?:,\d{3})+|\d+)(?:만(?:\d+천)?|천)?원/u.test(text);
}

function hasExpenseIntent(text: string): boolean {
  return categoryForExpenseText(text) !== null
    || /(?:썼|사용|결제|지출|냈|샀|구입|구매|지불|돈|비용)/u.test(text);
}

function needsBroaderExpenseParsing(text: string): boolean {
  const hasDateOrTimeContext = /(?:오늘|어제|내일|모레|지난주|이번주|다음주|지난달|이번달|주말|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*시|오전|오후|저녁|아침)/u.test(text);
  const hasExtraContext = /(?:친구|가족|동료|선물|랑|하고|같이|먹고|그리고|내가)/u.test(text);
  return hasDateOrTimeContext || hasExtraContext;
}

function looksLikeFutureProductAction(text: string): boolean {
  const hasDateOrTime = /(?:오늘|어제|내일|모레|이번주|다음주|지난주|\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*시|오전|오후|저녁|아침)/u.test(text);
  const hasTaskOrEventIntent = /(?:예약|만나|약속|회의|일정|치과|병원|방문|수업|해야|할 일|기억해|잊지)/u.test(text);
  return hasDateOrTime && hasTaskOrEventIntent;
}

/** Route local results without invoking any AI, network, validation, or persistence code. */
export function routeCaptureInput(input: CaptureParserInput): CaptureParserResult {
  const text = input.normalizedInput;
  const local = parseExpenseTextCommand(input.sourceInput, input.actionId, input.now);

  // A simple parse remains local only when no unsupported date or compound context was discarded.
  if (local.status === 'PARSED') {
    if (hasMoneyAmount(text) && needsBroaderExpenseParsing(text)) {
      return { status: 'AI_REQUIRED', message: aiRequiredMessage };
    }
    return { ...local, proposal: { ...local.proposal, inputMethod: input.inputMethod } };
  }
  if (local.status === 'NEEDS_CLARIFICATION') return local;

  const expenseWithAmount = hasMoneyAmount(text) && hasExpenseIntent(text);
  if (expenseWithAmount || looksLikeFutureProductAction(text)) {
    return { status: 'AI_REQUIRED', message: aiRequiredMessage };
  }
  return { status: 'UNSUPPORTED', message: unsupportedMessage };
}
