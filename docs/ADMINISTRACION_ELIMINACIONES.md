# Eliminación administrativa y reservas individuales (migración 023)

La migración sólo agrega auditoría. No elimina perforaciones, no libera reservas y
no cambia el contador. No requiere modificar las migraciones 000–022.

## Tres operaciones

- **Eliminar conservando número:** opción normal. Requiere motivo y escribir
  `ELIMINAR`. Retira el registro y sus datos asociados del uso normal, conserva la
  reserva y archiva los datos originales para auditoría.
- **Eliminar prueba y liberar número:** exclusivamente administración activa. Exige
  confirmar por escrito `PRUEBA SIN REFERENCIAS`, motivo y `ELIMINAR`. Esa declaración
  confirma condición de prueba y ausencia de PDFs entregados, documentación vigente,
  referencias externas o sincronizaciones pendientes. El servidor comprueba de nuevo
  las referencias internas. No está habilitada para registros con resultados de
  creación histórica/offline, documentos o informes. La declaración nunca permite
  ignorar esos bloqueos.
- **Administrar números de perforaciones eliminadas:** consulta individual y
  rectificación excepcional con motivo, declaración y `LIBERAR`. Una perforación
  existente no puede rectificarse por esta vía. El número cero se rechaza. No hay
  liberación por rangos; el POST de rectificación anterior responde 409 y solicita
  utilizar la nueva pantalla.

Una consulta sin conflictos sólo acredita las comprobaciones internas. El sistema
no puede comprobar PDFs descargados, papeles, otras aplicaciones ni dispositivos
desconectados. Si hay dudas, conservar la reserva y recuperar el original mediante
un procedimiento administrativo separado.

Las reservas eliminadas antes de contar con esta auditoría tampoco se presentan
como recuperables automáticamente: podrían haber perdido referencias por cascada.
Su revisión requiere evidencia del respaldo y una decisión administrativa separada;
la pantalla informa el bloqueo sin ofrecer un botón para forzarlo.

## Confirmación del servidor y transacción

GET `/pozos/:id/confirmacion-eliminacion` (opcional `?prueba=true`) entrega un desafío
firmado de cinco minutos: usuario, registro, operación, huella del estado y nonce.
No escribe en la base. Abrir, cancelar, cerrar o navegar no elimina ni consume nada.
La clave de firma vive sólo en memoria: reiniciar la API invalida las confirmaciones
pendientes. No se incorpora un secreto nuevo a archivos ni se reutilizan credenciales.
Si en el futuro se utilizan varias instancias API, esta clave debe coordinarse de
forma segura; actualmente una confirmación emitida por otra instancia falla cerrada.

DELETE `/usuarios/:usuario/pozos/:id` exige desafío, confirmación escrita y motivo.
El frontend antiguo que sólo envía DELETE recibe 400. Las cuentas no administrativas
son rechazadas también por API. Un desafío no autoriza otro usuario, operación o ID,
ni evita revalidar los permisos y el estado actual. No se registra el token.

GET `/pozos/numeracion/eliminadas/:numero` informa existencia, reserva, identidad,
fecha, contador y bloqueos. POST `.../:numero/liberar` consume su desafío propio.
Las rutas de consulta llevan `Cache-Control: no-store`.

La ejecución utiliza la protección de sesión, exclusión de escrituras de la API,
bloqueo del contador y bloqueo del pozo/fotografías en ese orden. Se revalida el
estado después de adquirir los bloqueos. La auditoría y el nonce único, eliminación,
liberación y posible contador se confirman en una única transacción. Cualquier error
antes de COMMIT revierte todo; ante pérdida de conexión no se presupone el resultado
ni se reintenta automáticamente. Se debe consultar de nuevo.

`administracion_eliminacion` conserva actor, fecha, motivo, declaraciones, pozo,
datos asociados, reserva, referencias, inventario de fotografías y contador anterior
y posterior. Rechaza UPDATE, DELETE y TRUNCATE. La documentación archivada sigue
bloqueando una posterior liberación, aunque la eliminación normal haya retirado sus
filas activas. No se eliminan resultados de idempotencia ni auditorías anteriores.

## Fotografías y recuperación

La eliminación es lógica respecto de las fotografías: los archivos originales
permanecen privados, con el ID original que nunca se reutiliza y su SHA-256 en la
auditoría. La ruta protegida de descarga comprueba que exista la perforación y
responde 404 tras eliminarla. No hay publicación estática de esas fotografías.
La interfaz explica que se conserva evidencia privada; **no promete purga física**.
No se agrega un proceso automático de limpieza.

La retención no tiene vencimiento automático. La aplicación no ofrece descarga ni
restauración de fotografías archivadas; su acceso queda limitado al personal con
acceso operativo autorizado al almacenamiento o a los respaldos privados. Una futura
política de purga requiere una decisión explícita y un procedimiento separado.

Esto evita una transacción distribuida imposible de garantizar entre PostgreSQL
y el sistema de archivos: no se mueve ni borra ningún archivo durante la operación.
Una fotografía esperada faltante o ilegible bloquea la eliminación. No debe borrarse
manualmente un archivo archivado: forma parte de la evidencia conservada.

El backup integral formato 2 incluye la nueva tabla, secuencias y toda la persistencia
(también fotografías archivadas y cuarentenas). Los restauradores existentes funcionan
sin cambios: crean/restauran el esquema y no vacían la auditoría mediante DELETE.
No arrancar una versión anterior de API tras publicar esta protección: volvería a
aceptar DELETE sin desafío. Toda recuperación productiva requiere revisión y autorización.

## Numeración e intento histórico pendiente

Los números 1–3281 son históricos conforme al esquema existente. Liberar una reserva
histórica no actualiza `proximo`, `mayor_asignado` ni el historial de configuración.
Un ejemplo ficticio 3277 con próximo 3282 mantiene exactamente ese contador.
Para automáticos sólo se permite el último número asignado, con próximo = número+1
y mayor = número. Se recalcula el mayor restante dentro del mismo bloqueo; nunca se
liberan rangos ni se renumeran perforaciones existentes. La nueva asignación usa un
ID nuevo y conserva la unicidad de las reservas vigentes.

Un intento histórico rechazado conserva payload y clave en sessionStorage y la foto
en IndexedDB. «Comprobar número para reintentar esta carga» sólo hace lecturas: exige
misma cuenta, misma época, número disponible y foto recuperable. No envía la carga.
El administrador puede después reintentar exactamente la misma clave, época y payload.
El servidor conserva la idempotencia y rechaza devolver como creada una perforación
que ya fue eliminada. No se descarta ni se modifica automáticamente el intento.

Si el original existe en un respaldo y conserva una referencia histórica, no liberar
la reserva ni borrar esa referencia. La alternativa conservadora es preparar una
recuperación selectiva del registro original y sus dependencias, verificando primero
integridad del respaldo, relaciones actuales y documentación externa. Una restauración
integral sobrescribiría actividad posterior y no es equivalente. La carga conservada
puede servir para cotejar cambios posteriores; no debe enviarse como un duplicado.

La preparación de esa recuperación debe verificar en una copia aislada el pozo,
litología, diámetros, filtros, aportes y sello sanitario, además de documentos e
informes si existen. Cotejar las identidades actuales de propietario, perforador y
sitio; no sobrescribirlas ni recrearlas automáticamente. Conservar la reserva y el
resultado de creación histórica vinculados a la identidad original, sin alterar el
contador automático ni otros registros. Los triggers de numeración impiden usar una
carga nueva como sustituto de esa recuperación: hace falta un procedimiento selectivo
revisado, transaccional y autorizado. Un respaldo no acredita cambios posteriores ni
fotografías ausentes; conservar el intento del navegador hasta cotejarlo con el original.

## Pruebas focalizadas

Desde `api`: `node --experimental-strip-types test/administracion-eliminaciones.postgres.local.ts`.
Crea PostgreSQL en Temp con datos ficticios y puerto loopback, aplica 022→023, ensaya
permisos, desafíos, concurrencia, referencias, rollback, auditoría, fotos, reintento
histórico y dump/restore en otra base del clúster. No lee `.env` ni usa producción.

Frontend: `pozos-list.page.spec.ts`, `reservas-eliminadas.component.spec.ts` y
`historicos-reintento.spec.ts`. Verifican que no se envíen escrituras al cancelar,
las declaraciones, errores, doble clic y preservación del intento rechazado.

El ensayo adicional con PostgreSQL 16 Docker usa proyecto nuevo, red `none`, sin
puertos y volúmenes propios. Ejecuta los `ops/backup.sh` y `ops/restore.sh` existentes,
compara inventario, permisos, checksums, estado de base y secuencias, tanto restaurando
un destino vacío como reemplazando exclusivamente el destino descartable.

## Archivos del cambio

API:
- `api/db/migrations/023_administracion_eliminaciones.sql`
- `api/src/services/administracion-eliminaciones-service.ts`
- `api/src/services/historicos-service.ts`
- `api/src/routes/administracion-eliminaciones.ts`
- `api/src/routes/numeracion-perforacion.ts`
- `api/src/routes/pozos.ts`
- `api/test/administracion-eliminaciones.postgres.local.ts`

Frontend (bajo `front/src/app/`):
- `shared/services/administracion-eliminaciones.service.ts`
- `shared/services/pozos-list.service.ts`
- `routes/pozos/pages/pozos-list/pozos-list.page.ts`
- `routes/pozos/pages/pozos-list/pozos-list.page.html`
- `routes/pozos/pages/pozos-list/pozos-list.page.spec.ts`
- `routes/pozos/pages/numeracion/numeracion.page.ts`
- `routes/pozos/pages/numeracion/reservas-eliminadas.component.ts`
- `routes/pozos/pages/numeracion/reservas-eliminadas.component.spec.ts`
- `routes/pozos/pages/historicos/historicos.page.ts`
- `routes/pozos/pages/historicos/historicos.page.html`
- `routes/pozos/pages/historicos/historicos-reintento.spec.ts`

Documentación:
- `docs/ADMINISTRACION_ELIMINACIONES.md`
- `docs/RECTIFICACION_NUMERACION.md`
