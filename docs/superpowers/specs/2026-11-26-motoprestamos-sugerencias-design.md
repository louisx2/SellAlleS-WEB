# Motopréstamos — Sugerencias al encender el módulo (diseño corto)

Aprobado por Louis el 2026-11-26.

## Intención

Al encender Motopréstamos, la empresa encuentra ya cargados los tipos de vehículo y las
categorías del inventario más comunes. Son sugerencias: se editan o se borran como cualquier otro.

## Cómo está hoy

- El módulo se enciende desde «Módulos» del panel de empresas (`company-modules-dialog.tsx`,
  upsert en `company_modules`) o al dar de alta una empresa con el rubro Motopréstamos
  (`admin/empresas`).
- Solo el alta con el rubro carga algo: el tipo de vehículo «Motor» (`preset.vehicleTypes`).
- `vehicle_types` es por empresa. `product_categories` es por sucursal, y se comparte entre las
  sucursales de un pool (`company_branch_sharing` y `branch_sharing`, ámbito `categorias`).
  Ninguna de las dos tablas impide nombres repetidos.

## Decisiones

- **Dónde:** en la base, para que no dependa de qué pantalla encendió el módulo.
  - Un trigger en `company_modules` actúa cuando Motopréstamos queda encendido: al insertarse
    encendido, o al pasar de apagado a encendido.
  - Un trigger en `branches` carga las categorías de una sucursal nueva si la empresa ya tiene el
    módulo encendido.
  - La carga de «Motor» que hace hoy el alta con el rubro se quita, para que no se duplique.
- **Solo lo que falta:** un nombre que ya existe, sin importar mayúsculas, no se repite.
  - En los tipos de vehículo se mira toda la empresa.
  - En las categorías se mira la sucursal y, si comparte categorías en un pool, las demás
    sucursales del pool. Así una categoría no aparece dos veces donde se ven juntas.
- **Apagar y volver a encender** no borra nada y no duplica, pero vuelve a sugerir lo que se haya
  borrado.
- **Tipos de vehículo:** Motor, Pasola, Carro, Jeepeta, Camioneta. Sin datos extra; van detrás de
  los que ya existan.
- **Categorías de inventario:** Motores, Pasolas, Repuestos, Accesorios.

## Enfoques descartados

- Que la pantalla de Módulos las cargue: el alta con el rubro no pasaría por ahí.
- Mostrar las sugerencias para aceptarlas una por una: Louis pidió que se carguen solas.
