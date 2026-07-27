'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useExpenses } from '@/context/expense-provider';
import { usePermission } from '@/hooks/use-permission';
import { ExpenseDataTable } from '@/components/expenses/expense-data-table';
import { expenseColumns } from '@/components/expenses/expense-columns';
import { ExpenseDialog } from '@/components/expenses/expense-dialog';

export default function ExpensesPage() {
  const { expenses } = useExpenses();
  const canCreate = usePermission('expenses', 'create');
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Gestión de Gastos">
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Gasto
          </Button>
        )}
      </PageHeader>
      <ExpenseDataTable columns={expenseColumns} data={expenses} />
      <ExpenseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
