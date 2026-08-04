# Progreso ETAPA-RSP-02

## Bloque 1 — Roles dinámicos en edición

- Estado: implementado y validado.
- Archivos modificados:
  - `front/src/app/routes/usuarios/pages/usuarios-edit/usuarios-edit.page.ts`
  - `front/src/app/routes/usuarios/pages/usuarios-edit/usuarios-edit.page.html`
- Cambios: carga conjunta de usuario y catálogo, deduplicación y reconciliación por `id_rol`, bloqueo de roles no disponibles y corrección de la condición de carrera usando el error propio del `resource`.
- Pruebas ejecutadas: `npm run build` en `front` (correcto).
- Revisión: no quedan escrituras a estado externo desde loaders obsoletos; el mensaje se obtiene de `userResource.error()`.
- Commit: pendiente.

## Bloques pendientes

- Bloque 2: validación frontend del body de roles.
- Bloque 3: auditoría de `isPropGuard`.
- Bloque 4: pruebas automáticas posibles.
- Bloque 5: auditoría final.

## Advertencias conocidas

- Ninguna propia de la campaña en este punto.

## Decisiones pendientes

- Ninguna.

## Trabajo no realizado

- Los cambios expresamente fuera de alcance de la campaña no se implementarán.
