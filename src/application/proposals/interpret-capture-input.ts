import type { CaptureAiInterpreter, CaptureAiInterpreterResult } from './capture-ai-interpreter';
import { unavailableCaptureAiInterpreter } from './capture-ai-interpreter';
import type { CaptureParserInput } from './capture-parser-router';
import { routeCaptureInput } from './capture-parser-router';
import type { CreateTransactionProposal } from '../validator/validate-create-transaction';
import { validateCreateTransaction } from '../validator/validate-create-transaction';

export type CaptureInterpretationResult =
  | { status: 'PARSED'; proposal: CreateTransactionProposal; source: 'LOCAL' | 'AI' }
  | { status: 'NEEDS_CLARIFICATION'; message: string }
  | { status: 'UNSUPPORTED'; message: string }
  | { status: 'FAILED'; reason: 'PROVIDER_UNAVAILABLE' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'TIMEOUT' | 'INVALID_PROPOSAL' | 'INTERPRETER_ERROR'; message: string };

type InterpreterFailureReason = Extract<CaptureAiInterpreterResult, { status: 'FAILED' }>['reason'];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMessageResult(value: Record<string, unknown>, status: string): value is Record<string, unknown> & { message: string } {
  return value.status === status && typeof value.message === 'string' && Boolean(value.message.trim());
}

/** Routes locally first; only AI_REQUIRED invokes the injected interpreter. This service never executes or persists. */
export function createCaptureInterpretationService(interpreter: CaptureAiInterpreter = unavailableCaptureAiInterpreter) {
  return async (input: CaptureParserInput): Promise<CaptureInterpretationResult> => {
    const local = routeCaptureInput(input);
    if (local.status === 'PARSED') return { status: 'PARSED', proposal: local.proposal, source: 'LOCAL' };
    if (local.status !== 'AI_REQUIRED') return local;

    let response: CaptureAiInterpreterResult;
    try {
      response = await interpreter.interpret(input);
    } catch {
      return { status: 'FAILED', reason: 'INTERPRETER_ERROR', message: '자동 해석을 완료하지 못했어요. 다시 시도해 주세요.' };
    }
    if (!isObject(response) || typeof response.status !== 'string') {
      return { status: 'FAILED', reason: 'MALFORMED_RESPONSE', message: '자동 해석 결과를 확인할 수 없어요.' };
    }
    if (response.status === 'NEEDS_CLARIFICATION' && isMessageResult(response, 'NEEDS_CLARIFICATION')) {
      return { status: 'NEEDS_CLARIFICATION', message: response.message };
    }
    if (response.status === 'UNSUPPORTED' && isMessageResult(response, 'UNSUPPORTED')) {
      return { status: 'UNSUPPORTED', message: response.message };
    }
    if (response.status === 'FAILED' && typeof response.reason === 'string'
      && ['PROVIDER_UNAVAILABLE', 'NETWORK_ERROR', 'MALFORMED_RESPONSE', 'TIMEOUT'].includes(response.reason)
      && typeof response.message === 'string' && response.message.trim()) {
      return { status: 'FAILED', reason: response.reason as InterpreterFailureReason, message: response.message };
    }
    if (response.status !== 'PARSED' || !isObject(response.proposal)) {
      return { status: 'FAILED', reason: 'MALFORMED_RESPONSE', message: '자동 해석 결과를 확인할 수 없어요.' };
    }

    const candidate = response.proposal;
    if (candidate.type !== 'CREATE_TRANSACTION' || candidate.actionId !== input.actionId
      || candidate.sourceInput !== input.sourceInput || candidate.inputMethod !== input.inputMethod
      || !Array.isArray(candidate.dependsOnActionIds) || candidate.dependsOnActionIds.length !== 0
      || !isObject(candidate.payload) || candidate.payload.transactionType !== 'EXPENSE') {
      return { status: 'FAILED', reason: 'INVALID_PROPOSAL', message: '자동 해석 결과가 허용된 지출 형식과 일치하지 않아요.' };
    }
    const validation = validateCreateTransaction(candidate);
    if (validation.status === 'NEEDS_CLARIFICATION') {
      return { status: 'NEEDS_CLARIFICATION', message: validation.clarifications.map(item => item.question).join(' ') };
    }
    if (validation.status !== 'VALID') {
      return { status: 'FAILED', reason: 'INVALID_PROPOSAL', message: '자동 해석 결과를 검증하지 못했어요.' };
    }
    return { status: 'PARSED', proposal: candidate as unknown as CreateTransactionProposal, source: 'AI' };
  };
}
