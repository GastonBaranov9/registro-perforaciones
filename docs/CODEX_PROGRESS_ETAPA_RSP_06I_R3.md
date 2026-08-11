# Progreso ETAPA-RSP-06I-R3 — cerrar creación standalone de sitios

## Resultado

Se cerró el P1 que permitía a perforadores crear sitios independientes que luego no podían gestionar.

- `POST /usuarios/:id_usuario/sitios` conserva utilidad para administración y rechaza a perforadores con 403 antes del INSERT.
- El flujo de perforador es exclusivamente `POST /usuarios/:id_usuario/pozos/completo` con `sitio_nuevo`, que crea sitio y pozo en una misma transacción.
- Los sitios creados por ese flujo siguen siendo gestionables por el perforador que figura en el pozo; el aislamiento frente a otros perforadores se conserva.
- Edición de coordenadas, consulta y mapa siguen usando la relación persistente sitio-pozo.
- El frontend oculta “CREAR UN SITIO” a perforadores y la ruta standalone queda protegida por `isAdminGuard`. La creación de pozo no fue rediseñada.
- No se añadió `creator_id` ni migración.

## Pruebas

- `api/test/sitios-standalone.test.ts`: perforador 403 sin INSERT y administración 201.
- Pruebas focales de creación atómica/rollback y propietario operativo: 16/16.
- `api/test/rsp06i-r3-http.local.ts`: HTTP real con perforador standalone 403, cero sitio temporal, administración 201, pozo+sitio atómico 201, consulta 200 y edición 200.
- La prueba frontend de `SitioPage` confirma que un perforador no ve la acción standalone.

## Validación final

Resultado final: build API correcto; suite API 126/126; `check:utf8` correcto; build frontend correcto; suite frontend 148/148; HTTP real correcto; cero sitios `RSP06I-R3` temporales; `git diff --check` correcto.
