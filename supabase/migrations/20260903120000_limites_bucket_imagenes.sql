-- Red de seguridad del lado servidor para el bucket de imágenes.
--
-- El cliente ya comprime antes de subir (src/lib/image-optim.ts), pero eso vive
-- en el navegador: una caja con la PWA vieja en caché, un script, o una versión
-- futura que se salte la utilidad, pueden volver a meter fotos de 4 MB. Y con
-- más tenants entrando, el coste de ese descuido crece linealmente — en
-- producción bastó un solo tenant con 240 fotos sin optimizar para consumir el
-- cupo mensual de transferencia en 24 horas.
--
-- `comprobantes` ya tenía estos dos límites; `product-images` estaba sin
-- ninguno de los dos. Esto solo iguala la protección.
--
-- 2 MB deja margen de sobra: una imagen optimizada ronda los 120 kB y el logo
-- PNG más pesado que hay hoy no llega a 200 kB. Lo que corta es la foto cruda
-- de teléfono, que es justo lo que no debe volver a entrar.
update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array[
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/avif',
    'image/gif'
  ]
where id = 'product-images';
