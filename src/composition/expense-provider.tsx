import { useEffect, useState, type PropsWithChildren } from 'react';
import { Button, Text, View } from 'react-native';
import type { ManualExpenses } from '../application/expenses/manual-expenses';
import { ExpenseContext } from '../features/capture/expense-context';
import { initializeManualExpenses } from './manual-expenses';

export function ExpenseProvider({ children }: PropsWithChildren) {
  const [services, setServices] = useState<ManualExpenses | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    initializeManualExpenses().then(value => { if (active) setServices(value); }, () => {
      console.error('Expense service initialization failed.');
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [attempt]);
  if (services) return <ExpenseContext.Provider value={services}>{children}</ExpenseContext.Provider>;
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
    <Text accessibilityRole={failed ? 'alert' : 'text'} style={{ color: '#111' }}>
      {failed ? '지출 기록을 준비하지 못했습니다.' : '지출 기록을 준비하고 있습니다…'}
    </Text>
    {failed && <Button title="다시 시도" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} />}
  </View>;
}
