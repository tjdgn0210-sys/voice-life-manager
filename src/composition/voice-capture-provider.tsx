import { useState, type PropsWithChildren } from 'react';
import { useExpenses } from '../features/capture/expense-context';
import { VoiceCaptureContext } from '../features/capture/voice-capture-context';
import { createVoiceCapture } from './voice-capture';

export function VoiceCaptureProvider({ children }: PropsWithChildren) {
  const expenses = useExpenses();
  const [voiceCapture] = useState(() => createVoiceCapture(expenses));
  return <VoiceCaptureContext.Provider value={voiceCapture}>{children}</VoiceCaptureContext.Provider>;
}
