# Brief del Landing Page — SellAlleS (para construir con Gemini)

Documento guía para que un asistente (Gemini) genere la landing page de SellAlleS.
Copia este contenido como contexto/prompt.

## 1. Qué es SellAlleS
Un Punto de Venta (POS) web en la nube, tipo SaaS, para negocios de República
Dominicana. Multi-empresa y multi-sucursal: cada negocio gestiona ventas,
inventario, clientes, crédito y reportes desde cualquier dispositivo con navegador.
Juego de palabras: "Sell ALL E.S" = Vender Todo (Encarnación Sánchez).

## 2. Objetivo del landing
Convertir visitantes en registros de prueba. Acción principal (CTA):
"Crear cuenta gratis" / "Empieza gratis". Acción secundaria: "Ver demo".

## 3. Público objetivo
Dueños de PYMES dominicanas: colmados, tiendas de tecnología/accesorios, boutiques,
ferreterías, farmacias pequeñas, negocios con una o varias sucursales. Personas
prácticas, no técnicas. Mensaje claro, directo, en español dominicano neutro.

## 4. Propuesta de valor (mensajes clave)
- Vende más rápido: POS ágil, búsqueda por nombre o código de barras, varios carritos.
- Controla tu inventario en tiempo real, por sucursal.
- Maneja crédito y financiamiento con cuotas e intereses, y cobra a tiempo.
- Reportes claros: ventas por día, por sucursal, por producto, por vendedor.
- Multi-sucursal desde una sola cuenta.
- **Empieza sin complicaciones fiscales**: úsalo aunque tu negocio no esté
  formalizado en DGII. Cuando quieras, actívalo para emitir comprobantes (NCF/e-CF).
- En la nube: sin instalar nada, acceso desde cualquier lugar.

## 5. Tono y estilo
Cercano, confiable, profesional pero simple. Frases cortas. Beneficios antes que
características técnicas. Evitar jerga. Español de RD neutro.

## 6. Identidad visual (debe combinar con la app)
- Tipografía: **PT Sans** (Google Fonts), igual que la app.
- Color primario (azul cielo): `hsl(197 71% 53%)` ≈ `#30A8DE`.
- Color de acento (naranja, para CTAs): `hsl(39 100% 50%)` ≈ `#FF9E00`.
- Fondo claro: gris muy suave `hsl(220 13% 95%)`; tarjetas blancas.
- Texto oscuro: `hsl(222 84% 4.9%)`.
- Bordes redondeados ~8px (radius 0.5rem), sombras suaves, mucho espacio en blanco.
- Estética limpia y moderna, tipo dashboards SaaS. Íconos estilo lucide-react.
- Mockups/capturas del dashboard y del POS como prueba visual.

## 7. Estructura de secciones (en orden)
1. **Navbar**: logo SellAlleS (ícono de tienda), enlaces (Características, Precios,
   Preguntas), botón "Iniciar sesión" y CTA "Crear cuenta gratis".
2. **Hero**: titular fuerte + subtítulo + CTA primario (naranja) + CTA secundario
   (ver demo). A la derecha, captura del dashboard.
   - Titular sugerido: "El punto de venta que crece con tu negocio."
   - Subtítulo: "Vende, controla tu inventario y lleva tus cuentas desde la nube.
     Una o varias sucursales, sin instalar nada."
3. **Logos/credibilidad** (opcional): "Hecho para negocios dominicanos".
4. **Características** (grid de 6 tarjetas con ícono): POS rápido, Inventario por
   sucursal, Crédito y financiamiento, Reportes, Multi-sucursal, Clientes y NCF.
5. **Cómo funciona** (3 pasos): 1) Crea tu cuenta, 2) Agrega productos y sucursales,
   3) Empieza a vender. (Refuerza que no requiere formalización DGII para empezar).
6. **Sección DGII**: "Formalízate a tu ritmo". Explica que puede operar sin RNC y
   activar comprobantes fiscales (NCF / e-CF, Ley 32-23) cuando lo necesite.
7. **Precios** (3 planes, alineados a la base de datos):
   - **Gratis** — RD$0/mes: 1 sucursal, 2 usuarios. Para empezar.
   - **Pro** — RD$1,500/mes: 3 sucursales, 10 usuarios, financiamiento, reportes avanzados.
   - **Empresarial** — RD$4,500/mes: sucursales/usuarios ilimitados, facturación
     electrónica (e-CF DGII), soporte prioritario.
   (Marcar "Pro" como recomendado.)
8. **Preguntas frecuentes (FAQ)**: ¿Necesito estar formalizado en DGII? (No para
   empezar). ¿Funciona con varias sucursales? (Sí). ¿Mis datos están seguros?
   (Sí, aislados por empresa). ¿Necesito instalar algo? (No, es web).
9. **CTA final**: "Empieza gratis hoy" + botón naranja.
10. **Footer**: enlaces, contacto, redes (@sellalles.rd), aviso de derechos.

## 8. SEO / metadatos
- Título: "SellAlleS — Punto de Venta en la nube para tu negocio en RD".
- Descripción: "POS web multi-sucursal con inventario, crédito, reportes y
  facturación electrónica DGII. Empieza gratis."
- Idioma: es. Open Graph con imagen del dashboard.

## 9. Notas técnicas (recomendado)
- Implementar como página dentro del mismo proyecto Next.js (App Router), por
  ejemplo en una ruta pública `/` o `/landing`, separada del área `(app)`.
- Reutilizar Tailwind + los mismos tokens de color y PT Sans para consistencia.
- 100% responsiva (móvil primero). Botones de CTA llevan a `/login` (registro).

## 10. Prompt listo para Gemini
"Crea una landing page moderna y responsiva en Next.js (App Router) + Tailwind CSS
para 'SellAlleS', un POS web SaaS para negocios de República Dominicana. Usa la
tipografía PT Sans, color primario #30A8DE (azul cielo) y acento #FF9E00 (naranja)
para los botones de llamada a la acción, fondo gris muy claro y tarjetas blancas con
bordes redondeados y sombras suaves. Incluye estas secciones: navbar, hero con CTA
'Crear cuenta gratis', grid de 6 características (POS rápido, inventario por sucursal,
crédito y financiamiento, reportes, multi-sucursal, clientes y NCF), 'cómo funciona'
en 3 pasos, una sección que explique que el negocio puede empezar sin estar
formalizado en DGII y activar la facturación electrónica (NCF/e-CF) después, una
tabla de 3 planes (Gratis RD$0, Pro RD$1,500 recomendado, Empresarial RD$4,500), FAQ
y CTA final. Tono cercano y profesional en español. Textos orientados a beneficios."
