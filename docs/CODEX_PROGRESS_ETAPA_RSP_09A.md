# ETAPA RSP-09A — Arquitectura Mobile/Native Auth (Android + iOS)

Fecha: 2026-08-24
Generalización RSP-09A-R1: 2026-08-26
Corrección RSP-09A-R2: 2026-08-26
Corrección RSP-09A-R3: 2026-08-26
Corrección RSP-09A-R4: 2026-08-26
Corrección RSP-09A-R5: 2026-08-26
Corrección RSP-09A-R6: 2026-08-26
Rama: `feature/rsp-09-android-auth`
HEAD inicial: `14df7c0a7fa300a76df9646405eddfa4d247c0b3`
HEAD inicial R1: `ad4b86acfc90d075733f13ee766be128fad1bc93`
HEAD inicial R2: `976e802d384e05338e0871e8ef7f7261f529c26c`
HEAD inicial R3: `7193a4cb14661617389899a069f82c0ea578e6ce`
HEAD inicial R4: `66287efb5177556453bc16ab423d1f7ac48c2f0a`
HEAD inicial R5: `a77400af99796ca8f20d3f50ded84daa42a3ca75`
HEAD inicial R6: `2294ff94bcc2b14f2fe839a95fc693b1b11d243d`

## 1. Resultado

RSP-09A nació como arquitectura Android/Capacitor y RSP-09A-R1 generalizó su resultado a **Mobile/Native Android+iOS** sin cambiar runtime productivo ni las decisiones base. R2–R5 cerraron tickets/revalidación/logout/registry/build/retención; R6 hace efectivo el máximo de sesiones mediante lock+eviction y extiende el janitor a filas de sesión terminales. Web conserva cookie HttpOnly + CSRF; un único cliente mobile y un único backend native comparten sesión Bearer opaca, aleatoria, revocable y persistida server-side sólo por HMAC.

No se crearon rutas, migraciones, tokens, secrets, plugins, target iOS ni APK/IPA. El documento principal conserva su nombre histórico `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md` para evitar ruido de rename; su título y contrato ya son Mobile/Native.

## 2. Auditoría realizada

Se inspeccionaron directamente:

- plugins Fastify de cookies, JWT, CSRF, CORS, Origin, rate limit, request logging y WebSocket;
- rutas de login/logout, WebSocket, fotos y PDF;
- servicios de auth, roles, `version_sesion` y autorización por recurso;
- runtime config, proxy HTTPS/CSP y configuración de logs/redaction;
- interceptor Angular de cookies/CSRF, AuthService, WebsocketService y environments;
- `front/package.json`, `package-lock.json`, Angular config y scripts productivos;
- `capacitor.config.ts`, proyecto Android, manifest, Gradle, SDKs y plugins sincronizados;
- ausencia real de `front/ios/`, `@capacitor/ios`, proyecto Xcode y build iOS;
- defaults del código Capacitor 8 instalado para hostname y scheme;
- defaults documentados de iOS, requisitos macOS/Xcode y opciones Apple de distribución piloto;
- tests de cookie/CSRF, auth cookie-only, Origin/CORS, rate limit, session version, hardening y contrato de build web.

## 3. Hallazgos del sistema actual

- Web usa `rsp_session` HttpOnly y `rsp_csrf` legible, ambas host-only, `Path=/`, `SameSite=Lax`, 10 h y `Secure` en producción.
- `authenticate` fuerza `onlyCookie` y verifica usuario activo + `version_sesion` en DB en cada request.
- logout web incrementa `version_sesion`, por lo que su semántica actual es global.
- mutaciones web requieren Origin allowlisted y double-submit CSRF; WS exige exactamente `PUBLIC_ORIGIN`.
- producción es same-origin mediante `/`, `/api/` y `/ws`; CORS nunca usa wildcard.
- rate limit por defecto: API 600/min/IP y login 10/min/IP; WS requiere un límite específico futuro.
- proxy y Fastify ya evitan headers/query sensibles y redactan Authorization/cookies/password/CSRF/base64.
- no existe build native productivo ni `NATIVE_BACKEND_ORIGIN`, conforme RSP-07F-R16.

## 4. Caracterización Mobile

- Capacitor core/android/CLI: 8.0.0.
- Angular core: 20.3.9; CLI: 20.3.8.
- Ionic Angular: 8.7.8; toolkit: 12.3.0.
- Camera: 7.0.2; Geolocation: 8.0.0.
- `webDir`: `dist/front/browser`.
- sin `server.url`, hostname o scheme explícitos.
- Android está añadido y conserva origin efectivo `https://localhost` por defaults del código instalado.
- iOS no está añadido: no existe `front/ios/` ni dependencia `@capacitor/ios`.
- el origin iOS esperado con defaults vigentes es `capacitor://localhost`, distinto de Android.
- Capacitor 8 requiere macOS, Xcode 26.0+ y Command Line Tools para producir/probar iOS; Windows permite desarrollar la base Angular, transport, contratos y tests compartidos, no generar un build iOS productivo.
- min SDK 23; target/compile SDK 35; Java 21; AGP 8.7.2; Gradle 8.11.1.
- permiso propio: Internet. Manifest actual permite backup sin reglas de exclusión.
- `CapacitorHttp` está en core y su patch está deshabilitado.
- `appId=com.example.app` es placeholder y debe hacer fallar un build piloto/productivo futuro.

## 5. Alternativas y decisión

Se descartaron cookies cross-origin, `server.url` remoto productivo y cookie bridge. Se dejó OAuth/OIDC + PKCE como alternativa futura sólo si aparece un IdP.

Se recomienda:

- Bearer opaco native de 256 bits;
- HMAC-SHA-256 con pepper separado, nunca raw en DB;
- sesión única de TTL absoluto recomendado 30 días, sin access+refresh inicial;
- fila `sesion_nativa` ligada a usuario, installation UUID y `version_sesion_emitida`;
- logout de dispositivo por fila y logout global por incremento de versión;
- secure storage candidato `@aparajita/capacitor-secure-storage` 8.0.0/MIT, compatible con Capacitor 8, Android Keystore e iOS Keychain, a revisar e instalar recién en RSP-09C;
- Keychain debe usar política futura no sincronizable/`ThisDeviceOnly`; Android debe excluir token e installation ID de backup/device-to-device;
- `installation_id` es un UUID propio aleatorio común, no IMEI/Android ID/serial/IDFA, y se regenera tras uninstall/reinstall;
- token en JS sólo en memoria mediante servicio encapsulado; CSP native estricta y sin storage web;
- handlers de negocio compartidos tras resolver cookie o Bearer sin fallback ambiguo;
- CORS native exacto por target (`https://localhost` Android, `capacitor://localhost` iOS), credentials false y Authorization permitido, separado de CORS web;
- CSRF sólo para mecanismo cookie; Origin native como defensa adicional, nunca autenticación;
- ticket WS aleatorio de un uso, 30 s, hash server-side; bearer principal nunca en query.

## 6. Spikes y evidencia

No se agregó un spike redundante ni rutas incompletas. Los tests existentes ya demuestran:

- cookie web aceptada y Bearer rechazado por `onlyCookie`;
- CSRF double-submit y atributos de cookies;
- Origin de mutación y WebSocket rechazado fuera del contrato;
- preflight limitado por allowlist;
- ausencia de build/config native productivo;
- routing web `/api/` y `/ws` same-origin.

La viabilidad de ticket WS se verificó arquitectónicamente contra `@fastify/websocket` y la ruta/hook existentes: el request de upgrade puede validarse antes de registrar la conexión. La prueba de replay/consumo atómico pertenece a RSP-09D, una vez exista persistencia real.

## 7. Archivos modificados

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`: auditoría, matriz, decisión, contratos, threat model y roadmap; generalizados en R1 y endurecidos para WS native en R2.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`: registro acumulado de etapa y addenda R1/R2/R3/R4/R5/R6.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R1.md`: evidencia específica de la generalización Mobile/Native.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R2.md`: evidencia de corrección de consumo/revalidación WS native.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R3.md`: evidencia del contrato idempotente de logout-device.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R4.md`: evidencia de repeat-write, fan-out/registry y roadmap definitivo de tickets.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R5.md`: evidencia de revalidación WS web, minimum-build actual y cleanup obligatorio.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R6.md`: evidencia de límite transaccional y retención acotada de sesiones native.

No se modificaron archivos de API, frontend runtime, Android/iOS, proxy, Compose, migraciones, package manifests ni locks.

## 8. Validaciones ejecutadas en el cierre original

- API TypeScript build: correcto.
- Suite API completa: 267/267 pruebas correctas, incluidas cookie auth, CSRF, Origin/CORS, `version_sesion`, WebSocket, logging y rate limits.
- Frontend production build: correcto.
- Suite frontend ChromeHeadless: 197/197 pruebas correctas. El runner mantuvo advertencias conocidas de assets Ionicons, sin fallos.
- `npm run test:config`: 3/3 contratos correctos; sólo existen targets web development/production y no hay comando native.
- `npm run test:production-build`: correcto; artifact con `/api/` y `/ws` same-origin, sin backend/config native.
- Comparación de runtime contra HEAD inicial: `RUNTIME_UNCHANGED`; no cambiaron API, frontend, Android, proxy, Compose, manifests ni locks.
- Secret scan por firmas de private keys y tokens comunes: correcto, sin coincidencias.
- `git diff --check`: correcto.
- Estado antes del commit original: sólo los dos documentos RSP-09A nuevos. Las validaciones proporcionales de R1 se registran en su documento específico.

## 9. Roadmap Mobile

- RSP-09B: backend auth native, migración 008, límite transaccional/eviction, minimum-build HTTP, emisión de `ws-ticket` y janitor común de tickets/sesiones; sin handshake WS.
- RSP-09C: cliente Capacitor compartido, Keystore/Keychain, Bearer + headers platform/build, UX upgrade required, CSP/backup/lifecycle/config.
- RSP-09D: redemption WS, registry/fan-out, revalidación native incluida minimum build, y revalidación web contra `version_sesion_emitida` del JWT.
- RSP-09E: APK piloto Android, preparación macOS/Xcode/distribución iOS y pruebas GPS reales Android+iPhone en la misma ubicación.
- RSP-09F: drafts, idempotencia y resiliencia offline.

## 10. Pendientes y límites

Antes del piloto deben cerrarse appId/bundle ID, firmas, dominio, revisión física Android+iOS del plugin, reglas backup/migración, distribución Apple, valores configurables finales y política de datos offline. Keystore/Keychain no eliminan el riesgo de XSS, dispositivo desbloqueado, root o jailbreak; la mitigación combina TTL, revocación, TLS, CSP y ausencia de logs.

No se realizó ni se realizará en esta etapa push, merge, rebase, reset, clean, cambio de rama, deploy externo, servicio externo real, Google real ni uso de secretos reales.

## 11. Corrección RSP-09A-R2

El review detectó que el pseudo-`UPDATE` de tickets no incluía `ticket_hash`, por lo que podía consumir múltiples tickets vigentes, y que la revalidación de la sesión padre figuraba como opcional. R2 deja obligatorio:

- derivar HMAC desde el raw presentado y filtrar `ticket_hash = $HASH_PRESENTADO`;
- consumo single-use atómico que devuelve como máximo una fila;
- FK ticket → `id_sesion_nativa` y validación completa de sesión/usuario/versión al redimir;
- rechazo del ticket si logout, expiración, desactivación o cambio de versión ocurre después de emitirlo;
- revalidación DB de sockets native en cada heartbeat, recomendada/configurable en 30 s máximo;
- cierre directo best-effort por registry, complementario y nunca sustituto del heartbeat;
- fail-closed y reconexión normal si no puede comprobarse el estado;
- matriz futura de concurrencia, revocación, expiración, aislamiento y fallos para RSP-09B/09D.

El WebSocket web conserva cookie/`PUBLIC_ORIGIN` y su hallazgo histórico: una conexión ya abierta aún no se revalida proactivamente. Su hardening permanece asignado a RSP-09D; R2 no modifica runtime.

## 12. Corrección RSP-09A-R3

El review detectó que el resolver normal rechazaba `revoked_at` antes de entrar al handler, contradiciendo el 204 idempotente prometido cuando la primera respuesta se pierde. R3 define:

- resolver Bearer normal intacto y estricto para negocio, `/session`, `ws-ticket` y `logout-all`;
- lookup exclusivo de `POST /api/auth/native/logout` por HMAC/token hash exacto, incluso para fila revocada, expirada, de versión antigua o usuario inactivo;
- header ausente/malformado: error auth; Bearer bien formado conocido, inutilizable o desconocido: 204 vacío uniforme;
- mutación idempotente durable antes del 204 y cierre WS sólo como efecto complementario; R4 reemplaza la formulación inicial con `SET revoked_at = now() WHERE revoked_at IS NULL` para evitar repeat-write;
- ninguna autenticación, roles, fallback a cookie o modificación de otra sesión desde este lookup;
- logout-all continúa exigiendo sesión activa porque afecta otros dispositivos y web;
- estado cliente `logout pending`: bloquea negocio, conserva el token seguro sólo para retry y lo borra tras 204;
- matriz de respuestas y 16 tests futuros de idempotencia, concurrencia, anti-oracle, aislamiento y respuesta perdida para RSP-09B.

R3 no cambia runtime, WS tickets/revalidación, web auth, CSRF, Origin, storage ni decisiones criptográficas.

## 13. Corrección RSP-09A-R4

R4 cierra tres P2 documentales:

- logout-device usa `WHERE token_hash = $HASH_PRESENTADO AND revoked_at IS NULL`; retry/unknown/carrera afectan cero filas y aun así devuelven 204, sin lookup/UPDATE adicional;
- dos logout concurrentes producen una sola escritura y respuestas 204/204;
- el runtime auditado usa `clientConnections.find(id_usuario)` y `notifyAdmin`/`notifyAll` reingresan por ese helper, por lo que pueden hambrear conexiones posteriores o duplicar la primera;
- RSP-09D sustituirá ese patrón por `connectionsById` canónico, índices por usuario/sesión, una conexión activa por `id_sesion_nativa`, replacement seguro y fan-out deduplicado por `connectionId`;
- `notifyClient` entrega a cada conexión web elegible y a una conexión por cada sesión native válida; `notifyAdmin`/`notifyAll` usan unión/snapshot única, sin duplicación deliberada;
- no se promete exactly-once/durabilidad, sólo no starvation, no duplicado dentro de un dispatch y fan-out a conexiones elegibles;
- RSP-09B crea futura migración 008, ambas tablas e implementa emisión/persistencia de `/api/auth/native/ws-ticket`; RSP-09D implementa handshake/redemption, registry, fan-out y lifecycle;
- los tests quedan divididos por esa frontera: HTTP/DB/emisión en 09B; consumo/concurrencia/delivery en 09D.

R4 no modifica runtime ni crea la migración 008; `000`–`007` permanecen intactas.

## 14. Corrección RSP-09A-R5

R5 cierra tres P2 documentales sin rediseñar los contratos anteriores:

- la auditoría confirmó que `/ws` valida cookie JWT con `sub`/`version_sesion`, pero el registry sólo conserva `id_usuario`/`isAdmin` y el heartbeat actual sólo comprueba ping/pong;
- RSP-09D guardará en cada conexión web la `version_sesion_emitida` procedente del JWT validado y la comparará periódicamente con DB; direct close sigue siendo best-effort y un socket stale revalida antes de delivery o cierra fail-closed;
- native separa `app_version` humana de `app_build` entero monotónico y exige en cada request normal `X-Native-Platform` + `X-Native-App-Build` actuales;
- `MIN_NATIVE_ANDROID_BUILD` y `MIN_NATIVE_IOS_BUILD` permiten upgrade-in-place con el mismo token y forced retirement en la siguiente request/heartbeat; la metadata `*_at_login` es sólo auditoría y no se reescribe por request;
- logout-device omite metadata/mínimo para no impedir el cierre; logout-all exige sesión activa y metadata válida, pero omite el umbral mínimo como acción reductora; `ws-ticket` sí exige mínimo y captura platform/build;
- RSP-09D conserva platform/build del socket native y cierra en heartbeat si aumenta el mínimo; la señal declarada no es anti-tamper;
- ticket mantiene TTL recomendado 30 s y retención post-expiry recomendada 60 min, configurables;
- RSP-09B implementará janitor obligatorio al startup y cada ~5 min, con lotes configurables de 500 sobre índice `expires_at`, continuación del backlog, concurrencia idempotente y pruebas de acotación;
- la migración futura 008 incorpora metadata platform/build e índices para lookup/FK/expiry; R5 no crea ni modifica migraciones.

Los tests quedan asignados sin solapamiento: RSP-09B cubre headers/minimum-build HTTP, excepciones logout, emisión y cleanup; RSP-09D cubre version/build capturados por conexiones, revalidación web/native, forced upgrade y pre-delivery fail-closed.

## 15. Corrección RSP-09A-R6

R6 cierra dos P2 documentales sin cambiar runtime ni contratos previos:

- `NATIVE_MAX_ACTIVE_SESSIONS_PER_USER=5`, entero >= 1 y fail-fast, sustituye la mera afirmación de cupo por una regla ejecutable;
- activa significa no revocada, no expirada y emitida con la `version_sesion` actual; logout-all hace que versiones anteriores dejen de contar sin updates masivos;
- bcrypt ocurre antes del lock; una transacción corta bloquea `usuario FOR UPDATE`, revalida estado/versión, reemplaza la misma installation, cuenta, hace eviction determinista e inserta/commit;
- eviction revoca las más antiguas por `created_at, id_sesion_nativa`, acotada estrictamente al usuario; concurrent logins nunca dejan más de cinco activas;
- el Bearer evicted falla con auth normal, tickets pendientes quedan inválidos por parent y RSP-09D cierra el socket best-effort/heartbeat;
- `NATIVE_SESSION_RETENTION_DAYS=30` conserva una fila aproximadamente 30 días post-terminal: desde `revoked_at`, o desde `expires_at` si nunca se revocó;
- una fila de versión antigua sin timestamp inventado permanece hasta expiry + retention, acotada aproximadamente a TTL 30 d + retention 30 d;
- el único janitor RSP-09B limpia primero tickets y luego sesiones, al startup/cada ~5 min, en lotes indexados de 500 con reintentos;
- FK ticket→sesión usa `ON DELETE CASCADE`; cascade evita residuos pero no sustituye el cleanup normal de tickets;
- degradación temporal no reactiva credenciales ni bloquea inmediatamente un login; backlog persistente degrada health/readiness y queda observable;
- migración 008 futura añade los índices de token, usuario/estado/eviction, installation y ambas ramas de cleanup; R6 no la crea.

RSP-09B añade 13 tests de cupo/concurrencia/aislamiento y 14 de session retention/janitor/FK/índices. RSP-09D prueba ticket/socket de una sesión evicted.
