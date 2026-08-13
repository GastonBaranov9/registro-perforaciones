# ETAPA-RSP-06H-B-R2 — Correcciones de review

## Estado

- Fresh install: `api/db/scripts.sql` reutiliza `migrations/003_catalogo_litologias.sql` mediante `\ir`; quedan catálogo, 29 semillas, función de normalización, FK nullable e índice.
- Creación independiente: el formulario registra `id_litologia` en su `NgForm`; creación exige selección y edición conserva históricos sin vínculo o con litología inactiva.
- Nombres: PostgreSQL rechaza nombres cuyo valor normalizado es vacío y el servicio API responde 400 antes de insertar.

## Validación

- `api`: build TypeScript correcto.
- `front`: build Angular correcto.
- Prueba focalizada `api/test/catalogo-litologias.test.ts`: 5/5.
- La ejecución Karma focalizada no fue posible en el entorno por dependencias de testing ausentes; el build Angular sí valida las plantillas.
- No se modificó ninguna base habitual ni se creó una base temporal en esta pasada.
