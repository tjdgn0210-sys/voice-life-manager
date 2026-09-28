import { createContext, useContext } from 'react';
import type { VoiceExpenseCapture } from '../../application/capture/voice-expense-capture';

export const VoiceCaptureContext = createContext<VoiceExpenseCapture | null>(null);

export function useVoiceCapture() {
  const service = useContext(VoiceCaptureContext);
  if (!service) throw new Error('Voice capture service must be initialized before rendering screens.');
  return service;
}
