-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.

-- Delmas Principal llega del sistema viejo con control de caja. Se enciende el
-- modulo para la empresa y la bandera solo en esa sucursal: R.A y Todo Para
-- Iphone se quedan con caja_enabled = false y siguen cobrando en efectivo sin
-- abrir caja, igual que hasta hoy.
insert into public.company_modules (company_id, module_key, enabled)
values ('4b3b00e8-ef6b-4fe2-8d32-3489c73ac099', 'caja', true)
on conflict (company_id, module_key) do update set enabled = true;

update public.branches
   set caja_enabled = true
 where id = 'd1e2c3b4-0002-4000-8000-000000000002';
