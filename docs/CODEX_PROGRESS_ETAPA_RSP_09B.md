# Progreso ETAPA RSP-09B — backend auth native y sesiones mobile

## 1. Alcance cerrado

RSP-09B implementa exclusivamente el soporte backend común para Android e iOS. No incorpora cliente mobile ni modifica el runtime WebSocket para canjear tickets. La arquitectura autoritativa de `CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md` se mantiene sin alternativas ni relajaciones del contrato web.

## 2. Migración 008 y esquema

La migración canónica es `008_autenticacion_nativa.sql`. Crea:

- `sesion_nativa`: PK `id_sesion_nativa`, FK `id_usuario`, `token_hash` binario único de 32 bytes, `installation_id` UUID, `version_sesion_emitida`, `platform`, build y versión informativa de login, timestamps absolutos y revocación con motivo controlado;
- `ticket_ws_nativo`: PK `id_ticket_ws_nativo`, FK no nula a la sesión native con `ON DELETE CASCADE`, `ticket_hash` binario único de 32 bytes, plataforma/build de emisión y timestamps de creación, expiración y uso futuro.

Las restricciones validan hashes de 32 bytes, versiones/builds positivos, plataformas `android|ios`, expiración posterior a creación y coherencia de revocación/uso. No se almacena password, token raw, ticket raw, IMEI, serial, advertising ID ni fingerprint.

Los índices cubren lookup único por hash, sesiones activas/eviction por usuario y versión, replacement por usuario+instalación, ambas ramas de cleanup de sesiones, FK de ticket y cleanup por expiración. El índice de eviction fija `created_at ASC, id_sesion_nativa ASC`.

Se validaron fresh `000..008`, upgrade exacto `007→008`, rerun no-op, ledger de nueve entradas y checksums `000..007` intactos. El test histórico desde `006` también aplica `007,008` sin alterar datos nullable. Los contratos operativos que contaban migraciones fueron actualizados a `000..008`; el fallo transaccional sintético pasó a `009_control_failure.sql` para no colisionar con la migración real.

## 3. Token opaco y HMAC

La sesión usa `rspn1_` seguido por 32 bytes aleatorios codificados base64url sin padding (43 caracteres de payload). El ticket usa `rspw1_` con la misma entropía y codificación. Los parsers exigen esquema Bearer, prefijo, longitud, alfabeto y representación base64url canónica exactos.

El raw se entrega una sola vez y nunca se persiste. PostgreSQL recibe únicamente HMAC-SHA-256. Se usa `NATIVE_TOKEN_HMAC_SECRET` y separación de dominio explícita mediante los contextos versionados `session` y `ws-ticket`, lo que impide confundir digests aunque compartan la clave dedicada. Bcrypt se conserva sólo para passwords.

## 4. Configuración native

Se agregaron y validaron tempranamente:

- `NATIVE_TOKEN_HMAC_SECRET` (obligatorio en producción, mínimo 32 caracteres, no trivial y distinto de `FASTIFY_SECRET`);
- `NATIVE_SESSION_TTL_DAYS=30`;
- `NATIVE_SESSION_RETENTION_DAYS=30`;
- `NATIVE_MAX_ACTIVE_SESSIONS_PER_USER=5`;
- `MIN_NATIVE_ANDROID_BUILD` y `MIN_NATIVE_IOS_BUILD` (obligatorios en producción);
- `NATIVE_WS_TICKET_TTL_SECONDS=30`;
- `NATIVE_WS_TICKET_RETENTION_MINUTES=60`;
- `NATIVE_AUTH_JANITOR_INTERVAL_SECONDS=300`;
- `NATIVE_AUTH_JANITOR_BATCH_SIZE=500`;
- `NATIVE_AUTH_JANITOR_FAILURE_THRESHOLD=3`;
- `RATE_LIMIT_NATIVE_WS_TICKET_MAX=30`;
- `NATIVE_CORS_ORIGINS=https://localhost,capacitor://localhost`, limitada a esos dos valores aprobados.

Development/test usa una clave fija marcada exclusivamente para desarrollo; no se agregó ningún secreto real. Compose y las fixtures productivas exigen/proveen sólo secretos efímeros controlados.

## 5. Login native

`POST /api/auth/native/login` (ruta interna `/auth/native/login`) recibe email/password/`installation_id` y exige `X-Native-Platform`, `X-Native-App-Build` y, opcionalmente, `X-Native-App-Version`.

El build se valida antes de consultar credenciales. Android e iOS se comparan como enteros monotónicos contra mínimos independientes; `app_version` nunca participa del enforcement. Un build obsoleto devuelve `426 NATIVE_APP_UPGRADE_REQUIRED` y no crea sesión.

El login reutiliza búsqueda de cuenta, bcrypt actual, cuenta activa, `cuenta_acceso`, roles y el mismo rate limiter de login. Email o password incorrectos, usuario inactivo y propietario operativo sin cuenta devuelven el mismo error genérico. `propietario_email` no se consulta como credencial.

## 6. Transacción, replacement y límite

Bcrypt se ejecuta antes de adquirir locks. Tras validarlo se abre una transacción corta que:

1. bloquea el usuario mediante `SELECT ... FOR UPDATE`;
2. revalida activo, cuenta, password hash y `version_sesion`;
3. revoca la sesión activa de la misma instalación;
4. cuenta sólo sesiones no revocadas, no expiradas y de la versión vigente;
5. revoca las más antiguas necesarias en orden determinista;
6. inserta la nueva sesión con TTL absoluto y confirma.

El lock por usuario serializa login, desactivación, cambio de versión y logout-all sin mantener bcrypt dentro de la transacción. Usuarios distintos no se bloquean entre sí. PostgreSQL real confirmó `4+2→5`, `0+6→5`, replacement concurrente de una instalación, eviction determinista, estados terminales que no consumen cupo y aislamiento entre usuarios.

## 7. Resolver Bearer y autorización compartida

La capa reusable comprueba formato/HMAC, sesión no revocada ni expirada, usuario activo con cuenta/password, igualdad de `version_sesion`, plataforma actual coincidente, build entero y mínimo vigente. La identidad se normaliza al mismo `req.user` usado por los guards existentes; roles, ownership y permisos se vuelven a resolver desde los mecanismos actuales, no desde un snapshot de sesión.

En endpoints compartidos, la presencia de `Authorization` selecciona Bearer native y cualquier fallo se rechaza sin fallback a cookie. Sin Bearer se conserva la cookie web. Cookie y Bearer simultáneos se rechazan para eliminar ambigüedad. Login/logout web y WebSocket web usan explícitamente autenticación cookie-only.

## 8. CSRF, Origin y CORS

La cookie web conserva double-submit CSRF. Una mutación autenticada exclusivamente por Bearer no depende de credenciales ambientales y no exige CSRF. El branching no autentica por la mera presencia del header: el resolver Bearer debe validar la sesión; Bearer inválido más cookie/CSRF nunca baja a web.

Origin native acepta exactamente `https://localhost` y `capacitor://localhost` cuando corresponde a namespace/header native. Origin sigue siendo defensa adicional, no identidad. `PUBLIC_ORIGIN`, Origin web y Origin WebSocket permanecen estrictos.

CORS native permite sólo los origins aprobados y los headers `Authorization`, `Content-Type`, `X-Native-Platform`, `X-Native-App-Build` y `X-Native-App-Version`, sin anunciar credentials. El CORS web conserva su allowlist y credentials actuales.

## 9. Endpoints de sesión y logout

`GET /api/auth/native/session` exige sesión activa y build vigente. Devuelve únicamente `id_usuario`, nombre, roles actuales y expiración para UX; no expone hashes, versiones internas ni secretos.

`POST /api/auth/native/logout` valida sólo un Bearer sintácticamente correcto, calcula su HMAC y realiza un único `UPDATE ... WHERE token_hash=$1 AND revoked_at IS NULL`. Activo, revocado, expirado, versión vieja, usuario inactivo y token desconocido bien formado producen `204` sin body. Missing/malformed produce el error auth estándar. No exige metadata ni build mínimo, por lo que un cliente obsoleto puede reducir privilegios. Retry y logout concurrente producen una sola transición persistida.

`POST /api/auth/native/logout-all` exige sesión native activa y metadata coherente, pero omite únicamente el mínimo de build. Incrementa atómicamente `usuario.version_sesion`; no recorre sesiones. Esto invalida sesiones web/native previas y deja tickets vinculados sujetos a la revalidación de versión que implementará RSP-09D.

## 10. Emisión de ticket WebSocket

`POST /api/auth/native/ws-ticket` exige Bearer activo, metadata coincidente y build vigente. Emite `rspw1_...` con 256 bits, TTL corto y raw retornado una vez; DB guarda sólo HMAC, sesión padre exacta, plataforma y build actual.

El límite específico es por `id_sesion_nativa`, aproximadamente 30/minuto por defecto; cambiar de IP no amplía el cupo y el limitador global sigue aplicándose. Sesiones revocadas, expiradas, de versión vieja, usuarios inactivos y builds obsoletos no emiten tickets.

No se implementó redemption, ticket en query string, handshake native, registry, fan-out, heartbeat, replacement de sockets ni cierre forzado.

## 11. Janitor, retención y readiness

El janitor se registra una sola vez, ejecuta al startup y luego por intervalo configurable con timers `unref`; graceful shutdown cancela intervalos/continuaciones. No se solapa consigo mismo. Cada sweep elimina primero tickets y luego sesiones usando CTE ordenada, `LIMIT`, `FOR UPDATE SKIP LOCKED` y batch configurable.

Los tickets se eliminan cuando su expiración supera la retención. Las sesiones se eliminan sólo si fueron revocadas antes del cutoff o si, sin revocación, expiraron antes del cutoff. Una sesión de versión vieja pero aún no expirada no se borra por mismatch. La FK cascade elimina tickets residuales al purgar su sesión.

Un fallo inicial degrada readiness y suspende emisión de tickets; tras haber funcionado, los fallos transitorios se observan y se reintentan, y la degradación ocurre al umbral consecutivo configurable. Un sweep exitoso recupera el estado. `/health` continúa siendo liveness; `/ready` exige PostgreSQL y janitor listo. Login y autenticación de negocio no dependen de un único fallo de cleanup.

No se implementó `last_used_at`, evitando escrituras por request y sliding expiration.

## 12. Logging y errores

La redacción cubre `Authorization`, cookies/CSRF, password, `session_token`, tokens `rspn1_`, tickets `rspw1_` y parámetros `ticket/ws_ticket`. El serializer de request registra método/ruta, no el objeto de headers. Los errores de login/auth son genéricos; sólo el build obsoleto usa `426` distinguible y el janitor degradado usa `503` para nueva emisión de ticket.

## 13. Validación ejecutada

- API TypeScript: build correcto;
- suite API completa: 280/280 tests;
- tests focalizados de token/HMAC, metadata, CSRF, CORS, Origin, migración, janitor, config y logging: correctos;
- PostgreSQL real: auth HTTP, HMAC/raw, replacement, límite/eviction, concurrencia, logout, logout-all, ticket, retención y cascade: correcto;
- migraciones: fresh nueve, upgrade `007→008`, rerun no-op y checksums previos intactos;
- regresión migratoria desde `006`: `007,008`, datos históricos intactos;
- lifecycle productivo aislado: adopción desde baseline, rollback/checksum/lock, backup, restore vacío y reemplazo con faults compensados, foto/PDF, login y readiness correctos;
- frontend sin cambios de runtime: contratos de configuración, UTF-8 y build Angular production correctos;
- `git diff --check`: correcto.

## 14. Contratos preservados y pendientes posteriores

La web conserva cookie HttpOnly/Secure/SameSite=Lax/Path=/, CSRF double-submit, CORS/Origin, logout, `version_sesion`, permisos y WebSocket actuales. No se cambió `/usuarios`, el modelo propietario≠cuenta, Docker, HTTPS, CSP, fotos, PDF, backup/restore ni el modelo de despliegue.

RSP-09C debe implementar el cliente Android (secure storage, headers y UX de upgrade/logout). RSP-09D debe implementar exclusivamente redemption atómico y runtime WebSocket native. iOS packaging/runtime queda para su etapa correspondiente. Ninguno de esos alcances fue anticipado aquí.
