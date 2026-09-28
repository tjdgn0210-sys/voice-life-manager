import type { ActionProposal } from './action-proposal';
import type { CaptureParserInput } from './capture-parser-router';

/** Provider-neutral contract. Production credentials belong behind a secure backend, never in this client. */
export type CaptureAiInterpreterResult =
  | { status: 'PARSED'; proposal: ActionProposal }
  | { status: 'NEEDS_CLARIFICATION'; message: string }
  | { status: 'UNSUPPORTED'; message: string }
  | { status: 'FAILED'; reason: 'PROVIDER_UNAVAILABLE' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'TIMEOUT'; message: string };

export interface CaptureAiInterpreter {
  interpret(input: CaptureParserInput): Promise<CaptureAiInterpreterResult>;
}

/** Safe default until a real provider is explicitly selected and integrated. */
export const unavailableCaptureAiInterpreter: CaptureAiInterpreter = {
  async interpret() {
    return {
      status: 'FAILED',
      reason: 'PROVIDER_UNAVAILABLE',
      message: '자동 해석을 사용할 수 없어요. 내용을 직접 입력해 주세요.',
    };
  },
};
