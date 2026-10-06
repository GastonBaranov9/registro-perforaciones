# Preparación del corte de datos piloto

Estado: implementación local, separada en tres commits por autorización posterior; **reset real NO ejecutado**. No se aplicaron estas migraciones al piloto, no se movió su fotografía, no se desplegó ni se hizo push. Los ensayos destructivos usan bases y fotos desechables propias.

## 1. Barrera de época

`epoca_datos` contiene una única generación UUID persistida. No depende de la versión de APK ni de la sesión. `GET /pozos/epoca-datos` requiere autenticación y Administración/Perforador, con `Cache-Control: no-store`.

La APK obtiene la época al comenzar **un borrador nuevo**. La almacena en el borrador y en una caché por servidor/usuario; sin conexión sólo puede comenzar otro borrador si ya tiene esa caché. Una caché anterior al corte produce borradores de la época anterior, rechazados al sincronizar. Se necesita conexión después del corte para habilitar nuevos borradores en la etapa vigente.

Las operaciones offline envían `Idempotency-Key` y `X-Epoca-Datos`. Crear, repetir y cerrar comprueban sesión, permisos y época dentro de la transacción, antes de devolver incluso un recibo confirmado. El lock compartido de la fila de época impide que el corte avance mientras la operación está vigente. Se conserva el lock por actor/UUID y la huella del payload. El corte toma el bloqueo administrativo exclusivo y bloquea las tablas.

Época ausente, inválida o antigua: HTTP **410 / EPOCA_DATOS_RETIRADA**. Una sesión revocada sigue recibiendo 401; el cambio de época no sustituye autorización. Los recibos guardan su época. No se cambia el UUID ni se vuelve a emitir automáticamente una operación retirada.

Un borrador anterior sin campo `epoca` no se actualiza ni se vincula a la generación actual: queda bloqueado, conserva UUID/datos/foto y se puede retirar localmente mediante la confirmación existente. El repositorio rechaza modificar una época ya persistida, incluida la transición de ausencia a un UUID. Una respuesta perdida conserva payload/UUID/época para repetir. El cierre de una operación actual rechazada mantiene el protocolo previo de corrección, siempre en la misma época.

La generación se valida para solicitudes offline identificadas por su clave; el alta online normal conserva su contrato y no asigna números manuales. No se proporciona importación ni conversión automática de borradores piloto. El objetivo es impedir su reproducción por clientes anteriores/actualizados, no impedir que un administrador transcriba deliberadamente información en una operación nueva.

## 2. Migraciones

- `016_epoca_datos.sql`: singleton de generación, columna `epoca NOT NULL` en recibos offline y claves cerradas. Los recibos existentes se etiquetan con la primera época del servidor; **eso no etiqueta los borradores de dispositivos**. No modifica numeración ni elimina recibos.
- `017_carga_historica.sql`: `pozo.origen` normal/historico, origen inmutable, rango histórico 1..3281, tabla `creacion_historica`. Permite sitio/perforador/propietario desconocidos sólo en históricos, manteniendo las exigencias del alta normal mediante CHECKs.

Las migraciones **000..015 no se modifican**. El corte requiere exactamente 000..017, con checksums válidos. Las 22 tablas originales pasan a 24 por `epoca_datos` y `creacion_historica`. No se elimina esquema ni ledger.

## 3. Carga histórica

`POST /pozos/historicos`, sólo Administración. Requiere UUID v4 propio en `Idempotency-Key`, época vigente y `numero_perforacion` entero JSON entre 1 y 3281. Rechaza strings numéricos, booleanos, decimales, cero, negativos y >=3282. No acepta un origen/actor proporcionado por el cliente.

Usa una transacción para sitio opcional, pozo, reserva comercial del trigger, dependencias conocidas y recibo. Registra `creado_por` y `origen='historico'`. La unicidad de reservas protege también números de pozos borrados y creaciones concurrentes. Misma clave/payload devuelve el recibo; misma clave con otro payload se rechaza. Número y origen son inmutables en PostgreSQL.

Sólo se habilita con contador configurado >=3282. Reutiliza el trigger transaccional actual de numeración: históricos menores al próximo no lo avanzan. No reutiliza los defaults técnicos de alta normal. Las fechas de ejecución, profundidad, caudal, personas, coordenadas y demás hechos desconocidos quedan NULL. `fecha_creado` significa fecha de incorporación al sistema, no fecha histórica de perforación. Las lecturas no convierten un caudal/profundidad desconocido a cero.

Cambio mínimo del modelo: `id_sitio` e `id_perforador` admiten NULL para históricos; el propietario ya podía ser provisional y ahora puede ser totalmente desconocido para este origen. No se crean personas ni sitios ficticios para completar FKs. Si se proporciona un sitio se exige departamento; coordenadas se dan ambas o ninguna. Los intervalos se omiten si no están documentados; si se incluyen deben cumplir sus validaciones actuales (por ejemplo, ranura de un filtro nuevo). No se infiere una profundidad final a partir de intervalos.

Pantalla `/pozos-historicos` separada de Crear pozo, protegida por guard de Administración. El formulario comienza vacío; conserva el intento en sessionStorage por servidor/actor para repetir después de pérdida de respuesta o recarga. No recicla su época. Tras rechazo definitivo permite descartar explícitamente el intento y comenzar un formulario vacío. La primera pantalla ofrece identificación y hechos generales; los intervalos están soportados en API. La edición histórica especializada, adjuntar foto en esa pantalla y carga masiva no forman parte de esta base inicial. La edición normal se oculta para históricos para evitar completar defaults accidentalmente. KML no se modifica.

## 4. Inventario autorizado y clasificación

| Tabla/dato | Acción del corte |
|---|---|
| `pozo` | Eliminar únicamente ID 5 / P-2580; exigir que sea el único pozo, propietario 8, perforador 6, creador 1, sitio 5 y URL inventariada |
| `sitio` | Eliminar únicamente ID 5, Salto/Salto, padrón NULL; abortar ante otro sitio |
| `intervalo_litologico` | Eliminar ID 44, perteneciente a pozo 5 |
| `intervalo_diametro_perforacion` | Eliminar ID 36, perteneciente a pozo 5 |
| `intervalo_filtro` | Eliminar ID 9, perteneciente a pozo 5 |
| `nivel_aporte` | Eliminar IDs 22 y 23, ambos de pozo 5 |
| Cementación, desarrollo, revestimiento y demás campos de pozo 5 | Se eliminan con esa fila |
| `documento`, `informe` | Exigir vacías; abortar si aparece una fila, en vez de ampliar el borrado |
| `numero_perforacion_reservado` | Eliminar 2580 → pozo original 5 y 3001 → pozo original 4; exigir exactamente esas dos reservas |
| `numeracion_perforacion` | Exigir NULL/3001 antes; establecer próximo 3282 y mayor 0 |
| `numeracion_perforacion_configuracion` | Exigir vacía antes; insertar anterior NULL, próximo 3282, cambiado_por 1 y fecha del corte |
| `creacion_offline` | Exigir vacía antes y después |
| `clave_offline_cerrada` | Exigir los nueve UUID exactos de `CLAVES_PILOTO`, todos de usuario 6/época anterior; eliminarlos junto al cambio de época |
| `creacion_historica` | Exigir vacía antes y después |
| `epoca_datos` | Sustituir UUID y fecha en la misma transacción del reset |
| `usuario` | Conservar exactamente 1,2,3,6; eliminar sólo 8; incrementar version_sesion de los conservados |
| `usuario_rol` | Conservar (1,1),(2,3),(3,2),(6,2); eliminar (8,3); abortar ante otra relación |
| `rol` | Conservar 1 administración, 2 perforador y 3 propietario |
| `permiso`, `rol_permiso` | Exigir vacías y conservarlas |
| `sesion_nativa`, `ticket_ws_nativo` | Eliminar todas las sesiones/tickets previos del corte; cantidad variable, sin imprimir tokens |
| `catalogo_litologia` | Exigir los 30 IDs 1..30; conservar íntegramente todas sus filas y valores |
| `schema_migrations` | Conservar íntegramente; validar 000..017 y checksums |
| Secuencias/identities PostgreSQL | No reiniciar, no llamar setval; sólo avance normal del ID de la nueva fila del historial de configuración |
| `fotos/pozo-5.jpg` | 1.285.735 bytes; exigir SHA256 coincidente con backup; renombrar a cuarentena del mismo volumen, sin purgar |
| Archivos adicionales, `.trash` no vacía, otra tabla/usuario/reserva/dependencia | Abortar y revisar; no ampliar automáticamente el inventario |

La reserva 3001 es un registro comercial, no la secuencia de IDs internos. Se elimina aunque su pozo original 4 ya no exista. No se inventa un pozo para respaldarla.

## 5. Usuarios y sesiones

| ID | Identidad | Resultado esperado |
|---|---|---|
| 1 | Gaston Baranov, Administración | Conserva identidad, acceso, credenciales y rol; version_sesion +1 |
| 2 | Ramiro, Propietario | Conserva persona/rol y su estado sin cuenta de acceso; version_sesion +1; no se habilita login |
| 3 | Gaston Souza, Perforador | Conserva identidad, acceso, credenciales y rol; version_sesion +1 |
| 6 | Luis Diaz, Perforador | Conserva identidad, acceso, credenciales y rol; version_sesion +1 |
| 8 | Ricardo, Propietario | Elimina su relación de rol y su identidad después de borrar dependencias piloto |

Se exige administrador 1 activo, con acceso y credenciales presentes; no se imprimen sus credenciales. No se permite otro administrador inesperado. Se comparan todos los datos de los conservados antes/después, salvo el incremento de versión. Se eliminan sesiones nativas/tickets y se exige nuevo login. La invalidación de sesiones no basta para offline: un nuevo login tampoco permite enviar borradores de una época retirada.

## 6. Script y postcondiciones

Entrada operativa: `api/src/scripts/reset-piloto.ts`; transacción e inventario: `api/src/services/reset-piloto-service.ts`. Servicio Compose `reset-piloto`, profile `ops`, sin arranque automático ni dependencias que reenciendan API. Usa root sólo en ese contenedor operativo para leer backup 0700 y crear la cuarentena hermana de `fotos`; no cambia permisos de los archivos ni del servicio API.

Sin los dos flags y la confirmación exacta, la CLI termina con error antes de conectar o tocar archivos. Exige base `registro_perforaciones_pilot`, usuario `rsp_pilot`, ruta de fotos fija, bundle completo, hashes/tamaños válidos, ledger del backup coincidente y foto idéntica dentro del tar y en volumen. Lee el miembro del tar por stdout, sin extraer sobre el volumen.

Dentro de BEGIN exige ausencia de otros clientes de esa base, lock administrativo y ACCESS EXCLUSIVE de las 24 tablas. Valida todo el inventario antes del primer DELETE. El script no detiene servicios por sí mismo: **el operador debe establecer mantenimiento y detener todas las instancias escritoras**; los flags no sustituyen ese procedimiento. Lock timeout/statement timeout hacen fallar el corte si no consigue exclusividad.

Orden: validar → journal PREPARED → foto a cuarentena → intervalos/aportes → pozo → sitio → reservas → nueve claves cerradas → tickets/sesiones → rol/usuario 8 → versiones de los conservados → época nueva → numeración/historial → postcondiciones → COMMIT → journal COMMITTED.

Antes de COMMIT se exige:

1. Cero pozos, sitios, reservas, intervalos litológicos/diámetros/filtros, niveles, documentos e informes.
2. Cero recibos offline, claves cerradas y recibos históricos.
3. Cero sesiones nativas y tickets anteriores.
4. Exactamente usuarios 1,2,3,6 y sus filas intactas excepto version_sesion +1; 8 ausente.
5. Roles y relaciones conservadas exactos; administrador 1 sigue habilitado.
6. Catálogo y ledger idénticos a los snapshots previos.
7. Próximo 3282, mayor_asignado 0 y UUID de época nuevo.
8. Una fila de configuración: anterior NULL, próximo 3282 y actor 1.
9. Estado de secuencias de negocio sin cambios; ninguna secuencia se reinicia. El BIGSERIAL del historial avanza por el INSERT, y una transacción abortada puede dejar un hueco normal en ese ID.
10. No hay otros clientes conectados al comprobar el final.

La foto se renombra antes de los borrados: `<volumen>/reset-quarantine-<uuid>/pozo-5.jpg`. No queda expuesta en `fotos`. Una falla con ROLLBACK confirmado antes del intento de COMMIT restaura la foto sin sobreescribir una ruta ocupada. Una respuesta de COMMIT perdida, muerte de proceso o fallo al escribir COMMITTED requiere diagnóstico manual del journal y de PostgreSQL. No se restaura la foto automáticamente ante un COMMIT ambiguo.

No hay TRUNCATE CASCADE, reinicio de secuencias, desactivación de triggers/FKs, DROP de tablas ni purga de cuarentena en el procedimiento.

## 7. Estado lógico de numeración

Inmediatamente después del reset: `proximo=3282`, `mayor_asignado=0`, reservas vacías. Mayor 0 expresa que este conjunto limpio todavía no ha asignado números. No se reserva 3281 ni se introduce una fila ficticia para justificarlo.

Al cargar P-3281, el trigger actual eleva mayor_asignado a 3281 y reserva 3281, sin mover próximo 3282. P-3280/P-3279 agregan reservas y dejan mayor 3281/próximo 3282. El siguiente pozo normal recibe 3282 y luego 3283. El mayor sigue siendo el máximo de números asignados/reservados por el sistema, incluyendo históricos; no se fuerza a reflejar sólo altas automáticas ni filas todavía existentes.

## 8. Procedimiento futuro de mantenimiento y backup

**Comandos PROPUESTOS, NO EJECUTADOS sobre el piloto.** Requieren una autorización operativa posterior. No usar los scripts antiguos de limpieza Bellagamba como reset final.

1. Revisar y empaquetar código/API/web/APK compatibles. Verificar versión nativa mínima en el procedimiento habitual y registrar el digest de la API nueva; no ejecutar la API anterior contra el esquema nuevo.
2. Registrar inventario de corte y usuarios; disponer de acceso administrativo comprobado. Cerrar tráfico y detener todas las APIs/escritores. Mantener PostgreSQL encendida.
3. Backup completo previo a migración, con el mecanismo existente `ops/backup.sh`: dump custom + fotos + manifest/checksums. Guardar las referencias de imágenes y configuración necesarias para recuperar esa versión, sin publicar secretos.
4. Aplicar 016/017 con el migrador oficial, todavía en mantenimiento. Crear **un segundo backup**, con ledger 000..017. Éste es el bundle que exige el reset.
5. Comprobar restauración de ese bundle en proyecto/red/volúmenes nuevos aislados y comparar inventario. Nunca usar el proyecto rsp-pilot para el ensayo. No basta con que exista un archivo de dump.
6. Obtener/verificar SHA256 de la foto del backup y del volumen. La CLI vuelve a contrastarlos. Elegir el bundle explícitamente, no “el último” por inferencia.
7. Ejecutar una sola vez el reset con confirmaciones explícitas; conservar salida y journal. Si aborta, no ajustar las aserciones para que pase sin revisar el nuevo inventario.
8. Verificar SELECTs y reconciliación read-only antes de levantar la API nueva. Entrar con administrador 1 y comprobar la época vigente. Retomar tráfico con web/APK compatibles.

Esquema de comandos PowerShell para el futuro corte (revisar placeholders; no ejecutar ahora):

```powershell
$composeCorte = @('-p','rsp-pilot','--env-file','.env.pilot.local','-f','docker-compose.production.yaml')
# API_IMAGE_REF debe señalar la imagen revisada que incluye 016/017 y reset-piloto.
docker compose @composeCorte stop proxy
docker compose @composeCorte --profile ops up -d --wait maintenance
docker compose @composeCorte stop api
docker compose @composeCorte --profile ops run --rm --no-deps backup
# Registrar bundle previo; aplicar sólo tras verificar ese backup.
docker compose @composeCorte --profile ops run --rm --no-deps migrate
docker compose @composeCorte --profile ops run --rm --no-deps backup
# Registrar bundle 000..017 y ensayar restauración en entorno separado.
$env:RESET_CONFIRM = 'RESET_RSP_PILOT_2580_3001'
$env:RESET_BACKUP_DIR = '/backups/<bundle-000..017-verificado>'
$env:RESET_PHOTO_SHA256 = '<sha256-de-64-caracteres-verificado>'
docker compose @composeCorte --profile ops run --rm --no-deps reset-piloto node ./dist/scripts/reset-piloto.js --execute --maintenance
# Sólo tras resultado confirmado y verificaciones:
docker compose @composeCorte --profile ops run --rm --no-deps reconcile-fotos
```

El reinicio de API/front/proxy se hace con el procedimiento de publicación aprobado y versiones compatibles. No ejecutar pruebas que creen pozos en el piloto para “ver si funciona”: el primer alta real debe conservar 3282.

Consultas propuestas de verificación, sin nextval:

```sql
BEGIN READ ONLY;
SELECT current_database(), current_user;
SELECT proximo, mayor_asignado FROM numeracion_perforacion;
SELECT count(*) FROM numero_perforacion_reservado;
SELECT anterior, proximo, cambiado_por, cambiado_en FROM numeracion_perforacion_configuracion;
SELECT epoca, cambiada_en FROM epoca_datos;
SELECT id_usuario, nombre, activo, cuenta_acceso, version_sesion FROM usuario ORDER BY id_usuario;
SELECT id_usuario, id_rol FROM usuario_rol ORDER BY id_usuario, id_rol;
SELECT count(*) FROM pozo;
SELECT count(*) FROM sitio;
SELECT count(*) FROM creacion_offline;
SELECT count(*) FROM clave_offline_cerrada;
SELECT count(*) FROM sesion_nativa;
SELECT count(*) FROM ticket_ws_nativo;
SELECT sequencename, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename;
COMMIT;
```

## 9. Rollback y cuarentena

- Falla antes de COMMIT: la transacción revierte; el servicio intenta devolver la foto sólo después de confirmar ROLLBACK. La cuarentena puede conservar PREPARED como evidencia. Un fallo de compensación mantiene mantenimiento y requiere intervención.
- COMMIT ambiguo: mantener servicios detenidos. Comparar época real, inventario/postcondiciones y PREPARED/COMMITTED. Ni una excepción del cliente ni ausencia de COMMITTED prueban que la BD haya revertido.
- Reset confirmado pero rollback solicitado: recuperar el bundle completo compatible (BD **y fotos**) usando `ops/restore.sh` y su confirmación explícita, primero ensayado fuera del piloto. Conservar la cuarentena y el estado posterior antes de restaurar. No mezclar una BD restaurada con fotos de otra etapa.
- Restaurar un backup también restaura época y versiones de sesión anteriores. **No reabrir tráfico así**: podría rehabilitar borradores/sesiones viejos. Se requiere un nuevo corte de época y revocación verificados, o mantener la restauración sólo como entorno de consulta. Esa recuperación requiere su propio procedimiento autorizado, no repetir ciegamente este reset de inventario exacto.
- Si ya hubo carga real después del corte, una restauración completa perdería esa carga. Detener y reconciliar antes de decidir; no hay rollback automático destructivo.
- La foto se conserva en cuarentena y en backup. Su eliminación definitiva requiere verificación y decisión posterior de retención; este script no la elimina.

## 10. MANUAL_CHECK antes de autorizar publicación/corte

- [ ] Ensayar backup + restore + reset con las imágenes definitivas en volúmenes aislados; verificar permisos de root operativo, tar, manifest y journal. Las pruebas automatizadas ejercitan el servicio transaccional, no el montaje real del piloto.
- [ ] Actualizar una APK instalada con borradores/fotos anteriores: siguen legibles y no adquieren época. Reinstalar/limpiar datos no es una prueba válida de actualización.
- [ ] Cambiar época en laboratorio con solicitudes en vuelo; reabrir app, renovar login, reintentar crear/cerrar y verificar 410 para borradores anteriores, sin recreaciones.
- [ ] Crear borrador actual, reiniciar app, simular caída de red tras recepción y repetir: un pozo, una foto y un número.
- [ ] Probar dos dispositivos de Luis Diaz y cambio de cuenta; no mezclar cachés ni borradores.
- [ ] Probar pantalla histórica en móvil/web: campos vacíos, fechas, coordenadas parciales, rechazo de número ocupado, reintento y navegación al detalle sin sitio/perforador conocidos.
- [ ] Verificar presentación del PDF/mapa/perfil para históricos sin datos: no completar hechos. KML permanece fuera de alcance.
- [ ] Confirmar que todos los escritores están detenidos y el backup es del corte actual; `pg_stat_activity` es una defensa adicional, no un reemplazo de mantenimiento operativo.
- [ ] Confirmar P-2580/foto/tamaño/hash/inventario y acceso real del administrador 1 inmediatamente antes del futuro corte. Cualquier diferencia exige revisar el plan.
- [ ] Revisar journals y restauración manual ante COMMIT ambiguo; almacenamiento de backup y cuarentena con retención suficiente.

## 11. Riesgos y límites explícitos

BD y filesystem no comparten una transacción distribuida. Se usa mantenimiento, rename dentro del volumen, compensación y journal; fallos de proceso/disco requieren diagnóstico, no promesa de atomicidad total. Los checksums del backup prueban integridad de sus archivos, no por sí solos su frescura ni restaurabilidad.

La nueva API exige época a las operaciones offline antiguas desde su publicación, incluso antes del reset. Debe coordinarse la actualización de clientes; no se debe introducir un fallback que asigne época actual a solicitudes antiguas. Las 9 claves sólo se eliminan durante el cambio de época, nunca en una limpieza independiente.

El alta histórica inicial permite desconocidos; exige continuar con valores explícitos para cualquier técnico cargado. No contiene todavía edición histórica especializada ni adjuntos en su formulario. No se cambian los endpoints heredados de informes ni KML en este trabajo.

El inventario es cerrado por IDs, relaciones y estados autorizados; no es un mecanismo genérico de borrado. Catálogo/credenciales de usuarios conservados se comparan con snapshots para impedir modificaciones durante el corte. Nuevas filas, roles, archivos, recibos o tablas provocan aborto.

## 12. Verificación ejecutada — 2026-10-06

| Comando / alcance | Resultado final |
|---|---|
| `api: npm.cmd run build` | Correcto, TypeScript sin errores |
| `api: npm.cmd test` | 343/343, 0 fallos, 0 omitidos |
| `api: node --experimental-strip-types --test test/numeracion-perforacion-postgres.local.ts` | 1/1 archivo; escenarios `fresh` y `pilot_equivalent` aprobados en clúster temporal PostgreSQL 18.4 |
| `api: RSP14_TEST_PORT=<puerto aislado>; node --experimental-strip-types --test test/offline-identidad.postgres.local.ts` | 24/24, 0 fallos, 0 omitidos; PostgreSQL 16.14 aislada |
| Ensayo combinado inicial de época/históricos/reset, antes de separar commits | 14/14, 0 fallos; posteriormente distribuido en los tres archivos indicados abajo, sin perder casos |
| `front: npm.cmd test -- --watch=false --browsers=ChromeHeadless --reporters=dots --progress=false` | 480/480 en Chrome Headless, 0 fallos |
| `front: npm.cmd run build -- --configuration development` | Correcto |
| `front: npm.cmd run check:utf8` | Correcto |
| `api: node dist/scripts/reset-piloto.js` **sin flags** | Rechazo esperado, exit 1: no conecta ni toca archivos |
| `git diff --check` | Exit 0, sin errores de whitespace; avisos de conversión LF → CRLF de Git en Windows |
| `git diff -- api/db/migrations/000...015` (todos los archivos enumerados) | Vacío: migraciones existentes sin cambios |

El contenedor `rsp-reset-epoch-lab` usó datos PostgreSQL en tmpfs, puerto efímero de localhost y cero montajes de volúmenes. Se verificó etiqueta `rsp.purpose=isolated-reset-tests`; se cerró al terminar. Los tests crearon/eliminaron exclusivamente sus bases y fotos temporales. No se restauró un backup del piloto ni se probó la CLI destructiva contra él.

Fallos encontrados, diagnosticados y corregidos (no ignorados):

1. `initdb` falló dentro del sandbox por creación de token restringido/acceso al temporal. Fue un problema de entorno. Se repitió el mismo clúster aislado fuera del sandbox; no se cambió destino al piloto.
2. Las pruebas anteriores creaban números manuales con `crearPozoCompleto` y esperaban que un histórico alto avanzara el contador. Eran expectativas del diseño previo: ahora prueban `crearHistorico`, su época, rango separado y contador 3282.
3. Una expectativa de ruta se había cambiado incorrectamente de 403 a 400. El perforador que intenta crear en ese fixture con propietario real sigue sin permiso: se restauró la expectativa 403, sin debilitar autorización.
4. Apareció una **regresión real**: listado HTTP 500, `id_sitio does not match schema definition`, porque BIGINT llega como string y los IDs ahora admiten NULL. También fallaba el listado del propietario en `offline-identidad`. Se normalizaron los IDs de salida manteniendo NULL; ambos ensayos completos pasaron. Se agregaron comprobaciones de listado/detalle histórico sin convertir profundidad/caudal desconocidos a cero.
5. El test de PDF del frontend carecía del actor autenticado y esperaba la URL del propietario. Se fijó el actor del fixture, manteniendo URLs compatibles con históricos sin propietario/perforador.

El ensayo nuevo verifica: reintentos concurrentes offline con una foto/un número; claves cerradas; ausencia/antigüedad de época; rechazo incluso de recibos confirmados anteriores; lock de generación; histórico idempotente con NULL; duplicados/reservas concurrentes; rollback de dependencias técnicas; permisos de administrador frente a perforador/propietario y sesión revocada; abortos ante clientes, usuarios, administradores, tablas, pozos, sitios, reservas, dependencias y claves inesperados; rollback de foto/datos; retención de cuarentena ante COMMIT incierto; usuarios 1,2,3,6 conservados, 8 eliminado; sesiones/tickets sintéticos eliminados; rechazo de los nueve UUID piloto con época antigua y sin época; históricos 3281/3280/3279 sin avanzar el próximo y normales 3282/3283.

El frontend verifica persistencia de foto/UUID/época, borradores sin época no convertidos ni enviados, rechazo 410 definitivo, caché nueva sin reasignar borradores guardados, reintento histórico tras recarga y descarte explícito de un intento definitivamente rechazado.

Karma muestra avisos de Ionic/Zone e iconos durante fixtures; no quedan tests fallidos. El build muestra el aviso `empty-glob` de Stencil. No se generó/publicó una APK ni se realizó MANUAL_CHECK en dispositivo real: permanecen en la lista operativa anterior.

## 13. Archivos y propuesta de commits

Los archivos nuevos contienen las migraciones 016/017, contrato/ruta/servicio histórico, servicio de época, CLI/servicio de reset, sus pruebas y este informe. Los cambios existentes integran la época en offline/HTTP/CORS, separan el alta normal, adaptan los datos desconocidos en lecturas y preparan navegación/pantalla administrativa. El snapshot Git previo a la separación se conserva debajo como registro de la implementación; el directorio histórico contiene `historicos.page.ts` y `historicos.page.spec.ts`.

Separación autorizada posteriormente por el usuario, sin autorización de push, despliegue ni corte real:

1. `feat(offline): aislar borradores por epoca de datos`
2. `feat(pozos): agregar carga historica administrativa segura`
3. `ops(pilot): preparar reset controlado de datos de negocio`

Los hunks de `errors.ts`, CORS, `epoca-datos-service.ts` y `pozo-completo-service.ts` se separaron entre los primeros dos commits. La corrección del fixture de numeración que reconoce `propietario_provisional_original` queda en el primero para que su prueba aislada también pase; sus cambios históricos quedan en el segundo. No se cambiaron las migraciones 000..015 ni el comportamiento final de producción al preparar los commits.

Las pruebas mixtas se dividieron conservando los 13 subtests PostgreSQL y los dos tests unitarios originales:

- Commit 1: `api/test/epoca-datos.test.ts` y `api/test/epoca-datos.postgres.local.ts`.
- Commit 2: `api/test/historicos.test.ts` y `api/test/historicos.postgres.local.ts`.
- Commit 3: `api/test/reset-piloto.postgres.local.ts`; incluye la comprobación integrada de altas posteriores al corte.

Reproducción sobre laboratorio exclusivamente: definir `RSP_RESET_TEST_PORT` con su puerto efímero y ejecutar `node --experimental-strip-types --test test/epoca-datos.postgres.local.ts test/historicos.postgres.local.ts test/reset-piloto.postgres.local.ts` desde `api`. Los archivos crean bases propias; no cargar `.env.pilot.local` para estas pruebas. La suma esperada es 16 tests contando los tres contenedores de pruebas, frente a 14 con un único contenedor anterior; los 13 subtests se mantienen.

Cada contenido staged se exportó a una copia temporal fuera del repositorio para compilar/probar esa etapa exacta sin introducir dependencias del commit siguiente. Backups del trabajo, snapshots de prueba, builds y laboratorio permanecen fuera del contenido versionado.

Snapshot histórico de `git status --short` al cerrar la implementación, **antes** de separar y crear los commits (no representa el estado posterior a los tres commits):

```text
 M api/src/models/errors.ts
 M api/src/models/schemas.ts
 M api/src/plugins/cors.ts
 M api/src/routes/pozos.ts
 M api/src/services/generar-informe-consultas.ts
 M api/src/services/numeracion-perforacion-service.ts
 M api/src/services/offline-cierre-service.ts
 M api/src/services/pozo-completo-service.ts
 M api/src/services/pozos-services.ts
 M api/test/numeracion-perforacion-postgres.local.ts
 M api/test/offline-identidad.postgres.local.ts
 M docker-compose.production.yaml
 M front/src/app/app.routes.ts
 M front/src/app/core/native/offline-repository.ts
 M front/src/app/core/native/offline.service.ts
 M front/src/app/core/native/offline.spec.ts
 M front/src/app/routes/offline/offline.page.spec.ts
 M front/src/app/routes/offline/offline.page.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts
 M front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.spec.ts
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts
 M front/src/app/routes/pozos/pozo/pozo.page.html
 M front/src/app/shared/services/pozos-edit.service.ts
 M front/src/app/shared/types/schemas.ts
?? api/db/migrations/016_epoca_datos.sql
?? api/db/migrations/017_carga_historica.sql
?? api/src/models/historicos.ts
?? api/src/routes/historicos.ts
?? api/src/scripts/reset-piloto.ts
?? api/src/services/epoca-datos-service.ts
?? api/src/services/historicos-service.ts
?? api/src/services/reset-piloto-service.ts
?? api/test/epoca-historicos-reset.postgres.local.ts
?? api/test/epoca-historicos.test.ts
?? docs/RESET_CONTROLADO_PILOTO.md
?? front/src/app/routes/pozos/pages/historicos/
```
