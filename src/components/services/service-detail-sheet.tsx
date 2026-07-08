import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Service, ServiceItem, Product } from '@/lib/types';
import { rowToService, rowToServiceItem } from '@/lib/supabase/mappers';
import { Trash } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface ServiceDetailSheetProps {
  serviceId: string | null;
  onClose: () => void;
  onUpdate: () => void;
}

export function ServiceDetailSheet({ serviceId, onClose, onUpdate }: ServiceDetailSheetProps) {
  const { toast } = useToast();
  const [service, setService] = useState<Service | null>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (serviceId) {
      loadService(serviceId);
      loadProducts();
    } else {
      setService(null);
      setItems([]);
    }
  }, [serviceId]);

  const loadService = async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('services')
      .select('*, customers(id,name,phone), service_types(id,name,base_price), profiles(id,name,email,role), branches(name)')
      .eq('id', id)
      .single();
    if (data) {
        setService(rowToService(data));
        // load items
        const { data: itemsData } = await supabase
            .from('service_items')
            .select('*, products(id,name,price,stock,code)')
            .eq('service_id', id);
        if (itemsData) setItems(itemsData.map(rowToServiceItem));
    }
    setLoading(false);
  };

  const loadProducts = async () => {
    const { data } = await supabase.from('products').select('id,name,price,stock,cost,code').gt('stock', 0);
    if (data) {
        setProducts(data as Product[]);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!service) return;
    const { error } = await supabase.from('services').update({ status: newStatus }).eq('id', service.id);
    if (error) {
        toast({ title: 'Error', variant: 'destructive' });
    } else {
        toast({ title: 'Estado actualizado' });
        loadService(service.id);
        onUpdate();
    }
  };

  const addItem = async () => {
      if (!service || !selectedProduct) return;
      const product = products.find(p => p.id === selectedProduct);
      if (!product) return;
      if (qty > product.stock) {
          toast({ title: 'Stock insuficiente', variant: 'destructive' });
          return;
      }

      const { error } = await supabase.from('service_items').insert({
          service_id: service.id,
          product_id: product.id,
          quantity: qty,
          price: product.price,
          cost: product.cost || 0
      });

      if (error) {
          toast({ title: 'Error al agregar repuesto', variant: 'destructive' });
      } else {
          toast({ title: 'Repuesto agregado' });
          setSelectedProduct('');
          setQty(1);
          loadService(service.id);
          loadProducts(); // refresh stock
          onUpdate();
      }
  };

  const removeItem = async (itemId: string) => {
      if (!service) return;
      const { error } = await supabase.from('service_items').delete().eq('id', itemId);
      if (!error) {
          toast({ title: 'Repuesto removido' });
          loadService(service.id);
          loadProducts();
          onUpdate();
      }
  };

  const markAsPaid = async () => {
      if (!service) return;
      const { error } = await supabase.from('services').update({ payment_status: 'paid', amount_paid: service.total }).eq('id', service.id);
      if (!error) {
          toast({ title: 'Servicio cobrado' });
          loadService(service.id);
          onUpdate();
      }
  };

  if (!service) return null;

  return (
    <Sheet open={!!serviceId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Servicio #{service.id.split('-')[0]}</SheetTitle>
          <SheetDescription>
            {service.description}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                    <span className="text-muted-foreground block">Cliente</span>
                    <span className="font-medium">{service.customer?.name || 'Mostrador'}</span>
                </div>
                <div>
                    <span className="text-muted-foreground block">Técnico</span>
                    <span className="font-medium">{service.assignedUser?.name || 'Sin asignar'}</span>
                </div>
                <div>
                    <span className="text-muted-foreground block">Tipo</span>
                    <span className="font-medium">{service.serviceType?.name}</span>
                </div>
                <div>
                    <span className="text-muted-foreground block">Estado</span>
                    <Select value={service.status} onValueChange={updateStatus}>
                        <SelectTrigger className="h-8 mt-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="in_progress">En Proceso</SelectItem>
                            <SelectItem value="completed">Completado</SelectItem>
                            <SelectItem value="cancelled">Cancelado</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Repuestos (Items)</h4>
                
                {service.status !== 'completed' && service.status !== 'cancelled' && service.paymentStatus !== 'paid' && (
                    <div className="flex gap-2 mb-4">
                        <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder="Buscar repuesto en inventario..." />
                            </SelectTrigger>
                            <SelectContent>
                                {products.map(p => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name} (Stock: {p.stock}) - ${p.price}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-20" />
                        <Button onClick={addItem} disabled={!selectedProduct}>Añadir</Button>
                    </div>
                )}

                <div className="space-y-2">
                    {items.map(item => (
                        <div key={item.id} className="flex justify-between items-center bg-muted/50 p-2 rounded text-sm">
                            <div>
                                <span className="font-medium">{item.product.name}</span>
                                <span className="text-muted-foreground ml-2">x{item.quantity}</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <span>${item.price * item.quantity}</span>
                                {service.status !== 'completed' && service.paymentStatus !== 'paid' && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem(item.id)}>
                                        <Trash className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && <p className="text-sm text-muted-foreground">No se han usado repuestos.</p>}
                </div>
            </div>

            <div className="border-t pt-4 space-y-2 text-right">
                <div className="text-sm text-muted-foreground">
                    Mano de obra: ${service.laborPrice}
                </div>
                <div className="text-sm text-muted-foreground">
                    Repuestos: ${service.partsTotal}
                </div>
                <div className="text-lg font-bold">
                    Total: ${service.total}
                </div>
            </div>

            {service.paymentStatus === 'pending' && service.status === 'completed' && (
                <div className="pt-4 flex justify-end">
                    <Button onClick={markAsPaid} className="w-full sm:w-auto">Registrar Cobro</Button>
                </div>
            )}
            {service.paymentStatus === 'paid' && (
                <div className="pt-4 flex justify-end">
                    <div className="bg-green-100 text-green-800 px-4 py-2 rounded font-medium">Cobrado</div>
                </div>
            )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
