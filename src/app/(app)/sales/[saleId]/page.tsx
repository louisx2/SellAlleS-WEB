'use client';

import { useRef } from 'react';
import { useParams } from 'next/navigation';
import { useReactToPrint } from 'react-to-print';
import { useSales } from '@/context/sales-provider';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { ReceiptContent } from '@/components/pos/receipt-content';

export default function SaleReceiptPage() {
  const params = useParams();
  const saleId = params.saleId as string;
  const { sales } = useSales();
  const sale = sales.find(s => s.id === saleId);
  const receiptRef = useRef(null);

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
  });

  if (!sale) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <h1 className="text-2xl font-bold mb-4">Venta no encontrada</h1>
            <p className="text-muted-foreground mb-6">No pudimos encontrar los detalles para la venta con ID: {saleId}</p>
            <Button asChild>
                <Link href="/sales">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver al Historial de Ventas
                </Link>
            </Button>
        </div>
    );
  }

  return (
    <div className="max-w-md mx-auto print:mx-0 print:max-w-full">
        <div className="mb-6 print:hidden">
            <Button asChild variant="outline">
                <Link href="/sales">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver al Historial
                </Link>
            </Button>
        </div>
      <Card className="print:shadow-none print:border-none">
        <CardHeader className="print:hidden" />
        <CardContent>
            <div ref={receiptRef} className="receipt-container">
                <ReceiptContent sale={sale} />
            </div>
        </CardContent>
        <CardFooter className="justify-end gap-2 print:hidden">
            <Button variant="outline" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
