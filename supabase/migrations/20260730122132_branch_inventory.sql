-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim
-- (incluidos los comentarios en inglés y el DELETE del backfill).
--
-- Inventario por sucursal: cada producto pertenece a una sucursal, no a la
-- empresa entera.

-- Add branch_id to products
ALTER TABLE public.products ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE;

-- Backfill branch_id with the first branch of the company
UPDATE public.products p
SET branch_id = (
    SELECT id FROM public.branches b
    WHERE b.company_id = p.company_id
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE branch_id IS NULL;

-- Delete products that have no branches
DELETE FROM public.products WHERE branch_id IS NULL;

-- Make branch_id NOT NULL
ALTER TABLE public.products ALTER COLUMN branch_id SET NOT NULL;
