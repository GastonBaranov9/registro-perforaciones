# Progreso ETAPA-RSP-02

## Bloque 1 — Roles dinámicos en edición

- Estado: implementado y validado.
- Archivos modificados:
  - `front/src/app/routes/usuarios/pages/usuarios-edit/usuarios-edit.page.ts`
  - `front/src/app/routes/usuarios/pages/usuarios-edit/usuarios-edit.page.html`
- Cambios: carga conjunta de usuario y catálogo, deduplicación y reconciliación por `id_rol`, bloqueo de roles no disponibles y corrección de la condición de carrera usando el error propio del `resource`.
- Pruebas ejecutadas: `npm run build` en `front` (correcto).
- Revisión: no quedan escrituras a estado externo desde loaders obsoletos; el mensaje se obtiene de `userResource.error()`.
- Commit: `e544436` (`feat: cargar roles dinamicamente al editar usuarios`).

## Bloque 2 — Validación frontend de roles

- Estado: implementado y revisado; commit pendiente.
- Archivos modificados:
  - `front/src/app/shared/utils/roles-seleccion.ts`
  - `front/src/app/shared/utils/roles-seleccion.spec.ts`
  - páginas de creación y edición de usuarios.
- Cambios: selección no vacía, pertenencia al catálogo, deduplicación y sustitución por objetos canónicos antes de crear o editar.
- Pruebas definidas: selección vacía, válida, múltiple, duplicada, ajena y edición sin cambios.
- Resultados:
  - `npm run build` en `front`: correcto.
  - prueba Angular dirigida: bloqueada por un error preexistente en `intervalo-lit-form.component.spec.ts` (importación default inexistente); se reintentó fuera del sandbox con el mismo resultado.
- Commit: `1185309` (`feat: validar roles seleccionados en usuarios`).

## Bloques pendientes

- Bloque 5: auditoría final.

## Bloque 4 — Pruebas automáticas

- Estado: implementado y revisado; commit pendiente.
- Infraestructura: corregida una importación inválida en un spec y configurados `zone.js`/`zone.js/testing`, ya presentes transitivamente, para el target Karma.
- Cobertura añadida:
  - roles y reconciliación: nueve casos puros;
  - actualización: password ausente y password literal presente, dos casos puros;
  - guard propietario: propietario permitido y perforador rechazado, dos casos;
  - password API: longitud mínima, solo blancos y espacios significativos, tres casos.
- Resultados:
  - utilidades frontend: 11/11 correctos;
  - guard: 2/2 correctos;
  - password API con `node --test`: 3/3 correctos;
  - build API: correcto;
  - build frontend: correcto;
  - suite frontend completa: 65 ejecutados, 15 correctos y 50 fallidos por configuración heredada de specs (principalmente proveedores HTTP ausentes y componentes standalone declarados como NgModule).
- No ejecutado:
  - sesiones activas/inactivas y reemplazo de password contra PostgreSQL: requieren aislar/inyectar el pool o una base de pruebas; no se usaron credenciales ni datos reales.

## Bloque 3 — Auditoría de `isPropGuard`

- Estado: corregido y revisado; commit pendiente.
- Evidencia: el nombre del guard, `userIsPropietario`, `isProp()` y el backend comprueban `propietario`; la comparación con `perforador` provenía del commit inicial y no tenía rutas consumidoras que justificaran otra regla.
- Cambio: `isPropGuard` acepta `propietario` y rechaza un usuario exclusivamente `perforador`.
- Pruebas añadidas: propietario permitido y perforador redirigido.
- Resultados:
  - `npm run build` en `front`: correcto.
  - prueba dirigida: bloqueada por la misma importación default preexistente en `intervalo-lit-form.component.spec.ts`.
- Commit: `0438544` (`fix: validar rol propietario en isPropGuard`).

## Advertencias conocidas

- Ninguna propia de la campaña en este punto.

## Decisiones pendientes

- Ninguna.

## Trabajo no realizado

- Los cambios expresamente fuera de alcance de la campaña no se implementarán.
