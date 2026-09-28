import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Transaction } from '../../domain/transaction/transaction';
import { useExpenses } from '../capture/expense-context';
import { expenseStyles as styles } from '../capture/expense-styles';
import { ExpenseUndoFeedback } from './expense-undo-feedback';

export function HomeScreen() {
  const expenses = useExpenses();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(false);
    expenses.list().then(value => { if (active) setItems(value); }, () => {
      console.error('Expense list could not be loaded.');
      if (active) setError(true);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expenses, attempt]));

  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <FlatList data={loading || error ? [] : items} keyExtractor={item => item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Text style={styles.title} accessibilityRole="header">나의 지출</Text>
        <ExpenseUndoFeedback onResult={() => setAttempt(value => value + 1)} />
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push('/manual-expense')}>
          <Text style={styles.buttonText}>+ 지출 직접 입력</Text>
        </Pressable>
        <Text style={styles.muted}>최근 기록 100건 중 지출 · 기기 현지 시간</Text>
        {loading && <ActivityIndicator accessibilityLabel="지출 불러오는 중" />}
        {error && <>
          <Text accessibilityRole="alert" style={styles.error}>지출을 불러오지 못했습니다. 다시 시도해 주세요.</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}>
            <Text style={styles.buttonText}>다시 불러오기</Text>
          </Pressable>
        </>}
      </View>}
      ListEmptyComponent={!loading && !error ? <Text style={styles.text}>아직 표시할 지출이 없습니다. 첫 지출을 기록해 보세요.</Text> : null}
      renderItem={({ item }) => <View style={styles.card}>
        <Text style={styles.title}>지출 −{item.amount.toLocaleString('ko-KR')}{item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`}</Text>
        <Text style={styles.text}>{item.category ?? '미분류'}</Text>
        <Text style={styles.muted}>{item.memo ?? '메모 없음'}</Text>
        <Text style={styles.muted}>{new Date(item.occurredAt).toLocaleString('ko-KR')}</Text>
      </View>} />
  </SafeAreaView>;
}
