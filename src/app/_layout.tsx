import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ExpenseProvider } from '@/composition/expense-provider';
import { VoiceCaptureProvider } from '@/composition/voice-capture-provider';
import { DatabaseStartup } from '@/database/database-startup';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <AnimatedSplashOverlay />
      <DatabaseStartup>
        <ExpenseProvider>
          <VoiceCaptureProvider>
            <Stack>
              <Stack.Screen name="index" options={{ title: 'Voice Life Manager' }} />
              <Stack.Screen name="manual-expense" options={{ title: '지출 직접 입력' }} />
              <Stack.Protected guard={false}>
                <Stack.Screen name="explore" />
              </Stack.Protected>
            </Stack>
          </VoiceCaptureProvider>
        </ExpenseProvider>
      </DatabaseStartup>
    </ThemeProvider>
  );
}
