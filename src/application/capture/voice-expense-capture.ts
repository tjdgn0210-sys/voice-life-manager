import type { ManualExpenses } from '../expenses/manual-expenses';
import { createCaptureParserInput } from '../proposals/capture-parser-router';
import type { CaptureInterpretationResult } from '../proposals/interpret-capture-input';
import type { CreateTransactionProposal } from '../validator/validate-create-transaction';
import type { SpeechPermissionStatus, SpeechRecognitionAdapter, SpeechRecognitionFailure } from '../speech/speech-recognition-adapter';

export type VoiceCaptureState = 'IDLE' | 'CHECKING' | 'LISTENING' | 'STOPPING' | 'PROCESSING';

export interface VoiceCaptureCallbacks {
  onState?(state: VoiceCaptureState): void;
  onPermission?(status: SpeechPermissionStatus): void;
  onPartial?(transcript: string): void;
  onMessage?(message: string): void;
  onSaved?(): void;
}

export interface VoiceExpenseCaptureDependencies {
  speech: SpeechRecognitionAdapter;
  interpret(input: ReturnType<typeof createCaptureParserInput>): Promise<CaptureInterpretationResult>;
  save(proposal: CreateTransactionProposal): ReturnType<ManualExpenses['save']>;
  newActionId(): string;
  now(): string;
}

function permissionMessage(status: SpeechPermissionStatus): string {
  if (status === 'BLOCKED') return '마이크 권한이 차단되어 있어요. 기기 설정에서 권한을 허용해 주세요.';
  return '마이크 권한을 허용해 주세요.';
}

function failureMessage(error: SpeechRecognitionFailure): string | null {
  switch (error) {
    case 'CANCELLED': return null;
    case 'NO_SPEECH': return '음성을 인식하지 못했어요. 다시 말해 주세요.';
    case 'PERMISSION_DENIED': return '마이크 권한을 확인해 주세요.';
    case 'UNAVAILABLE': return '이 기기에서 오프라인 음성 인식을 사용할 수 없어요.';
    case 'FAILED': return '음성을 처리하지 못했어요. 다시 시도해 주세요.';
  }
}

/** Sends only one confirmed final transcript through capture interpretation and the existing expense use case. */
export function createVoiceExpenseCapture(dependencies: VoiceExpenseCaptureDependencies) {
  let state: VoiceCaptureState = 'IDLE';
  let sessionId = 0;
  let finalHandled = false;
  let isProcessingFinal = false;
  let activeCallbacks: VoiceCaptureCallbacks = {};

  const setState = (next: VoiceCaptureState) => {
    state = next;
    activeCallbacks.onState?.(next);
  };

  async function submitFinal(transcript: string, currentSession: number) {
    if (currentSession !== sessionId || finalHandled) return;
    finalHandled = true;
    isProcessingFinal = true;
    activeCallbacks.onPartial?.('');
    if (!transcript.trim()) {
      isProcessingFinal = false;
      setState('IDLE');
      activeCallbacks.onMessage?.('음성을 인식하지 못했어요. 다시 말해 주세요.');
      return;
    }
    setState('PROCESSING');
    try {
      // The original final transcript is passed through unchanged as sourceInput.
      const input = createCaptureParserInput(transcript, dependencies.newActionId(), 'VOICE', dependencies.now());
      const result = await dependencies.interpret(input);
      if (currentSession !== sessionId) return;
      if (result.status === 'NEEDS_CLARIFICATION' || result.status === 'UNSUPPORTED' || result.status === 'FAILED') {
        activeCallbacks.onMessage?.(result.message);
        return;
      }
      const saved = await dependencies.save(result.proposal);
      if (currentSession !== sessionId) return;
      if (saved.validation.status === 'NEEDS_CLARIFICATION') {
        activeCallbacks.onMessage?.(saved.validation.clarifications.map(item => item.question).join('\n'));
      } else if (saved.validation.status === 'INVALID') {
        activeCallbacks.onMessage?.('입력 내용을 확인해 주세요.');
      } else if (saved.validation.status === 'REQUIRES_CONFIRMATION') {
        activeCallbacks.onMessage?.(saved.validation.reason);
      } else if (saved.outcome?.result.status === 'SUCCESS') {
        activeCallbacks.onSaved?.();
      } else {
        activeCallbacks.onMessage?.('저장을 완료하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch {
      if (currentSession === sessionId) activeCallbacks.onMessage?.('음성을 처리하지 못했어요. 기록 목록을 확인해 주세요.');
    } finally {
      if (currentSession === sessionId) {
        isProcessingFinal = false;
        setState('IDLE');
      }
    }
  }

  return {
    get state() { return state; },
    async start(callbacks: VoiceCaptureCallbacks = {}) {
      if (state !== 'IDLE') return;
      activeCallbacks = callbacks;
      const currentSession = ++sessionId;
      finalHandled = false;
      isProcessingFinal = false;
      setState('CHECKING');
      activeCallbacks.onPartial?.('');
      activeCallbacks.onMessage?.('');
      try {
        if (!dependencies.speech.isAvailable() || !dependencies.speech.supportsOnDeviceRecognition()) {
          setState('IDLE');
          activeCallbacks.onMessage?.(failureMessage('UNAVAILABLE')!);
          return;
        }
        let permission = await dependencies.speech.getPermissionStatus();
        if (currentSession !== sessionId) return;
        if (permission === 'UNKNOWN' || permission === 'DENIED') {
          permission = await dependencies.speech.requestMicrophonePermission();
        }
        activeCallbacks.onPermission?.(permission);
        if (currentSession !== sessionId) return;
        if (permission !== 'GRANTED') {
          setState('IDLE');
          activeCallbacks.onMessage?.(permissionMessage(permission));
          return;
        }
        dependencies.speech.startListening({
          onPartial: transcript => {
            if (currentSession === sessionId && !finalHandled) activeCallbacks.onPartial?.(transcript);
          },
          onFinal: transcript => { void submitFinal(transcript, currentSession); },
          onError: error => {
            if (currentSession !== sessionId || isProcessingFinal || finalHandled) return;
            finalHandled = true;
            setState('STOPPING');
            const message = failureMessage(error);
            if (message) activeCallbacks.onMessage?.(message);
            activeCallbacks.onPartial?.('');
          },
          onEnd: () => {
            if (currentSession !== sessionId || state === 'IDLE') return;
            if (finalHandled) {
              if (state === 'STOPPING') setState('IDLE');
              return;
            }
            finalHandled = true;
            setState('IDLE');
            activeCallbacks.onPartial?.('');
            activeCallbacks.onMessage?.('음성을 인식하지 못했어요. 다시 말해 주세요.');
          },
        });
        if (currentSession === sessionId) setState('LISTENING');
      } catch {
        if (currentSession === sessionId) {
          setState('IDLE');
          activeCallbacks.onPartial?.('');
          activeCallbacks.onMessage?.(failureMessage('UNAVAILABLE')!);
        }
      }
    },
    stop() {
      if (state !== 'LISTENING') return;
      setState('STOPPING');
      try {
        dependencies.speech.stopListening();
      } catch {
        sessionId++;
        finalHandled = true;
        setState('IDLE');
        activeCallbacks.onPartial?.('');
        activeCallbacks.onMessage?.(failureMessage('FAILED')!);
      }
    },
    cancel(notify = true) {
      if (state === 'IDLE') return;
      if (!notify && state === 'PROCESSING') {
        activeCallbacks = {};
        return;
      }
      sessionId++;
      finalHandled = true;
      isProcessingFinal = false;
      dependencies.speech.cancelListening();
      if (notify) {
        activeCallbacks.onPartial?.('');
        setState('IDLE');
      } else state = 'IDLE';
    },
  };
}

export type VoiceExpenseCapture = ReturnType<typeof createVoiceExpenseCapture>;
