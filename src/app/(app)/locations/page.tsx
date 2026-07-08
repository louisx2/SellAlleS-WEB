'use client';

import { PageHeader } from '@/components/page-header';
import { LocationManager } from '@/components/products/location-manager';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function LocationsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Gestionar Ubicaciones" />
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Ubicaciones de Productos</CardTitle>
          <CardDescription>
            Crea, edita o elimina las ubicaciones físicas que se utilizan para organizar los productos de tu inventario.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LocationManager />
        </CardContent>
      </Card>
    </div>
  );
}
