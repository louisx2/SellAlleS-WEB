-- Realtime en las dos tablas donde ver datos viejos cuesta dinero o vergüenza:
-- el stock (que otro cajero acaba de bajar) y las ventas (que otro acaba de
-- registrar). Hasta ahora la app cargaba los datos una vez al arrancar y no
-- volvia a preguntar: la pantalla era una foto del momento en que se abrio.
--
-- Sobrevender no era posible ni antes -- el trigger
-- decrement_product_stock_for_sale_item descuenta con "and stock >= cantidad"
-- y revienta la venta si no alcanza -- pero el cajero veia "quedan 5", se lo
-- prometia al cliente y el error le saltaba al cobrar.
--
-- La publicacion ya existia (la crea Supabase) pero estaba vacia.
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.sales;

-- Nota sobre el aislamiento entre empresas: Realtime aplica las policies de RLS
-- a cada suscriptor, asi que un cajero solo recibe cambios de filas que ya
-- podria leer consultando. La excepcion conocida son los DELETE, que viajan con
-- la identidad de replica (solo la clave primaria) y no pasan por el filtro: de
-- una fila borrada en otra empresa puede llegar el uuid y nada mas. La app lo
-- ignora -- solo lo usa como senal para volver a consultar, y ahi manda RLS.
