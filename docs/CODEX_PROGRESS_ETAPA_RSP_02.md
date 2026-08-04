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

## Bloques pendientes

- Bloque 3: auditoría de `isPropGuard`.
- Bloque 4: pruebas automáticas posibles.
- Bloque 5: auditoría final.

## Advertencias conocidas

- Ninguna propia de la campaña en este punto.

## Decisiones pendientes

- Ninguna.

## Trabajo no realizado

- Los cambios expresamente fuera de alcance de la campaña no se implementarán.
