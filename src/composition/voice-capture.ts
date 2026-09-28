import { createVoiceExpenseCapture } from '../application/capture/voice-expense-capture';
import { createCaptureInterpretationService } from '../application/proposals/interpret-capture-input';
import type { ManualExpenses } from '../application/expenses/manual-expenses';
import { createExpoSpeechRecognitionAdapter } from '../adapters/speech/expo-speech-recognition-adapter';

export function createVoiceCapture(expenses: ManualExpenses) {
  return createVoiceExpenseCapture({
    speech: createExpoSpeechRecognitionAdapter(),
    interpret: createCaptureInterpretationService(),
    save: proposal => expenses.save(proposal),
    newActionId: expenses.newActionId,
    now: expenses.now,
  });
}
