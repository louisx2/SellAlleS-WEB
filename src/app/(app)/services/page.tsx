'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { ServiceDataTable } from '@/components/services/service-data-table';
import { createServiceColumns } from '@/components/services/service-columns';
import { ServiceCreateDialog } from '@/components/services/service-create-dialog';
import { ServiceDetailSheet } from '@/components/services/service-detail-sheet';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { rowToService } from '@/lib/supabase/mappers';
import type { Service } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useSharing } from '@/context/sharing-provider';

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const { toast } = useToast();
  const { branchesFor, loading: sharingLoading } = useSharing();

  // services.branch_id es NOT NULL: una orden siempre es de una sucursal, así
  // que el pool de 'servicios' decide cuáles se ven.
  const branchesKey = branchesFor('servicios').join(',');

  const loadData = useCallback(async () => {
    if (sharingLoading) return;
    const branchIds = branchesKey.split(',').filter(Boolean);
    if (branchIds.length === 0) { setServices([]); return; }
    const { data, error } = await supabase
      .from('services')
      .select('*, customers(id,name,phone), service_types(id,name,base_price), profiles(id,name,email,role), branches(name)')
      .in('branch_id', branchIds)
      .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        toast({ title: 'Error cargando servicios', variant: 'destructive' });
        return;
    }
    if (data) {
        setServices(data.map(rowToService));
    }
  }, [toast, sharingLoading, branchesKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns = createServiceColumns((service) => setSelectedServiceId(service.id));

  return (
    <div>
      <PageHeader title="Servicios y Reparaciones">
        <ServiceCreateDialog onSuccess={loadData}>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Nuevo Servicio
          </Button>
        </ServiceCreateDialog>
      </PageHeader>
      
      <ServiceDataTable columns={columns} data={services} />

      <ServiceDetailSheet 
        serviceId={selectedServiceId} 
        onClose={() => setSelectedServiceId(null)} 
        onUpdate={loadData}
      />
    </div>
  );
}
