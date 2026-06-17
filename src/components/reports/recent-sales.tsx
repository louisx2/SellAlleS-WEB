import type { Sale } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface RecentSalesProps {
  sales: Sale[];
}

export function RecentSales({ sales }: RecentSalesProps) {
  return (
    <div className="space-y-4">
      {sales.map((sale) => (
        <div key={sale.id} className="flex items-center">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{sale.customer?.name.charAt(0) ?? 'C'}</AvatarFallback>
          </Avatar>
          <div className="ml-4 space-y-1">
            <p className="text-sm font-medium leading-none">
              {sale.customer?.name ?? 'Cliente General'}
            </p>
            <p className="text-sm text-muted-foreground">Venta {sale.id}</p>
          </div>
          <div className="ml-auto font-medium">{formatCurrency(sale.total)}</div>
        </div>
      ))}
    </div>
  );
}
