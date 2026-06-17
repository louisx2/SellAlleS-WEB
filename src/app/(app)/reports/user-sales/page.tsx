'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useUsers } from '@/context/user-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';


export default function UserSalesReportPage() {
  const { sales } = useSales();
  const { users } = useUsers();

  const salesByUser = useMemo(() => {
    const userSalesMap = new Map<string, { totalSales: number; totalRevenue: number; userName: string }>();

    sales.forEach(sale => {
      // Use userEmail as a key if available, otherwise 'unknown'
      const userKey = sale.userEmail || 'unknown';
      
      const currentUserData = userSalesMap.get(userKey) || { totalSales: 0, totalRevenue: 0, userName: sale.userName || 'Usuario Desconocido' };

      userSalesMap.set(userKey, {
        totalSales: currentUserData.totalSales + 1,
        totalRevenue: currentUserData.totalRevenue + sale.total,
        userName: currentUserData.userName,
      });
    });

    return Array.from(userSalesMap.entries())
      .map(([userEmail, data]) => ({
        userEmail,
        ...data,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

  }, [sales, users]);

  return (
    <div>
      <PageHeader title="Reporte de Ventas por Usuario" />

       <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Desglose de Ventas por Cajero/Vendedor</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Ventas Realizadas</TableHead>
                <TableHead className="text-right">Ingresos Generados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salesByUser.length > 0 ? (
                salesByUser.map((userSale) => (
                  <TableRow key={userSale.userEmail}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                            <AvatarFallback>{userSale.userName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{userSale.userName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{userSale.userEmail}</TableCell>
                    <TableCell className="text-right font-bold">{userSale.totalSales}</TableCell>
                    <TableCell className="text-right">{formatCurrency(userSale.totalRevenue)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No hay datos de ventas para mostrar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

    