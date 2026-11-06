-- Nombre que la empresa quiere ver en el enlace del comprobante:
--
--     https://sellalles.com/<link_slug>/c/7Kq2Wp
--
-- Hasta ahora salia del nombre legal, que casi nunca es el bueno: "inventar.io"
-- quedaba como "inventar-io" y una empresa registrada como
-- "MICHELLE AUTOSERVICES SRL" arrastraba el SRL delante del cliente.
--
-- Nulo = se sigue derivando del nombre de la empresa, asi que nadie tiene que
-- configurar nada para que funcione.
--
-- No se exige que sea unico a proposito. El segmento es decorativo -- quien
-- autoriza la descarga es el codigo -- asi que dos ferreterias pueden
-- llamarse igual sin pisarse, y nadie se topa con un "ese nombre ya existe".
alter table public.companies add column if not exists link_slug text;

-- El formato si se exige, porque va crudo en una URL: minusculas, numeros y
-- guiones, sin empezar ni terminar en guion, maximo 32.
alter table public.companies drop constraint if exists companies_link_slug_formato;
alter table public.companies add constraint companies_link_slug_formato
  check (link_slug is null or link_slug ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$');

comment on column public.companies.link_slug is
  'Nombre de la empresa en el enlace del comprobante. Decorativo: el permiso lo da el codigo de receipt_links. Nulo = se deriva de name.';
