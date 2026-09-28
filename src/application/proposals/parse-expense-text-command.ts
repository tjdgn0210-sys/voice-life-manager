import type { CreateTransactionProposal } from '../validator/validate-create-transaction';
import { categoryForExpenseText } from './expense-category-map';

export type ExpenseTextParseResult =
  | { status: 'PARSED'; proposal: CreateTransactionProposal }
  | { status: 'NEEDS_CLARIFICATION'; message: string }
  | { status: 'UNSUPPORTED'; message: string };

type AmountMatch = { raw: string; index: number; amount: number };

function parseWonAmount(input: string): AmountMatch[] {
  // Numeric won values and the intentionally limited Korean 만/천 forms.
  const expression = /(?<![\d,.-])(?:\d{1,3}(?:,\d{3})+|\d+)원|(?<![\d,.-])(?:\d+만(?:\d+천)?|\d+천)원?/gu;
  return Array.from(input.matchAll(expression), match => {
    const raw = match[0];
    let amount: number;
    if (/만|천/.test(raw)) {
      const korean = raw.replace(/원$/, '');
      const tenThousands = /^(\d+)만/.exec(korean);
      const thousands = /만(\d+)천$|^(\d+)천$/.exec(korean);
      amount = (tenThousands ? Number(tenThousands[1]) * 10_000 : 0)
        + (thousands ? Number(thousands[1] ?? thousands[2]) * 1_000 : 0);
    } else {
      amount = Number(raw.slice(0, -1).replaceAll(',', ''));
    }
    return { raw, index: match.index ?? 0, amount };
  });
}

function memoFromCommand(input: string, amount: AmountMatch): string | null {
  let memo = `${input.slice(0, amount.index)} ${input.slice(amount.index + amount.raw.length)}`
    .replace(/(?:^|\s)(?:오늘|방금|내가|나는)(?=\s|$)/gu, ' ')
    .replace(/(?:썼어|썼어요|썼습니다|썼다|사용했어|사용했어요|결제했어|결제했어요|지출했어|썼음|씀)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:에서|으로|로|에게|한테|에|은|는|이|가|을|를|랑|하고|와|과|도)$/u, '')
    .trim();
  return memo || null;
}

const unsupportedMessage = '아직 이 문장은 자동으로 처리할 수 없어요.';
const clarificationMessage = '금액을 입력해 주세요.';

/** Deterministic parser for simple Korean expense commands; it has no persistence dependencies. */
export function parseExpenseTextCommand(
  sourceInput: string,
  actionId: string,
  now: string,
): ExpenseTextParseResult {
  const input = sourceInput.trim();
  if (!input) return { status: 'NEEDS_CLARIFICATION', message: clarificationMessage };

  // These commands are explicitly outside this expense-only parser.
  if (/(?:수입|월급|급여|입금|환급|용돈|받았|벌었)/u.test(input)) {
    return { status: 'UNSUPPORTED', message: unsupportedMessage };
  }
  const amounts = parseWonAmount(input);
  const category = categoryForExpenseText(input);
  const expenseIntent = category !== null || /(?:돈|썼|사용|결제|지출|샀|구입|구매)/u.test(input);
  if (amounts.length === 0) {
    return expenseIntent
      ? { status: 'NEEDS_CLARIFICATION', message: clarificationMessage }
      : { status: 'UNSUPPORTED', message: unsupportedMessage };
  }
  // This slice records at the current time only; never discard an explicit date/time.
  if (/(?:오늘|어제|내일|모레|\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*시|오전|오후|저녁|아침)/u.test(input)) {
    return { status: 'UNSUPPORTED', message: unsupportedMessage };
  }
  if (amounts.length !== 1 || !Number.isSafeInteger(amounts[0].amount) || amounts[0].amount <= 0
    || !actionId.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(now)
    || !Number.isFinite(Date.parse(now)) || new Date(Date.parse(now)).toISOString() !== (now.includes('.') ? now : now.replace('Z', '.000Z'))) {
    return { status: 'UNSUPPORTED', message: unsupportedMessage };
  }

  const memo = memoFromCommand(input, amounts[0]);
  const proposal: CreateTransactionProposal = {
    actionId,
    type: 'CREATE_TRANSACTION',
    sourceInput,
    inputMethod: 'TEXT',
    dependsOnActionIds: [],
    payload: {
      transactionType: 'EXPENSE',
      amount: amounts[0].amount,
      currencyCode: 'KRW',
      category: categoryForExpenseText(memo ?? ''),
      memo,
      occurredAt: new Date(Date.parse(now)).toISOString(),
    },
  };
  return { status: 'PARSED', proposal };
}
