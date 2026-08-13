# ETAPA RSP-06H-B-R1 — Preservación de litologías históricas inactivas

## Causa raíz

La edición completa eliminaba los intervalos y los reinsertaba sin transportar el identificador del intervalo original. El helper de inserción exigía `catalogo_litologia.activo`, por lo que una FK histórica inactiva no podía sobrevivir al reemplazo. La edición independiente tenía la misma restricción activa-only.

## Corrección

- `id_intervalo_litologico` es opcional en el body para que la edición completa identifique el intervalo persistido.
- La edición completa lee los intervalos originales con `FOR UPDATE` dentro de la transacción y bajo el advisory lock del pozo antes de borrar/reinsertar.
- Una litología inactiva solo se acepta si el ID enviado coincide con la FK original del mismo intervalo.
- Una asignación nueva, una FK inexistente o una litología inactiva distinta devuelve 400.
- Un histórico sin FK permanece NULL sin coincidencia automática y solo se vincula mediante selección activa explícita.
- La actualización independiente bloquea el intervalo con `FOR UPDATE`, relee su FK y permite únicamente la misma inactiva o una activa nueva.
- Las filas de catálogo elegidas se leen con `FOR SHARE`, preservando la linealización frente a desactivaciones concurrentes.

No se modificaron migraciones, frontend visual, PDF, paleta, fotografías, mapas, autenticación ni autorización.

## Pruebas

- Focalizadas API: 23/23.
- Suite API completa: 107/107.
- Build frontend: correcto.
- Suite frontend completa: 133/133.
- `npm run check:utf8`: correcto.
- PostgreSQL local controlado `rsp06h-b-r1.local.ts`: creación inactiva 400, conservación independiente y completa de la misma inactiva, rechazo de distinta inactiva, histórico NULL, perfil y PDF correctos; limpieza de datos temporales completada.
- `git diff --check`: correcto.

## Commits

Se creó el commit local `8444ae1` para la corrección y sus pruebas. Los commits previos de RSP-06H-B no se reescribieron.

## Riesgos residuales

Clientes antiguos que no envíen `id_intervalo_litologico` en edición completa no pueden demostrar identidad histórica; en ese caso una inactiva no se acepta silenciosamente. Los flujos Angular actuales sí conservan y envían el identificador. No quedan cambios de RSP-06H-C.
