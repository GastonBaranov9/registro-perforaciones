# ETAPA RSP-06G-E — Concurrencia de fotografías y UTF-8

## Condición de carrera y serialización

Eliminación y multipart operaban sin el advisory lock usado por la actualización completa. Ahora todas las mutaciones existentes usan la misma clave PostgreSQL `(id_pozo, 606)` y el mismo orden: `BEGIN`, advisory lock, fila `FOR UPDATE`, archivos, `foto_url`, `COMMIT`, liberación y purga postconfirmación. La fila y `foto_url` se vuelven a leer bajo lock. Pozos distintos usan claves distintas y no existe lock global.

El reemplazo conserva staging exclusivo, aislamiento reversible, promoción, actualización y purga no fatal. La eliminación solo aísla si la referencia vigente bajo lock contiene foto; dos eliminaciones son idempotentes. Un fallo preconfirmación ejecuta rollback, restaura archivos y libera la conexión. Nunca se intenta rollback después de COMMIT.

La prueba PostgreSQL usa una transacción compuerta y `pg_locks`, sin depender de demoras, para ordenar: eliminar→reemplazar, reemplazar→eliminar, dos reemplazos y dos eliminaciones. En cada caso comprueba que `foto_url` coincide con el único archivo activo y que no hay huérfanos.

## UTF-8

La inspección de bytes, working tree y `git show HEAD` confirmó que los templates señalados ya contienen UTF-8 correcto; el hallazgo reprodujo una decodificación externa incorrecta, no mojibake almacenado. El verificador se amplió para mojibake simple y doble y se autocomprueba con muestras conocidas. Las pruebas DOM verifican literalmente creación, datos técnicos, litología, diámetro y tubería.

## Validación, seguridad y riesgos

Se conservan cookies HttpOnly, CSRF, sesión, autorización, aislamiento, almacenamiento protegido, validación de imágenes y SQL parametrizado. No hay migraciones ni dependencias. Las purgas postconfirmación pueden dejar archivos inaccesibles en `.trash` para limpieza operacional, sin alterar el estado lógico.

## Rollback

Los commits pueden revertirse en orden inverso sin cambios de esquema. No se debe revertir mientras existan operaciones de fotografía activas.
