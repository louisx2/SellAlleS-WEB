'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Shield, Mail, LayoutGrid, RefreshCw } from 'lucide-react';

type TicketStatus = 'open' | 'pending' | 'closed';

interface Ticket {
  id: string;
  code: string;
  company_id: string | null;
  contact_email: string;
  contact_name: string | null;
  subject: string;
  status: TicketStatus;
  source: 'app' | 'email';
  last_message_at: string;
  created_at: string;
}

interface Message {
  id: string;
  ticket_id: string;
  direction: 'inbound' | 'outbound';
  from_email: string | null;
  body_text: string | null;
  body_html: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Abierto',
  pending: 'Esperando al cliente',
  closed: 'Cerrado',
};

const STATUS_VARIANT: Record<TicketStatus, 'default' | 'secondary' | 'outline'> = {
  open: 'default',
  pending: 'secondary',
  closed: 'outline',
};

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function SupportInboxPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TicketStatus | 'all'>('open');

  const [active, setActive] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: comps }] = await Promise.all([
      supabase.from('support_tickets').select('*').order('last_message_at', { ascending: false }),
      supabase.from('companies').select('id, name'),
    ]);
    if (rows) setTickets(rows as Ticket[]);
    if (comps) setCompanies(Object.fromEntries((comps as { id: string; name: string }[]).map((c) => [c.id, c.name])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openTicket = async (ticket: Ticket) => {
    setActive(ticket);
    setReply('');
    setLoadingThread(true);
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
    setLoadingThread(false);
  };

  const handleReply = async () => {
    if (!active || !reply.trim()) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('support-ticket', {
      body: { action: 'reply', ticketId: active.id, message: reply.trim() },
    });
    setSending(false);

    const errMsg = (data as { error?: string })?.error ?? error?.message;
    if (errMsg) {
      toast({ variant: 'destructive', title: 'No se pudo enviar la respuesta', description: errMsg });
      return;
    }
    toast({ title: 'Respuesta enviada', description: `Se envió a ${active.contact_email}.` });
    setReply('');
    await openTicket(active);
    await load();
  };

  const handleStatus = async (status: TicketStatus) => {
    if (!active) return;
    const { data, error } = await supabase.functions.invoke('support-ticket', {
      body: { action: 'set_status', ticketId: active.id, status },
    });
    const errMsg = (data as { error?: string })?.error ?? error?.message;
    if (errMsg) {
      toast({ variant: 'destructive', title: 'No se pudo cambiar el estado', description: errMsg });
      return;
    }
    setActive({ ...active, status });
    await load();
  };

  const visible = useMemo(
    () => (filter === 'all' ? tickets : tickets.filter((t) => t.status === filter)),
    [tickets, filter],
  );

  if (!appUser?.isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Solo para administradores de la plataforma</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Esta bandeja reúne las solicitudes de soporte de todas las empresas.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Soporte">
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as TicketStatus | 'all')}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Abiertos</SelectItem>
              <SelectItem value="pending">Esperando al cliente</SelectItem>
              <SelectItem value="closed">Cerrados</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Cargando…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {filter === 'open' ? 'No hay solicitudes abiertas.' : 'Nada por aquí.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Ref.</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>De</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Último mensaje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => openTicket(t)}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {t.source === 'email'
                          ? <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          : <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        {t.subject}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{t.contact_name ?? t.contact_email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.company_id ? (companies[t.company_id] ?? '—') : 'Sin empresa'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {fmtDateTime(t.last_message_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{active.code}</span>
                  {active.subject}
                </DialogTitle>
                <DialogDescription>
                  {active.contact_name ? `${active.contact_name} · ` : ''}{active.contact_email}
                  {active.company_id ? ` · ${companies[active.company_id] ?? ''}` : ' · Sin empresa asociada'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {loadingThread ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Cargando conversación…</p>
                ) : messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.direction === 'outbound'
                        ? 'rounded-lg border bg-primary/5 p-3 ml-8'
                        : 'rounded-lg border bg-muted/40 p-3 mr-8'
                    }
                  >
                    <p className="text-[11px] text-muted-foreground mb-1">
                      {m.direction === 'outbound' ? 'Soporte' : (m.from_email ?? 'Cliente')} · {fmtDateTime(m.created_at)}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">
                      {m.body_text?.trim() || '(sin texto plano — el correo venía solo en HTML)'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Textarea
                  placeholder="Escribe tu respuesta. Se envía por correo al cliente."
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <div className="flex gap-2 sm:mr-auto">
                  {active.status !== 'closed' ? (
                    <Button variant="outline" onClick={() => handleStatus('closed')}>Cerrar ticket</Button>
                  ) : (
                    <Button variant="outline" onClick={() => handleStatus('open')}>Reabrir</Button>
                  )}
                </div>
                <Button onClick={handleReply} disabled={sending || !reply.trim()}>
                  {sending ? 'Enviando...' : 'Responder por correo'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
