import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { REGISTRATION_STATUS_LABEL, VEHICLE_STATUS, type RegistrationStatus, type VehicleStatus } from '@/lib/motos';

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const s = VEHICLE_STATUS[status];
  return <Badge variant="outline" className={cn('border-transparent whitespace-nowrap', s.badge)}>{s.label}</Badge>;
}

/** La matrícula solo se muestra cuando importa (no "No aplica"). */
export function RegistrationText({ status }: { status: RegistrationStatus }) {
  if (status === 'no_aplica') return <span className="text-muted-foreground">—</span>;
  return <span className={status === 'en_custodia' ? 'font-medium' : ''}>{REGISTRATION_STATUS_LABEL[status]}</span>;
}
