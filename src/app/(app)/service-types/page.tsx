'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { ServiceTypeDataTable } from '@/components/services/service-type-data-table';
import { createServiceTypeColumns } from '@/components/services/service-type-columns';
import { ServiceTypeDialog } from '@/components/services/service-type-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { rowToServiceType } from '@/lib/supabase/mappers';
import type { ServiceType } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

export default function ServiceTypesPage() {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .order('name');
    
    if (error) {
        console.error(error);
        toast({ title: 'Error cargando tipos de servicio', variant: 'destructive' });
        return;
    }
    if (data) {
        setServiceTypes(data.map(rowToServiceType));
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este tipo de servicio?')) return;
    const { error } = await supabase.from('service_types').delete().eq('id', id);
    if (error) {
        console.error(error);
        toast({ title: 'Error al eliminar', variant: 'destructive' });
    } else {
        toast({ title: 'Tipo de servicio eliminado' });
        loadData();
    }
  };

  const columns = createServiceTypeColumns(loadData, handleDelete);

  return (
    <div>
      <PageHeader title="Tipos de Servicio">
        <ServiceTypeDialog onSuccess={loadData}>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Tipo de Servicio
          </Button>
        </ServiceTypeDialog>
      </PageHeader>
      <ServiceTypeDataTable columns={columns} data={serviceTypes} />
    </div>
  );
}
