'use client';

import { PageHeader } from '@/components/page-header';
import { useExpenses } from '@/context/expense-provider';
import { ExpenseDataTable } from '@/components/expenses/expense-data-table';
import { expenseColumns } from '@/components/expenses/expense-columns';

export default function ExpensesPage() {
  const { expenses } = useExpenses();

  return (
    <div>
      <PageHeader title="Gestión de Gastos" />
       <ExpenseDataTable columns={expenseColumns} data={expenses} />
    </div>
  );
}
