# ETAPA-RSP-06H-B-R3 — Correcciones de review

- Vista previa: resuelve los IDs de litología en una consulta agrupada, incluye nombre/color/patrón (también históricos inactivos) y conserva fallback para FK nula.
- Colores: el formulario y el servicio API normalizan a `#RRGGBB`; el contrato acepta mayúsculas y minúsculas válidas y rechaza formatos inválidos.
- Concurrencia: la creación independiente toma `FOR SHARE` sobre la fila activa del catálogo dentro de la misma sentencia/transacción de inserción.

Validación focalizada: 34 pruebas API y build API/frontend correctos; PostgreSQL local aceptó la consulta con bloqueo. Suites completas y comprobaciones finales quedan para la validación integral única.
