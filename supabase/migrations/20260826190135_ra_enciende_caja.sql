-- DelmasTechnology R.A tambien lleva caja.
--
-- Cuando se encendio el modulo para Pujols Group solo Delmas Principal quedo
-- con caja_enabled = true; R.A se quedo con la restriccion pero sin la funcion:
-- el checkout le escondia Efectivo y no tenia menu de Caja para abrir ninguna.
--
-- Se decide que R.A la lleve, como Principal. Con esto le vuelve el menu de
-- Caja y el cobro en efectivo queda disponible en cuanto abran la caja del dia.
-- Todo Para Iphone sigue en false: esa cobra sin caja.
update public.branches
   set caja_enabled = true
 where id = '4e3ee7e3-37c9-4e7d-a75f-e0254d664cda';
