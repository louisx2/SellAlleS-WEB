-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim
-- (incluidos los comentarios en inglés).
--
-- Transferir existencias entre sucursales en una sola transacción: baja del
-- origen y sube en el destino, buscando el mismo artículo por código y, si no,
-- por nombre. Si no existe allá, lo clona.
--
-- Ojo: esta versión quedó sin `set search_path`. Lo corrige la migración
-- 20260731004547_asegurar_transfer_product_stock.

-- Function to transfer product stock between branches safely
CREATE OR REPLACE FUNCTION public.transfer_product_stock(
    p_product_id UUID,
    p_quantity NUMERIC,
    p_target_branch_id UUID,
    p_current_branch_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_source_product public.products%ROWTYPE;
    v_target_product_id UUID;
    v_company_id UUID;
BEGIN
    -- 1. Check if source product exists and has enough stock
    SELECT * INTO v_source_product
    FROM public.products
    WHERE id = p_product_id AND branch_id = p_current_branch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto de origen no encontrado o no pertenece a la sucursal activa.';
    END IF;

    IF v_source_product.stock < p_quantity THEN
        RAISE EXCEPTION 'Stock insuficiente para transferir.';
    END IF;

    v_company_id := v_source_product.company_id;

    -- 2. Verify target branch belongs to same company
    IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_target_branch_id AND company_id = v_company_id) THEN
        RAISE EXCEPTION 'La sucursal destino no es válida.';
    END IF;

    -- 3. Find matching product in target branch by code (if code exists) or name
    IF v_source_product.code IS NOT NULL AND v_source_product.code != '' THEN
        SELECT id INTO v_target_product_id
        FROM public.products
        WHERE branch_id = p_target_branch_id AND code = v_source_product.code
        LIMIT 1;
    END IF;

    -- If not found by code, try by name
    IF v_target_product_id IS NULL THEN
        SELECT id INTO v_target_product_id
        FROM public.products
        WHERE branch_id = p_target_branch_id AND name = v_source_product.name
        LIMIT 1;
    END IF;

    -- 4. Decrement source stock
    UPDATE public.products
    SET stock = stock - p_quantity
    WHERE id = p_product_id;

    -- 5. Increment or create target product
    IF v_target_product_id IS NOT NULL THEN
        UPDATE public.products
        SET stock = stock + p_quantity
        WHERE id = v_target_product_id;
    ELSE
        -- Insert clone of product
        INSERT INTO public.products (
            company_id, branch_id, name, code, price, cost, itbis,
            image, stock, category_id, description, supplier_id,
            location_id, unit, tracks_stock, wholesale_price, wholesale_min_quantity
        ) VALUES (
            v_company_id, p_target_branch_id, v_source_product.name, v_source_product.code, v_source_product.price, v_source_product.cost, v_source_product.itbis,
            v_source_product.image, p_quantity, v_source_product.category_id, v_source_product.description, v_source_product.supplier_id,
            v_source_product.location_id, v_source_product.unit, v_source_product.tracks_stock, v_source_product.wholesale_price, v_source_product.wholesale_min_quantity
        ) RETURNING id INTO v_target_product_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'target_product_id', v_target_product_id);
END;
$$;
