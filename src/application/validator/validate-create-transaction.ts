import type { ActionProposal } from '../proposals/action-proposal';
import type { ClarificationRequest, ValidationResult } from './validation-result';
import { isUtcDateTime } from './utc-date-time';

export type CreateTransactionProposal = Extract<ActionProposal, { type: 'CREATE_TRANSACTION' }>;
export type ResolvedTransactionPayload = {
  [K in keyof CreateTransactionProposal['payload']]: K extends 'category' | 'memo'
    ? CreateTransactionProposal['payload'][K]
    : NonNullable<CreateTransactionProposal['payload'][K]>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Pure validation only. Missing actionId uses an empty correlation ID in INVALID results;
 * it is never assigned an invented action identity or allowed to reach persistence.
 * Invalid supplied values take precedence over missing-field clarification.
 */
export function validateCreateTransaction(input: unknown): ValidationResult {
  const actionId = isObject(input) && typeof input.actionId === 'string' ? input.actionId : '';
  const invalid = (errorCode: string, errorMessage: string): ValidationResult => ({
    actionId, status: 'INVALID', errorCode, errorMessage,
  });
  if (!isObject(input) || !actionId.trim() || input.type !== 'CREATE_TRANSACTION'
    || typeof input.sourceInput !== 'string' || typeof input.inputMethod !== 'string'
    || !['MANUAL', 'VOICE', 'TEXT'].includes(input.inputMethod)
    || !Array.isArray(input.dependsOnActionIds)
    || !input.dependsOnActionIds.every(id => typeof id === 'string' && id.trim() && id !== actionId)
    || new Set(input.dependsOnActionIds).size !== input.dependsOnActionIds.length
    || !isObject(input.payload)) {
    return invalid('INVALID_PROPOSAL', 'Expected a structurally valid CREATE_TRANSACTION proposal.');
  }
  const payload = input.payload;
  if (!(payload.category === null || typeof payload.category === 'string')
    || !(payload.memo === null || typeof payload.memo === 'string')) {
    return invalid('INVALID_PROPOSAL', 'category and memo must be strings or explicit null.');
  }
  const questions: ClarificationRequest[] = [];
  const missing = (field: string, question: string) => {
    questions.push({ actionId, field: `payload.${field}`, reason: 'MISSING', question });
  };
  if (payload.transactionType === null || payload.transactionType === undefined) {
    missing('transactionType', '지출인가요, 수입인가요?');
  } else if (payload.transactionType !== 'EXPENSE' && payload.transactionType !== 'INCOME') {
    return invalid('INVALID_TRANSACTION_TYPE', 'Transaction type must be EXPENSE or INCOME.');
  }
  if (payload.amount === null || payload.amount === undefined) {
    missing('amount', '금액이 얼마인가요?');
  } else if (typeof payload.amount !== 'number' || !Number.isSafeInteger(payload.amount) || payload.amount <= 0) {
    return invalid('INVALID_AMOUNT', 'Amount must be a positive safe integer.');
  }
  if (payload.currencyCode === null || payload.currencyCode === undefined
    || (typeof payload.currencyCode === 'string' && !payload.currencyCode.trim())) {
    missing('currencyCode', '어떤 통화인가요?');
  } else if (typeof payload.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(payload.currencyCode)) {
    return invalid('INVALID_CURRENCY_CODE', 'Currency code must contain three uppercase letters.');
  }
  if (payload.occurredAt === null || payload.occurredAt === undefined
    || (typeof payload.occurredAt === 'string' && !payload.occurredAt.trim())) {
    missing('occurredAt', '언제 발생한 거래인가요?');
  } else if (!isUtcDateTime(payload.occurredAt)) {
    return invalid('INVALID_OCCURRED_AT', 'occurredAt must be a valid absolute UTC ISO timestamp.');
  }
  const [first, ...rest] = questions;
  if (first) return { actionId, status: 'NEEDS_CLARIFICATION', clarifications: [first, ...rest] };
  return { actionId, status: 'VALID' };
}
