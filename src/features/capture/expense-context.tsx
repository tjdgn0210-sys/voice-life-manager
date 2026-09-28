import { createContext, useContext } from 'react';
import type { ManualExpenses } from '../../application/expenses/manual-expenses';

export const ExpenseContext = createContext<ManualExpenses | null>(null);

export function useExpenses() {
  const services = useContext(ExpenseContext);
  if (!services) throw new Error('Expense services must be initialized before rendering screens.');
  return services;
}
