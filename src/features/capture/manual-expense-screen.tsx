import { useCallback, useRef, useState } from 'react';
import { router, Stack, useFocusEffect } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenses } from './expense-context';
import { expenseProposal, initialExpenseForm, localDateTimeFields, type ExpenseForm } from './expense-form';
import { expenseStyles as styles } from './expense-styles';

export function ManualExpenseScreen() {
  const expenses = useExpenses();
  const [form, setForm] = useState(() => initialExpenseForm(expenses.now()));
  const actionId = useRef<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => busy.current);
    return () => subscription.remove();
  }, []));

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    Keyboard.dismiss();
    try {
      actionId.current ??= expenses.newActionId();
      const { validation, outcome } = await expenses.save(expenseProposal(actionId.current, form));
      if (validation.status === 'NEEDS_CLARIFICATION') setError(validation.clarifications.map(item => item.question).join('\n'));
      else if (validation.status === 'INVALID') setError(`입력 내용을 확인해 주세요: ${validation.errorMessage}`);
      else if (validation.status === 'REQUIRES_CONFIRMATION') setError(validation.reason);
      else if (outcome?.result.status === 'SUCCESS') {
        // Keep the duplicate-press guard held until this route unmounts.
        router.dismissTo('/');
        return;
      } else {
        const result = outcome?.result;
        console.error('Manual expense execution failed.', result?.status === 'FAILED' ? result.errorCode : result?.status);
        setError(result?.status === 'FAILED'
          ? `저장을 완료하지 못했습니다. 같은 입력으로 다시 시도해 주세요. (${result.errorCode})`
          : '저장을 완료하지 못했습니다. 입력 내용을 확인해 주세요.');
      }
    } catch {
      console.error('Manual expense save could not be completed.');
      setError('저장을 확인하지 못했습니다. 같은 입력으로 다시 시도해 주세요.');
    }
    busy.current = false;
    setSaving(false);
  }

  function field(key: keyof ExpenseForm, label: string, placeholder?: string) {
    return <View style={styles.field}>
      <Text style={styles.text}>{label}</Text>
      <TextInput accessibilityLabel={label} value={form[key]} editable={!saving}
        onChangeText={value => setForm(current => ({ ...current, [key]: value }))}
        placeholder={placeholder} placeholderTextColor="#687582" style={styles.input}
        keyboardType={key === 'amount' ? 'number-pad' : 'default'}
        autoCorrect={false} autoCapitalize="none" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
    </View>;
  }

  // Build picker values from local fields so changing one part keeps the other
  // part of the selected wall-clock date/time intact.
  const selectedLocalDate = () => {
    const [year, month, day] = form.date.split('-').map(Number);
    const [hour, minute] = form.time.split(':').map(Number);
    const date = new Date(year, month - 1, day, hour, minute);
    return Number.isNaN(date.getTime()) ? new Date(expenses.now()) : date;
  };

  function updateSelectedLocalDate(date: Date) {
    setForm(current => ({ ...current, ...localDateTimeFields(date.toISOString()) }));
    setError(null);
  }

  function onPickerChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'set' && date) updateSelectedLocalDate(date);
    if (event.type === 'dismissed') setPicker(null);
  }

  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <Stack.Screen options={{ title: '지출 직접 입력', gestureEnabled: !saving, headerBackVisible: !saving }} />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.muted}>원화 지출을 기록합니다. 날짜와 시간은 기기 현지 시간입니다.</Text>
        {field('amount', '금액 (원, 필수)', '예: 7000')}
        {field('category', '카테고리 (선택)', '예: 식비')}
        {field('memo', '메모 (선택)', '예: 점심')}
        <View style={styles.field}>
          <Text style={styles.text}>발생 날짜와 시간 (기기 현지 시간)</Text>
          <View style={styles.selectionRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="날짜 선택" disabled={saving}
              style={[styles.selectionButton, saving && styles.disabled]} onPress={() => setPicker('date')}>
              <Text style={styles.selectionText}>{form.date}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="시간 선택" disabled={saving}
              style={[styles.selectionButton, saving && styles.disabled]} onPress={() => setPicker('time')}>
              <Text style={styles.selectionText}>{form.time}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="현재 시간으로 재설정" disabled={saving}
              style={[styles.nowButton, saving && styles.disabled]} onPress={() => updateSelectedLocalDate(new Date(expenses.now()))}>
              <Text style={styles.nowText}>지금</Text>
            </Pressable>
          </View>
          {picker && <DateTimePicker value={selectedLocalDate()} mode={picker} display={Platform.OS === 'ios' ? 'compact' : 'default'}
            onChange={onPickerChange} disabled={saving} />}
        </View>
        {error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
          style={[styles.button, saving && styles.disabled]} onPress={save}>
          <Text style={styles.buttonText}>{saving ? '저장 중…' : '지출 저장'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving} style={[styles.button, saving && styles.disabled]}
          onPress={() => { Keyboard.dismiss(); router.dismissTo('/'); }}>
          <Text style={styles.buttonText}>취소</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
