import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import type { SpeechPermissionStatus, SpeechRecognitionAdapter, SpeechRecognitionFailure, SpeechRecognitionHandlers } from '../../application/speech/speech-recognition-adapter';

function permissionStatus(response: { status: string; granted: boolean; canAskAgain: boolean; restricted?: boolean }): SpeechPermissionStatus {
  if (response.granted || response.status === 'granted') return 'GRANTED';
  if (response.restricted || !response.canAskAgain) return 'BLOCKED';
  return response.status === 'undetermined' ? 'UNKNOWN' : 'DENIED';
}

function recognitionFailure(error: ExpoSpeechRecognitionErrorCode): SpeechRecognitionFailure {
  if (error === 'aborted') return 'CANCELLED';
  if (error === 'no-speech' || error === 'speech-timeout') return 'NO_SPEECH';
  if (error === 'not-allowed') return 'PERMISSION_DENIED';
  if (error === 'service-not-allowed' || error === 'language-not-supported') return 'UNAVAILABLE';
  return 'FAILED';
}

export function createExpoSpeechRecognitionAdapter(): SpeechRecognitionAdapter {
  let subscriptions: Array<{ remove(): void }> = [];
  let cancelling = false;
  const removeSubscriptions = () => {
    subscriptions.forEach(subscription => subscription.remove());
    subscriptions = [];
  };

  return {
    isAvailable() {
      try { return ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { return false; }
    },
    supportsOnDeviceRecognition() {
      try { return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(); } catch { return false; }
    },
    async getPermissionStatus() {
      try { return permissionStatus(await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()); }
      catch { return 'BLOCKED'; }
    },
    async requestMicrophonePermission() {
      try { return permissionStatus(await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()); }
      catch { return 'BLOCKED'; }
    },
    startListening(handlers: SpeechRecognitionHandlers) {
      removeSubscriptions();
      cancelling = false;
      subscriptions = [
        ExpoSpeechRecognitionModule.addListener('result', event => {
          const transcript = event.results[0]?.transcript ?? '';
          if (event.isFinal) handlers.onFinal(transcript);
          else handlers.onPartial(transcript);
        }),
        ExpoSpeechRecognitionModule.addListener('error', event => {
          if (cancelling && event.error === 'aborted') return;
          handlers.onError(recognitionFailure(event.error));
        }),
        ExpoSpeechRecognitionModule.addListener('nomatch', () => handlers.onError('NO_SPEECH')),
        ExpoSpeechRecognitionModule.addListener('end', () => {
          removeSubscriptions();
          handlers.onEnd();
        }),
      ];
      try {
        ExpoSpeechRecognitionModule.start({
          lang: 'ko-KR',
          interimResults: true,
          continuous: false,
          requiresOnDeviceRecognition: true,
          recordingOptions: { persist: false },
        });
      } catch (error) {
        removeSubscriptions();
        throw error;
      }
    },
    stopListening() {
      ExpoSpeechRecognitionModule.stop();
    },
    cancelListening() {
      cancelling = true;
      removeSubscriptions();
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* Native session may already have ended. */ }
    },
  };
}
