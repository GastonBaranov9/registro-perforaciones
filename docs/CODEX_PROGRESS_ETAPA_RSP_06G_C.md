# ETAPA RSP-06G-C — Correcciones de revisión

## Alcance y resultado

Se corrigieron los seis hallazgos de la revisión de `feature/perfil-litologico-dinamico` contra `main`, sin migraciones, dependencias, cambios de contratos de negocio, paleta ni diseño. Se preservan autenticación por cookie HttpOnly, CSRF, `version_sesion`, autorización por recurso y SQL parametrizado.

## 1 y 6 — Ciclo de vida de fotografías

La causa era mezclar staging, transacción y purga dentro del mismo `try`: una eliminación fallida después de `COMMIT` entraba en rollback y restauraba archivos sobre datos confirmados. Las rutas de eliminación y multipart también devolvían errores engañosos después de actualizar PostgreSQL.

`foto-archivo-service.ts` centraliza ahora cuatro operaciones:

1. Validación completa antes de persistir.
2. Aislamiento reversible del archivo anterior en `.trash` antes de la confirmación lógica.
3. Restauración solamente ante un fallo anterior a la confirmación.
4. Purga post-confirmación no fatal.

En la actualización completa, el bloque transaccional termina, libera la conexión y solo entonces purga. Una purga fallida conserva la foto nueva, nunca ejecuta `ROLLBACK`, deja la anterior inaccesible en `.trash`, responde con el resultado confirmado y emite una advertencia estructurada. Eliminación y multipart reutilizan la misma política.

El log incluye únicamente `id_pozo`, operación, etapa `post_commit` y código controlado; no registra rutas, usuarios, tokens, cookies, base64 ni secretos.

## 2 — Streaming limitado del mapa

Se conserva el rechazo anticipado por `Content-Length`. Cuando el cuerpo no declara longitud, se usa `ReadableStream.getReader()` y se contabiliza cada fragmento antes de incorporarlo. Se acumula como máximo `maxBytes`; al recibir el byte adicional se cancela el reader, se aborta la solicitud y se activa el fallback compacto. Se manejan cuerpo nulo, chunks vacíos, errores, timeout y límite exacto sin volver a leer el stream.

## 3 — Recarga y estado dirty

El editor técnico expone estado `dirty` tipado. La hidratación inicial y las nuevas versiones remotas actualizan litología, tuberías, filtros, aportes, datos padre y vista previa sin marcar cambios. La edición local sí marca dirty.

Una respuesta remota no sustituye un borrador dirty. Al pulsar Recargar se solicita confirmación: cancelar conserva el borrador; confirmar incrementa una versión explícita de descarte, limpia dirty y permite hidratar todos los datos nuevos. Un guardado correcto también restablece dirty. No se usa `window.location.reload` ni se crean ciclos entre input y output.

## 4 — Intervalos litológicos

El servicio independiente ya no muta errores de dominio. Las comprobaciones funcionales ocurren fuera del manejo PostgreSQL y los códigos de integridad se traducen sin tocar errores preexistentes.

Crear y actualizar validan números finitos, rango no negativo, orden, profundidad final y solapamiento. Las consultas usan columnas explícitas, parámetros, aislamiento por `id_pozo` y el mismo advisory lock que la actualización completa. Solapamiento y exceso devuelven 400; inexistencia o falta de acceso continúa como 404 genérico mediante la autorización previa de la ruta.

## 5 — Validación estricta de imágenes

Todas las entradas backend usan el mismo validador:

- JPEG: `FF D8 FF`.
- PNG: `89 50 4E 47 0D 0A 1A 0A`.
- MIME limitado a JPEG/PNG y coherente con la firma.
- Tamaño decodificado entre 1 byte y 5.000.000 bytes.
- Base64 con alfabeto, longitud, estructura, padding y recodificación canónica exactos.
- Extensión derivada del contenido; nunca del nombre cliente.

Los datos se validan antes de staging. No se añadió un decodificador pesado; la comprobación estructural se limita deliberadamente a contrato, tamaño, codificación y firma.

## Pruebas

- Fallo antes de commit: rollback y restauración.
- Commit correcto con purga correcta y con purga `EACCES` simulada.
- Eliminación confirmada con purga fallida.
- Logging seguro y ausencia de rechazo post-confirmación.
- JPEG/PNG válidos, firmas parciales, MIME cruzado, base64/padding inválidos, vacío y más de 5 MB.
- Stream fragmentado sin longitud, menor, exacto y mayor al límite; cancelación, abort y fallback PDF de 72 pt.
- Hidratación posterior, dirty, cancelación y confirmación de recarga.
- PostgreSQL local: reemplazo y eliminación con purgas fallidas, coherencia entre `foto_url` y archivo servido, 400 HTTP por solapamiento/exceso litológico, rollback y limpieza total.

## Limpieza operacional de `.trash`

Una advertencia post-commit significa que el archivo ya es inaccesible y queda pendiente de mantenimiento. La operación recomendada es identificar entradas antiguas de `.trash` mediante los eventos estructurados y eliminarlas con una tarea administrativa acotada, fuera de solicitudes de usuario y después de verificar que no existe un archivo raíz activo con el mismo pozo. Esta etapa no incorpora cola ni ejecuta limpieza global.

## Seguridad y riesgos residuales

El mapa conserva plantilla exclusiva del servidor, HTTPS, host permitido, redirecciones bloqueadas, timeout, MIME y firma. Las fotografías permanecen fuera del servicio estático y requieren autorización. No se agregaron `any`, `SELECT *`, SQL interpolado, Bearer ni JWT en almacenamiento.

Riesgos residuales: `.trash` requiere mantenimiento operacional si persiste un fallo de permisos; la firma no sustituye una decodificación completa de imagen, aunque PDF maneja de forma segura una imagen no decodificable; y una desconexión exactamente durante `COMMIT` sigue siendo el caso distribuido ambiguo habitual entre PostgreSQL y filesystem.

## Rollback

Revertir los commits nuevos de RSP-06G-C en orden inverso. No se reescribieron commits anteriores y no hay cambios de esquema que revertir.
