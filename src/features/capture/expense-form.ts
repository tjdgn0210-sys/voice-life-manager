import type { CreateTransactionProposal } from '../../application/validator/validate-create-transaction';

export interface ExpenseForm { amount: string; category: string; memo: string; date: string; time: string }

export function initialExpenseForm(timestamp: string): ExpenseForm {
  const local = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return { amount: '', category: '', memo: '',
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}` };
}

/** Presentation conversion only. Reject overflow rather than silently normalizing dates. */
export function localOccurrence(date: string, time: string): string | null {
  if (!date.trim() || !time.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return 'INVALID_LOCAL_TIME';
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = new Date(year, month - 1, day, hour, minute);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day
    || local.getHours() !== hour || local.getMinutes() !== minute) return 'INVALID_LOCAL_TIME';
  return local.toISOString();
}

export function expenseProposal(actionId: string, form: ExpenseForm): CreateTransactionProposal {
  // Do not strip separators, round decimals, or change negative values into positive ones.
  // The validator owns the financial constraints; malformed numeric text becomes NaN.
  const amount = !form.amount.trim() ? null : /^-?\d+(\.\d+)?$/.test(form.amount) ? Number(form.amount) : NaN;
  return { actionId, type: 'CREATE_TRANSACTION', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [],
    payload: { transactionType: 'EXPENSE', currencyCode: 'KRW', amount,
      category: form.category.trim() || null, memo: form.memo.trim() || null,
      occurredAt: localOccurrence(form.date, form.time) } };
}
