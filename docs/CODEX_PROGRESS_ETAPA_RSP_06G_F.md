# RSP-06G-F — Validación de intervalos de diámetro

## Causa y corrección

El UPDATE protegido representaba con cero filas tanto un intervalo inexistente como datos rechazados por profundidad o solapamiento. Ahora se valida previamente existencia dentro del pozo, profundidad final, números finitos, rango creciente, diámetro positivo, material PVC/Acero y solapamiento excluyendo el propio ID.

Un intervalo inexistente o ajeno conserva 404 genérico. Los errores de rango, profundidad, diámetro, material y solapamiento producen `T05DatosIncorrectos` con HTTP 400. Si el UPDATE atómico devuelve cero filas, una segunda consulta distingue eliminación concurrente (404) de rechazo con registro vigente (400). No se corrigen datos silenciosamente.

## Pruebas y PostgreSQL

Las pruebas unitarias cubren 400/404, actualización válida, autoexclusión y eliminación concurrente. La prueba PostgreSQL/HTTP crea dos intervalos, actualiza uno, rechaza solapamiento y exceso de profundidad, comprueba 404, verifica que los rechazos no persistieron y genera el PDF.

## Seguridad y rollback

Se conservan autorización de ruta, aislamiento por pozo, SQL parametrizado y columnas explícitas. No hay migraciones ni cambios de contratos. Los commits pueden revertirse en orden inverso sin rollback de esquema.
