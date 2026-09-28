import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Transaction } from '../../domain/transaction/transaction';
import { useExpenses } from '../capture/expense-context';
import { expenseStyles as styles } from '../capture/expense-styles';
import { createCaptureParserInput, routeCaptureInput } from '../../application/proposals/capture-parser-router';
import { ExpenseUndoFeedback } from './expense-undo-feedback';
import { useVoiceCapture } from '../capture/voice-capture-context';
import type { SpeechPermissionStatus } from '../../application/speech/speech-recognition-adapter';
import type { VoiceCaptureState } from '../../application/capture/voice-expense-capture';

export function HomeScreen() {
  const expenses = useExpenses();
  const voiceCapture = useVoiceCapture();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [command, setCommand] = useState('');
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceCaptureState>('IDLE');
  const [voicePermission, setVoicePermission] = useState<SpeechPermissionStatus>('UNKNOWN');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const submitBusy = useRef(false);
  const retryActionId = useRef<string | null>(null);
  useEffect(() => () => voiceCapture.cancel(false), [voiceCapture]);
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

  async function submitCommand() {
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSubmitting(true);
    setCommandMessage(null);
    try {
      const parsed = routeCaptureInput(createCaptureParserInput(
        command, retryActionId.current ?? expenses.newActionId(), 'TEXT', expenses.now(),
      ));
      if (parsed.status !== 'PARSED') {
        setCommandMessage(parsed.message);
        return;
      }
      retryActionId.current ??= parsed.proposal.actionId;
      const { validation, outcome } = await expenses.save(parsed.proposal);
      if (validation.status === 'NEEDS_CLARIFICATION') {
        setCommandMessage(validation.clarifications.map(item => item.question).join('\n'));
      } else if (validation.status === 'INVALID') {
        setCommandMessage('입력 내용을 확인해 주세요.');
      } else if (validation.status === 'REQUIRES_CONFIRMATION') {
        setCommandMessage(validation.reason);
      } else if (outcome?.result.status === 'SUCCESS') {
        retryActionId.current = null;
        setCommand('');
        setAttempt(value => value + 1);
      } else {
        setCommandMessage('저장을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.');
      }
    } catch {
      setCommandMessage('저장을 확인하지 못했습니다. 같은 입력으로 다시 시도해 주세요.');
    } finally {
      submitBusy.current = false;
      setSubmitting(false);
    }
  }

  function startVoiceCapture() {
    void voiceCapture.start({
      onState: setVoiceState,
      onPermission: setVoicePermission,
      onPartial: setPartialTranscript,
      onMessage: message => setVoiceMessage(message || null),
      onSaved: () => setAttempt(value => value + 1),
    });
  }

  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <FlatList data={loading || error ? [] : items} keyExtractor={item => item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Text style={styles.title} accessibilityRole="header">나의 지출</Text>
        <ExpenseUndoFeedback refreshKey={attempt} onResult={() => setAttempt(value => value + 1)} />
        <View style={styles.field}>
          <Text style={styles.text}>무엇을 기록할까요?</Text>
          <TextInput
            accessibilityLabel="지출 문장 입력"
            editable={!submitting}
            maxLength={160}
            onChangeText={value => { setCommand(value); setCommandMessage(null); retryActionId.current = null; }}
            onSubmitEditing={submitCommand}
            placeholder="예: 점심 7000원 썼어"
            returnKeyType="done"
            style={styles.input}
            value={command}
          />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting || !command.trim(), busy: submitting }}
            disabled={submitting || !command.trim()} style={[styles.button, (submitting || !command.trim()) && styles.disabled]}
            onPress={submitCommand}>
            <Text style={styles.buttonText}>{submitting ? '기록 중…' : '기록'}</Text>
          </Pressable>
          {commandMessage && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{commandMessage}</Text>}
        </View>
        <View style={styles.field}>
          <Pressable accessibilityRole="button"
            accessibilityState={{ disabled: submitting || (voiceState !== 'IDLE' && voiceState !== 'LISTENING'), busy: voiceState === 'CHECKING' || voiceState === 'PROCESSING' }}
            disabled={submitting || (voiceState !== 'IDLE' && voiceState !== 'LISTENING')}
            style={[styles.button, (submitting || (voiceState !== 'IDLE' && voiceState !== 'LISTENING')) && styles.disabled]}
            onPress={voiceState === 'LISTENING' ? () => voiceCapture.stop() : startVoiceCapture}>
            <Text style={styles.buttonText}>{voiceState === 'LISTENING' ? '중지' : voiceState === 'CHECKING' ? '마이크 확인 중…' : voiceState === 'STOPPING' ? '음성 마무리 중…' : voiceState === 'PROCESSING' ? '기록 중…' : '🎤 말하기'}</Text>
          </Pressable>
          {voiceState === 'LISTENING' && <Text style={styles.muted}>듣고 있어요…</Text>}
          {partialTranscript !== '' && <Text accessibilityLiveRegion="polite" style={styles.muted}>{partialTranscript}</Text>}
          {voicePermission === 'DENIED' && !voiceMessage && <Text style={styles.muted}>마이크 권한이 거부되었습니다.</Text>}
          {voiceMessage && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{voiceMessage}</Text>}
        </View>
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
