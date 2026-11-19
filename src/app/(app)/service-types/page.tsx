'use client';

import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/hooks/use-permission';
import { useTallerConfig } from '@/components/taller/use-taller-config';
import { GeneralTab } from '@/components/taller/config/general-tab';
import { EquipmentTab } from '@/components/taller/config/equipment-tab';
import { ChecklistTab } from '@/components/taller/config/checklist-tab';
import { CatalogTab } from '@/components/taller/config/catalog-tab';
import { TechniciansTab } from '@/components/taller/config/technicians-tab';

// Configuración del Taller. La ruta conserva el nombre viejo (/service-types)
// para no romper los permisos ni los enlaces guardados.
export default function TallerConfigPage() {
  const config = useTallerConfig();
  const canEdit = usePermission('service-types', 'edit');

  return (
    <div>
      <PageHeader title="Configuración del Taller" />
      {config.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Tabs defaultValue={config.equipmentTypes.length === 0 ? 'equipos' : 'general'}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="equipos">Tipos de equipo</TabsTrigger>
              <TabsTrigger value="chequeos">Chequeos</TabsTrigger>
              <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
              <TabsTrigger value="tecnicos">Técnicos</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="general"><GeneralTab config={config} canEdit={canEdit} /></TabsContent>
          <TabsContent value="equipos"><EquipmentTab config={config} canEdit={canEdit} /></TabsContent>
          <TabsContent value="chequeos"><ChecklistTab config={config} canEdit={canEdit} /></TabsContent>
          <TabsContent value="catalogo"><CatalogTab config={config} canEdit={canEdit} /></TabsContent>
          <TabsContent value="tecnicos"><TechniciansTab config={config} canEdit={canEdit} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
