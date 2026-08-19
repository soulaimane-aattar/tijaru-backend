/**
 * The seed set of expense categories every new tenant starts with.
 *
 * Keys match the historical `ExpenseCategory` enum values so existing rows
 * (created before categories were configurable) stay resolvable.
 */
export type DefaultCategory = {
  key: string;
  label: string;
  taxRate: number;
  sortOrder: number;
};

export const DEFAULT_EXPENSE_CATEGORIES: readonly DefaultCategory[] = [
  { key: 'rent',        label: 'Loyer',       taxRate: 20, sortOrder: 10 },
  { key: 'utilities',   label: 'Charges',     taxRate: 20, sortOrder: 20 },
  { key: 'salaries',    label: 'Salaires',    taxRate: 0,  sortOrder: 30 },
  { key: 'supplies',    label: 'Fournitures', taxRate: 20, sortOrder: 40 },
  { key: 'transport',   label: 'Transport',   taxRate: 14, sortOrder: 50 },
  { key: 'maintenance', label: 'Entretien',   taxRate: 20, sortOrder: 60 },
  { key: 'taxes',       label: 'Taxes',       taxRate: 0,  sortOrder: 70 },
  { key: 'marketing',   label: 'Marketing',   taxRate: 20, sortOrder: 80 },
  { key: 'other',       label: 'Autre',       taxRate: 0,  sortOrder: 90 },
];
