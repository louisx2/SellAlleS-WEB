'use client';

import { PageHeader } from '@/components/page-header';
import { CategoryManager } from '@/components/products/category-manager';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function CategoriesPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Gestionar Categorías" />
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Categorías de Productos</CardTitle>
          <CardDescription>
            Crea, edita o elimina las categorías que se utilizan para clasificar los productos de tu inventario.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryManager />
        </CardContent>
      </Card>
    </div>
  );
}
