# ETAPA RSP-09A — Arquitectura Mobile/Native Auth (Android + iOS)

Fecha: 2026-08-24
Generalización RSP-09A-R1: 2026-08-26
Corrección RSP-09A-R2: 2026-08-26
Corrección RSP-09A-R3: 2026-08-26
Rama: `feature/rsp-09-android-auth`
HEAD inicial: `14df7c0a7fa300a76df9646405eddfa4d247c0b3`
HEAD inicial R1: `ad4b86acfc90d075733f13ee766be128fad1bc93`
HEAD inicial R2: `976e802d384e05338e0871e8ef7f7261f529c26c`
HEAD inicial R3: `7193a4cb14661617389899a069f82c0ea578e6ce`

## 1. Resultado

RSP-09A nació como arquitectura Android/Capacitor y RSP-09A-R1 generalizó su resultado a **Mobile/Native Android+iOS** sin cambiar runtime productivo ni las decisiones base. RSP-09A-R2 corrigió dos P2 del contrato WebSocket native. RSP-09A-R3 separó el resolver Bearer estricto del lookup especial de logout-device para que retries posteriores a la revocación sigan devolviendo 204 sin autenticar la sesión. Web conserva cookie HttpOnly + CSRF; un único cliente mobile y un único backend native comparten sesión Bearer opaca, aleatoria, revocable y persistida server-side sólo por HMAC.

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
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`: registro acumulado de etapa y addenda R1/R2/R3.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R1.md`: evidencia específica de la generalización Mobile/Native.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R2.md`: evidencia de corrección de consumo/revalidación WS native.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R3.md`: evidencia del contrato idempotente de logout-device.

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

- RSP-09B: backend auth native común, DB, resolver dual estricto + lookup exclusivo de logout-device, CORS/Origin/CSRF branch, logout y tests Android+iOS.
- RSP-09C: cliente Capacitor compartido, Keystore/Keychain, transport Bearer, CSP/backup/lifecycle/config.
- RSP-09D: WebSocket native común, consumo por hash exacto, revalidación obligatoria cada heartbeat, replay/revocación/reconnect y ventana WS web tras logout.
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
- `UPDATE revoked_at = COALESCE(revoked_at, now())`, commit durable antes del 204 y cierre WS sólo como efecto complementario;
- ninguna autenticación, roles, fallback a cookie o modificación de otra sesión desde este lookup;
- logout-all continúa exigiendo sesión activa porque afecta otros dispositivos y web;
- estado cliente `logout pending`: bloquea negocio, conserva el token seguro sólo para retry y lo borra tras 204;
- matriz de respuestas y 16 tests futuros de idempotencia, concurrencia, anti-oracle, aislamiento y respuesta perdida para RSP-09B.

R3 no cambia runtime, WS tickets/revalidación, web auth, CSRF, Origin, storage ni decisiones criptográficas.
