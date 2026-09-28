export type SpeechPermissionStatus = 'UNKNOWN' | 'GRANTED' | 'DENIED' | 'BLOCKED';
export type SpeechRecognitionFailure = 'NO_SPEECH' | 'CANCELLED' | 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'FAILED';

export interface SpeechRecognitionHandlers {
  onPartial(transcript: string): void;
  onFinal(transcript: string): void;
  onError(error: SpeechRecognitionFailure): void;
  onEnd(): void;
}

/** Application-owned speech port; implementations own platform APIs and temporary audio handling. */
export interface SpeechRecognitionAdapter {
  isAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  getPermissionStatus(): Promise<SpeechPermissionStatus>;
  requestMicrophonePermission(): Promise<SpeechPermissionStatus>;
  startListening(handlers: SpeechRecognitionHandlers): void;
  stopListening(): void;
  cancelListening(): void;
}
