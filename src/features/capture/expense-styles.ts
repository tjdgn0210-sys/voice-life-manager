import { StyleSheet } from 'react-native';

export const expenseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700', color: '#17212b' },
  text: { fontSize: 16, color: '#17212b', lineHeight: 24 },
  muted: { fontSize: 14, color: '#52606d', lineHeight: 22 },
  field: { gap: 6 },
  input: { borderWidth: 1, borderColor: '#77838f', borderRadius: 8, minHeight: 48,
    paddingHorizontal: 12, paddingVertical: 10, color: '#17212b', fontSize: 16, backgroundColor: '#fff' },
  button: { minHeight: 48, backgroundColor: '#194f85', borderRadius: 8, padding: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { color: '#a11d27', fontSize: 16, lineHeight: 24 },
  card: { borderBottomWidth: 1, borderBottomColor: '#dce2e8', paddingVertical: 16, gap: 4 },
});
