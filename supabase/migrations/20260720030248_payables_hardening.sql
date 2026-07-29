-- Hardening post-advisors del módulo de Cuentas por Pagar.

-- seed_system_roles es un trigger (BEFORE/AFTER INSERT en companies) SECURITY
-- DEFINER: nunca debe poder llamarse vía /rest/v1/rpc. El trigger sigue
-- funcionando (create_my_company corre como owner).
revoke execute on function public.seed_system_roles() from public, anon, authenticated;

-- FK company_id sin índice de cobertura (advisor de performance).
create index supplier_invoice_items_company_idx on public.supplier_invoice_items (company_id);
