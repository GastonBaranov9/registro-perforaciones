# ETAPA RSP-06G-D — Correcciones finales de review

## Hallazgos y causa raíz

1. El reemplazo multipart aislaba la fotografía anterior antes de `writeFile`, pero la escritura quedaba fuera del bloque reversible. Un fallo dejaba PostgreSQL apuntando a un archivo temporalmente inaccesible.
2. El `UPDATE` protegido de filtros usaba la ausencia de `RETURNING` tanto para inexistencia como para datos inválidos, convirtiendo solapamientos y exceso de profundidad en HTTP 404.

## Reemplazo reversible de fotografías

`foto-archivo-service.ts` centraliza ahora staging exclusivo, aislamiento, promoción y confirmación lógica. Toda falla previa a la confirmación elimina staging o archivo promovido y restaura la fotografía aislada. Solo después del éxito se purga la anterior; una purga fallida continúa siendo post-commit no fatal, queda inaccesible en `.trash` y genera únicamente una advertencia segura.

No se usan nombres del cliente, no se cambia la validación JPEG/PNG ni el límite de 5 MB y no se exponen rutas físicas. Los temporales se crean con nombre aleatorio dentro de `.trash` y se promueven mediante `rename`.

## Actualización de filtros

Antes del UPDATE se valida que el filtro pertenezca al pozo, la profundidad final, números finitos, rango creciente, diámetro positivo, material PVC/Acero y ausencia de solapamiento excluyendo el propio ID. Las consultas usan columnas explícitas y parámetros. Inexistencia o pertenencia ajena conserva 404 genérico; errores funcionales devuelven 400. El UPDATE mantiene la defensa atómica ante carreras.

## Pruebas

Las regresiones cubren promoción fallida tras aislamiento, escritura parcial, fallo de confirmación, pozo sin foto anterior, actualización válida, rango/material/diámetro inválidos, profundidad, solapamiento, autoexclusión y carrera concurrente. La prueba PostgreSQL local ejecuta reemplazo fallido y correcto, purga post-confirmación fallida, respuestas HTTP 400/404 y generación posterior del PDF.

## Seguridad y riesgos residuales

Se conservan autenticación por cookie, CSRF, autorización del pozo, aislamiento por propietario, archivos protegidos y SQL parametrizado. No se añadieron dependencias, migraciones ni cambios visuales. Como antes, una purga post-confirmación fallida requiere limpieza operacional posterior de `.trash`; no compromete el archivo vigente.

## Rollback

Los commits de esta etapa pueden revertirse en orden inverso. No requieren rollback de base de datos. Antes de revertir en un entorno activo debe comprobarse que no haya operaciones de fotografía en curso.
