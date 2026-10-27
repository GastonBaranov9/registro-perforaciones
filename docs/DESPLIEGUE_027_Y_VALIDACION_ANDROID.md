# Preparación operativa 027 y Android

Estado al 26/10/2026: preparación local, sin despliegue, mantenimiento productivo,
commit ni push. Base funcional: `8534f2fbf5dfc4554406413221cc9e4cbb78dca6`.
La versión productiva 026 informada por el propietario es
`4776a923b54b62590a591bb23393164ac2afb548`; no se ejecutó un preflight sobre
`rsp-pilot` en esta etapa. No se modificaron migraciones ni código funcional,
incluidos los espesores gráficos aprobados de sello y prefiltro (`0.13`).

## Barrera antes de reabrir

El procedimiento productivo Windows sigue siendo `ops/deploy.ps1`. La barrera
026 se conserva para su actualización inicial; no se vuelve a exigir su política
inicial cuando el ledger ya contiene 026. Se añadió una barrera 027 automática,
sin opción para omitirla, para la transición inicial de `rsp-pilot`:

1. Comprobar deployment state, identidad de imágenes anteriores y salud de los
   cuatro servicios. Exigir ledger exactamente 000–026, checksums válidos y 027
   como única migración local pendiente, sin tabla anticipada.
2. Rechazar auditorías pendientes o fallidas después de validar 027. Si la tabla
   ya se migró, exigir un cierre anterior exitoso y coherente con el SHA del
   deployment state. No saltar comprobaciones mediante un reintento.
3. Construir únicamente desde un checkout limpio del SHA autorizado, o usar las
   referencias remotas admitidas por el procedimiento existente. Verificar las
   etiquetas SHA de ambas imágenes y el inventario/checksums 000–027 dentro de
   la imagen API, mediante un contenedor efímero sin red, volúmenes ni secretos.
4. Conservar mantenimiento, contención de escrituras y respaldo integral
   verificado existentes. Capturar el baseline después del respaldo y antes de
   migrar, con API detenida.
5. Aplicar el migrador existente, cuyo inventario ya fue comprobado. Antes de
   iniciar API/frontend, comprobar ledger 027, estructura nueva vacía y
   conservación estricta de todos los datos anteriores.
6. Iniciar servicios y ejecutar `smoke.ps1 -Validate027` por el proxy privado.
   Requiere autenticación administrativa, detalle con
   `prefiltro_constructivo: []`, perfil de un pozo con profundidad conocida,
   PDF válido y los controles existentes de cookies, CSRF, WebSocket, puertos,
   TLS y fotografía cuando esté disponible. No crea perforaciones ni prefiltros.
7. Exigir `SMOKE_027_API_OK` y la identidad del usuario del smoke. Repetir la
   conservación, verificar imágenes en ejecución y comparar la huella del
   inventario de persistencia con `persistence.inventory` del respaldo.
8. Registrar `validation_027 = passed`, persistir deployment state y recién
   entonces reabrir. Ejecutar el smoke público existente. Un fallo conserva
   evidencia y utiliza la contención/recuperación existente, sin restauración
   destructiva ni rollback automático de datos.

La evidencia privada `<bundle>-027.json`, dentro del directorio de estado
configurado, registra SHA anterior/objetivo, bundle, snapshots, checks completados
y huella de persistencia. La auditoría existente registra fase y error. No se
imprimen contenidos de clientes: snapshots contienen estructura, conteos, hashes
y datos técnicos de control. No editar marcas de éxito para desbloquear reintentos.

## Conservación y alcance de las lecturas

`validation-027.sql` se ejecuta en transacción `REPEATABLE READ READ ONLY`, con
`ON_ERROR_STOP`, conexión de solo lectura y timeout. Compara todas las tablas
previas del esquema público, su estructura, funciones y secuencias. Esto incluye
numeración, política/rangos/excepciones tal como existan realmente, reservas,
pozos y texto legado `pre_filtro`, sellos, filtros, litología, documentos,
informes, idempotencia, auditorías, usuarios, roles y permisos. No exige revisión
1 de política, contador 3282 ni identidades particulares de P-3277.

La comprobación inmediatamente posterior a migrar es estricta, incluso para
sesiones. Tras arrancar la API se distingue la actividad técnica existente:
el logout del smoke incrementa exactamente una vez `version_sesion` de su usuario;
los demás campos y usuarios deben permanecer idénticos. Las tablas técnicas
`sesion_nativa` y `ticket_ws_nativo` pueden ser depuradas por el janitor existente.
No se exceptúan tablas empresariales. El smoke no es una transacción global de
solo lectura: realiza login/logout, pero sus consultas empresariales son GET y
no contiene escrituras de numeración, perforaciones ni permisos.

`prefiltro_pozo` debe tener exactamente las columnas y tipos aprobados, PK
`(id_pozo, desde_m)`, FK hacia `pozo` con `ON DELETE CASCADE`, restricciones de
nulabilidad, finitud y orden de profundidades, e índice primario válido. Debe
estar vacía en esta primera actualización. No se cambia la migración 027.

`validation-027-persistence.mjs` reproduce en lectura el inventario de
`ops/persistence.sh`: rutas relativas, tipos, permisos/propietario, tamaños y
SHA-256 de todos los archivos bajo la raíz de persistencia. Incluye archivos
archivados y ocultos; rechaza enlaces/tipos no soportados y restos de restauración.
No sustituye la verificación integral del respaldo que ya realiza `backup.ps1`.

## Ensayos realizados

| Verificación | Resultado |
| --- | --- |
| Migración y snapshots reales en PostgreSQL 16 descartable | 4/4 |
| Validadores contra snapshots sintéticos, contratos y transporte | 43/43 |
| Orden, fallos bloqueantes, recuperación y rechazo de reintentos 027 | 13/13 |
| Smoke autenticado 027 con HTTP simulado | 9/9 |
| Inventario de persistencia y alteraciones inducidas | 6/6 |
| Regresión de mantenimiento/recuperación existente | 24/24 |
| Regresión de barrera 026 | 10/10 |
| Regresión de smoke autenticado 026 | 6/6 |

También se comprobó el catálogo con PostgreSQL 18 local. PostgreSQL 16 usa la
imagen fijada en Compose, pero un contenedor propio `rsp-gate027-lab-*`, puerto
loopback aleatorio, credenciales aleatorias y volumen descartable; no utiliza
redes, rutas ni secretos de producción. Se detiene y elimina únicamente ese
contenedor al terminar. Las pruebas del despliegue y HTTP usan mocks: no equivalen
a un despliegue completo ni a un smoke real de la aplicación productiva.

Comandos de reproducción aislada, solo si es necesario repetirlos:

```powershell
node scripts/test-validation-027-postgres.mjs --docker16
# Usar el directorio de snapshots sintéticos que imprime el comando anterior:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-validation-027.ps1 -SnapshotDirectory <directorio>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-deploy-maintenance-mocks.ps1 -Validation027Only -SnapshotDirectory <directorio>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-rsp07f-r8-smoke.ps1 -Validation027Only
node --test scripts/test-validation-027-persistence.mjs
```

No se repitieron las suites funcionales 027 aprobadas. No se ejecutó el despliegue
real. Antes de autorizarlo faltan revisión y publicación del ajuste operativo,
selección explícita del nuevo SHA autorizado, preflight real, capacidad/espacio,
ventana sin sincronizaciones, respaldo nuevo y las comprobaciones privadas/públicas.
No se debe etiquetar código operativo nuevo como si perteneciera al SHA funcional
anterior. Si no hay un pozo existente con perfil comprobable, falla el smoke y
se requiere revisión; no se crean datos para hacerlo pasar. Un timeout o falta
de permiso al inventariar también bloquea: evaluar capacidad antes del mantenimiento.

## Android: estado comprobado y pendientes

- Capacitor y Gradle usan `uy.com.raulsilva.perforaciones`. No hay variante de
  pruebas con identidad separada. Una APK debug con esa identidad no es apta para
  coexistir con el piloto sin riesgo de sustitución/conflicto.
- Los assets nativos existentes apuntan a `https://api.raulsilvaperforaciones.com`.
  No utilizarlos para probar prefiltro mientras esa API ejecuta 026.
- No se identificó ni se proporcionó un backend HTTPS aislado apto. Los procesos
  locales en 3000/4200 no acreditan HTTPS válido ni accesibilidad desde un teléfono.
- `adb devices` no mostró dispositivos conectados. No se instaló, desinstaló ni
  borró nada. No se construyó APK; no existe ruta/hash de un artefacto de esta etapa.
- El build nativo existente exige `NATIVE_BACKEND_ORIGIN`, configura API y WSS
  para ese origen y genera CSP correspondiente. La autenticación nativa utiliza
  sus endpoints y almacenamiento seguro. La cola y archivos offline se separan
  por origen/backend y usuario; no se deben migrar ni borrar sus datos manualmente.

Para habilitar la prueba falta una URL HTTPS real autorizada con API 027,
PostgreSQL/archivos descartables, secretos independientes y cuentas/datos sintéticos.
Comprobar certificado válido desde Android, acceso de red, autenticación nativa,
roles apropiados y época de datos. No publicar un nuevo servicio ni cambiar
Cloudflare/certificados sin autorización. Para offline usar una cuenta de prueba
con el rol permitido por el flujo existente (`perforador` u `operador_admin`).

Después, aprobar una identidad de prueba distinta en una copia aislada del
proyecto; por ejemplo `uy.com.raulsilva.perforaciones.pruebas027` es solo una
propuesta, no una configuración aplicada. Verificar coherencia Capacitor/Gradle,
sin modificar la identidad piloto ni la firma de release. En esa copia:

1. Configurar `NATIVE_BACKEND_ORIGIN` con la URL aislada verificada.
2. Ejecutar `npm.cmd run build:native:development` desde `front` y
   `npx.cmd cap sync android`; usar las verificaciones de assets existentes.
3. Construir `gradlew.bat assembleDebug` desde `front/android`. Inspeccionar
   package ID del APK, destino de API/WSS/CSP y revisión fuente; registrar ruta
   y SHA-256 (`Get-FileHash -Algorithm SHA256`). No generar release firmada.
4. Conectar el teléfono por USB y autorizar depuración. Comprobar con ADB que
   la identidad del APK difiere de la instalada. Instalar mediante
   `adb install <APK-verificada>`, sin `-r`, desinstalación ni borrado de datos.
   Si hay conflicto, detenerse. Confirmar que ambas aplicaciones permanecen.

No ejecutar esos pasos hasta contar con backend e identidad autorizados. Una
compilación correcta no acredita una prueba física satisfactoria.

## Guía de comprobación física (pendiente del propietario)

1. Abrir solo la app de pruebas y autenticar contra el backend aislado. Confirmar
   con el operador que no contiene clientes reales. Mantener el piloto intacto.
2. En una perforación ficticia, agregar prefiltros 13.5–15.5 y 20–25 m, modificar
   extremos y eliminar uno. Probar negativos, intervalos invertidos y fuera de
   profundidad. Revisar advertencia de solapamiento con sello y prefiltro sin filtro.
3. Ver sello/prefiltro de grosor esquemático `0.13`, filtro ranurado, etiquetas,
   profundidades y preview vertical sin desbordamiento. Guardar, cerrar/reabrir,
   editar/eliminar prefiltro y regenerar PDF comprobando los mismos intervalos.
4. Abrir una perforación ficticia antigua sin prefiltro: colección vacía, sin
   intervalos inventados; sello previo intacto.
5. Tras iniciar sesión online y preparar la cuenta offline, activar modo avión,
   crear/guardar un borrador ficticio con varios intervalos y reabrirlo. Recuperar
   conexión, sincronizar exclusivamente al backend aislado y verificar un único
   registro y estado confirmado; reintentar sin duplicar. No borrar colas ni
   crear claves nuevas para evitar errores. Nunca usar borradores del piloto.
6. Registrar capturas, PDF y resultado de cada paso sin información personal.
   La validación Android físico permanece pendiente hasta realizar esta prueba.

## Incidente del 27/10/2026 UTC: corrección local, sin reintento

El intento del SHA `df0a41caaddd106ff19810a5379fbf62ca391052` construyó API y
frontend, pero se detuvo antes de mantenimiento. Windows PowerShell perdió las
comillas internas de la plantilla Go usada para consultar la etiqueta
`org.opencontainers.image.revision`; Docker informó `function "org" not defined`.
Las etiquetas reales eran correctas. No fue una discrepancia del código construido.

`Assert-Rsp027TargetMigrations` ahora consume `docker image inspect` como JSON,
exige exactamente una imagen con ID SHA-256 válido por referencia y compara una
etiqueta de texto con el SHA completo esperado. Rechaza error de Docker, respuesta
vacía, JSON inválido, objetos en lugar de la colección de inspección, colecciones
vacías/ambiguas, ID inválido y etiqueta ausente, vacía o diferente. API y frontend
se inspeccionan independientemente. El inventario se ejecuta usando el ID
inmutable de la API inspeccionada, sin depender de que su tag siga apuntando al
mismo objeto. Se mantienen `--rm --pull=never --network none --read-only`, sin
montajes, variables de credenciales ni inicio del servidor/API.

Resultados del parche:

- Validadores con snapshots sintéticos existentes: **68/68**. Se añadieron
  rechazos independientes para ambas imágenes y errores de inventario; no se
  repitieron migraciones ni suites funcionales.
- Windows PowerShell real **5.1.26100.9711** y Docker real: lectura correcta de
  las dos imágenes del intento; inventario completo **000–027** y checksums
  correctos mediante el contenedor efímero por ID.
- Docker real: SHA esperado incorrecto rechazado; imagen nginx existente sin
  etiqueta de revisión rechazada tanto en posición API como frontend. JSON
  inválido, resultados ambiguos y fallos de transporte se ensayan con mocks,
  sin fabricar ni modificar imágenes reales.
- No se reconstruyeron ni reetiquetaron imágenes. Las del intento siguen
  perteneciendo a `df0a41c`; el parche local necesitará un nuevo commit y nuevas
  imágenes de ese SHA cuando se autoricen.

### Clasificación del incidente, comprobada en lectura

Auditoría: `state/deploy-rsp-pilot.json`, dentro del directorio privado de la
operación `20261025T211057792Z`. Sigue con `status=failed`, fases
`preflight/preflight`, `validation_027=pending`, `database_recovery=not_required`,
sin bundle y con `deployment_state_persisted=false`.

`Read-DeploymentAuditForRollback` devuelve `rollback_noop=true`,
`rollback_requires_full=false` y `backup_completed=false`. Esto clasifica el
incidente; **no autoriza un reintento ni elimina la barrera pending**.

La evidencia adicional coincide: logs sin inicio de mantenimiento/respaldo/
migración; ningún contenedor de mantenimiento; los cuatro contenedores originales
saludables y arrancados antes del intento; imágenes en 026; deployment state
idéntico byte por byte a su copia anterior; ledger 000–026 con checksums correctos
y `prefiltro_pozo` ausente. Numeración observada: 3284/3283, sin modificarla.
No se ha usado esta comprobación para afirmar que no haya actividad empresarial
legítima posterior: el próximo despliegue deberá capturar su propio baseline.

Huellas SHA-256 comprobadas, antes y después de las lecturas:

- Auditoría fallida: `66769CD6E1F089F5072DD0DC3CBF73BB6AC2AC898B8215FBD4C70D0B6A3081EE`.
- Archivo deployment state: `FF5205CA4DD8ABF41F47871E370525F8F37B6597AA909C5130AF550E1ABD586A`.

No se ejecutó rollback, mantenimiento, migración, reconocimiento ni otro deploy.

### Reconocimiento excepcional implementado localmente (NO aplicado en producción)

`ops/acknowledge-027-preflight.ps1` emite un reconocimiento; `ops/deploy.ps1`
lo consume posteriormente. La lógica compartida está en `ops/recognition-027.ps1`.
No es una validación exitosa de 027, un rollback ni una dispensa del mantenimiento,
respaldo, migración, conservación, smoke o persistencia del estado.

La elegibilidad se limita al proyecto `rsp-pilot`, actualización inicial 026→027,
auditoría formato 3 `failed/pending`, fases **preflight/preflight**,
`database_recovery=not_required`, sin bundle, sin estado persistido y sin errores
de recuperación. Deben constar explícitamente mantenimiento y bloqueo público
no activados. `rollback_noop` solo es una condición adicional, no la prueba única.
Se rechazan incidentes de mantenimiento/migración y reconocimientos de reintentos.

Se comprueban nuevamente, al emitir **y al consumir**:

- SHA-256 del incidente; state idéntico a su copia previa y coherente con el cierre
  satisfactorio de 026; SHA, referencias e IDs originales de API/frontend.
- Log del mismo target/configuración, dentro de las fechas del incidente, con
  `DEPLOY_FAILED`/`ROLLBACK_NOT_REQUIRED` y sin inicio de mantenimiento u otras fases.
- Ledger 000–026 y checksums; 027 única pendiente; `prefiltro_pozo` ausente.
- Cuatro servicios saludables del proyecto correcto, arrancados antes del intento;
  imágenes originales activas; ausencia de contenedores de mantenimiento y proxy
  de smoke, incluso detenidos; ninguna operación adicional activa en el proyecto.
- Ausencia observable de otros procesos operativos. Deploy y reconocimiento usan
  además un bloqueo exclusivo sobre `<DeploymentStateFile>.operation.lock`, que
  se conserva como archivo y se libera como handle al finalizar el proceso.

No se consultan valores fijos de numeración ni se restablece la política 026.
La empresa puede continuar trabajando con 026: el próximo deploy tomará un nuevo
baseline cuando contenga las escrituras. Estas comprobaciones demuestran la fase
operativa alcanzada; no sustituyen la confirmación responsable del operador.

#### Etapa A: emitir, únicamente después de autorización específica

El nuevo SHA definitivo debe existir después del futuro commit/publicación. No usar
`df0a41c` ni un SHA ficticio en producción. En el ejemplo, las variables representan
rutas privadas ya verificadas; no son valores por defecto ni nuevos directorios.

```powershell
& .\ops\acknowledge-027-preflight.ps1 `
  -EnvFile $EnvFile -DeploymentStateFile $DeploymentStateFile `
  -StateDir $StateDir -ProjectName rsp-pilot `
  -IncidentSha256 $IncidentSha256 -Operator $Operator -Reason $Reason `
  -NewGitSha $NewGitSha -Confirm VERIFIED_NO_PRODUCTIVE_CHANGES `
  -PreviousStateFile $PreviousStateFile -PreviousAuditFile $PreviousAuditFile `
  -LogFile $IncidentStdoutLog
```

El hash se suministra en hexadecimal minúsculo. Las copias previas y el log deben
ser los originales del intento, no archivos reconstruidos para satisfacer controles.
Los directorios privados deben conservar sus permisos restringidos. La identidad
del operador es una declaración auditada bajo esos permisos, no un nuevo sistema
de autenticación. No se copian secretos de entorno ni credenciales de smoke.
La revisión final agregó rechazo de rutas fuera del directorio autorizado, streams
alternativos y enlaces/junctions en sus componentes. También se rechazan permisos
de escritura para grupos amplios (Everyone, Authenticated Users, Users, Guests y
Anonymous); no se cambian ACL automáticamente. Los archivos nuevos heredan los
permisos del directorio privado comprobado. No se admiten rutas de red para esta
recuperación local de Windows. Administradores y operadores con acceso autorizado
deben abstenerse de editar evidencia o ejecutar comandos concurrentes manuales.

Primero se reserva `deploy-rsp-pilot.027-claim.json` con `CreateNew` exclusivo y
flush durable. Después se crea `incident-027-<id>/`, con copias byte por byte de
`audit.json`, `previous-state.env`, `previous-audit.json` e `incident.log`. Cada
archivo tiene SHA-256 y se compara con su fuente. Los logs originales no se editan.
Finalmente se publica `deploy-rsp-pilot.027-recognition.json`, que contiene el
incidente, SHA de origen/objetivo fallido/nuevo objetivo, operador, motivo, fecha UTC,
confirmación, inventario y evidencia de lectura. Se devuelve su ruta y SHA-256.
La auditoría original **permanece en su ruta, con bytes y marcas intactos**.

#### Etapa B: consumir, únicamente con autorización posterior de despliegue

A los parámetros habituales de `deploy.ps1` se añaden exclusivamente:

```powershell
-Recognition027File $RecognitionFile -Recognition027Sha256 $RecognitionSha256
```

Sin reconocimiento válido se mantiene el bloqueo actual. Proyecto, incidente,
state, archivos históricos y nuevo `GitSha` deben coincidir exactamente. Se repiten
los controles de elegibilidad; luego se crea de forma exclusiva
`deploy-rsp-pilot.027-consumed.json`. Esta reserva atómica permite un solo ganador
entre dos procesos. Se escribe y fuerza a disco **antes** de crear la nueva auditoría.
Un comprobante truncado también bloquea; nunca se elimina para permitir un reintento.

La nueva auditoría es `deploy-rsp-pilot.027-attempt-<id>.json`, formato 3 habitual.
`recognition_027` incluye ruta/hash del reconocimiento y del incidente, copia
histórica, operador, motivo y fecha de consumo. Comienza con `validation_027=pending`.
Se exige ejecutar la actualización inicial completa; el reconocimiento nunca puede
convertirla en `not_required` ni sustituir las comprobaciones de 026/027.
La publicación inicial de esta auditoría usa también `CreateNew` y revalida las
huellas del incidente y su copia. Si aparece un archivo entre el consumo y esa
publicación, se rechaza sin sobrescribirlo y sin entrar en acciones de despliegue
o recuperación. Las actualizaciones posteriores conservan el escritor atómico habitual.

El comprobante permite resolver la auditoría actual sin sobrescribir el incidente.
Los despliegues posteriores correctos siguen usando esa auditoría actual y conservan
el vínculo al incidente. Para inspección/recuperación, usar la ruta real indicada en
`DEPLOY_AUDIT` o `ROLLBACK_REQUIRED`, no asumir que el archivo canónico antiguo es
el último. `Resolve-Rsp027DeploymentAudit` valida el vínculo antes de continuar.

#### Interrupciones y recuperación

- Antes de reservar el reconocimiento: no se publica autorización alguna.
- Después del claim, antes/durante el archivo o antes de publicar el reconocimiento:
  el claim incompleto bloquea nuevas emisiones; conservar todo para revisión manual.
- Después del archivo: sus bytes y el incidente siguen disponibles, aunque no se
  haya completado la emisión.
- Durante/después del consumo, antes de escribir la nueva auditoría: el comprobante
  existente, incluso truncado, impide reutilizar el reconocimiento. Si falta la
  auditoría enlazada, deploy se detiene antes de operar servicios.
- Fallo del nuevo deploy: su auditoría propia conserva el error y las barreras
  existentes mantienen la contención correspondiente a la fase alcanzada. No hay
  segundo reconocimiento automático, limpieza de marcas ni rollback destructivo.

No borrar claims/comprobantes/archivos para desbloquear. Una interrupción requiere
evaluación y autorización de recuperación específica, fuera de este procedimiento.
Los locks coordinan estos scripts actualizados; no constituyen una exclusión contra
comandos Docker manuales u operadores externos. No ejecutar operaciones paralelas.

`Read-DeploymentAuditForRollback`, `rollback.ps1`, la restauración integral y la
barrera 026 no cambian de contrato. El lector acepta la nueva auditoría formato 3
con metadatos adicionales. No utilizar rollback sobre el incidente original para
reclasificarlo: esa ruta histórica debe permanecer inmutable. Una recuperación real
posterior usará la auditoría del intento correspondiente y sus autorizaciones.

#### Verificación local y pasos pendientes

Ensayos con Windows PowerShell 5.1, archivos temporales sintéticos y Docker simulado
que rechaza llamadas no previstas. Las copias de prueba solo aceptan proyectos
`rsp07f-r3-*`; el fixture rechaza `rsp-pilot`. No se consultó ni cambió producción
durante estos ensayos y no se generó un reconocimiento productivo.

- Reconocimiento: **63/63** tras la revisión final (55/55 anteriores), incluidos hashes, evidencia ausente/alterada,
  fases tardías, state, imágenes, ledger, mantenimiento, concurrencia, archivos
  truncados, interrupciones, contención de rutas, junctions, ACL, publicación
  exclusiva de auditoría y conservación exacta del historial.
- Deploy con reconocimiento real sobre fixtures: **19/19** tras la revisión final (18/18 anteriores), flujo completo,
  respaldo obligatorio, fallos de migración/smoke/conservación, bloqueo, reintento
  y colisión al publicar la nueva auditoría sin sobrescritura ni recuperación accidental.
- Regresión de mantenimiento: **24/24**; barreras 026 **10/10** y 027 **13/13**.
- Recuperación/rollback simulado: **13/13**; sintaxis PowerShell y `git diff --check`
  correctos. No se ejecutó ningún rollback real.
- La corrección Docker y su evidencia real **68/68** precedente se conservan;
  no se repiten pruebas funcionales del prefiltro ni Android.

Pendientes separados: revisión y autorización del commit; publicación autorizada;
autorización de reconocimiento con su nuevo SHA; autorización de despliegue y
construcción de imágenes de ese mismo SHA. No reutilizar ni reetiquetar las imágenes
del intento anterior para aparentar que incluyen el parche. Android físico continúa
diferido. Ninguna de estas autorizaciones está implícita en las pruebas locales.
