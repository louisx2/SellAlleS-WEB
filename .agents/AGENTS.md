# Reglas del Proyecto SellAlleS WEB

## Resoluciones y Patrones de Interfaz (Radix UI / Shadcn)
- **Congelamiento de Modales (Pointer-Events):** Cuando un Modal/Dialog (de Radix/Shadcn) ejecute una mutación de estado global (como actualizar un perfil o entidad) y se congele la página (`pointer-events` atascado en el `body`), la solución estándar a aplicar en este proyecto es:
  1. Mostrar un toast informando de la carga/éxito.
  2. Cerrar el modal programáticamente (`onOpenChange(false)`).
  3. Ejecutar una recarga nativa de la página mediante `setTimeout(() => window.location.reload(), 800)`.
  *Nota: Esta estrategia de recarga forzada (hard reload) fue solicitada explícitamente por el usuario para garantizar que la pantalla no se quede bloqueada tras guardar datos en modales problemáticos.*
