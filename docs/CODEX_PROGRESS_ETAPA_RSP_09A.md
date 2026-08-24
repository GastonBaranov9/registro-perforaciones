# ETAPA RSP-09A — Arquitectura Android Auth

Fecha: 2026-08-24
Rama: `feature/rsp-09-android-auth`
HEAD inicial: `14df7c0a7fa300a76df9646405eddfa4d247c0b3`

## 1. Resultado

Se cerró la arquitectura de autenticación Android/Capacitor sin cambiar runtime productivo. La decisión es conservar web con cookie HttpOnly + CSRF y diseñar Android con una sesión Bearer opaca, aleatoria, revocable y persistida server-side sólo por HMAC.

No se crearon rutas, migraciones, tokens, secrets, plugins, target native ni APK. El documento principal es `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`.

## 2. Auditoría realizada

Se inspeccionaron directamente:

- plugins Fastify de cookies, JWT, CSRF, CORS, Origin, rate limit, request logging y WebSocket;
- rutas de login/logout, WebSocket, fotos y PDF;
- servicios de auth, roles, `version_sesion` y autorización por recurso;
- runtime config, proxy HTTPS/CSP y configuración de logs/redaction;
- interceptor Angular de cookies/CSRF, AuthService, WebsocketService y environments;
- `front/package.json`, `package-lock.json`, Angular config y scripts productivos;
- `capacitor.config.ts`, proyecto Android, manifest, Gradle, SDKs y plugins sincronizados;
- defaults del código Capacitor 8 instalado para hostname y scheme;
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

## 4. Caracterización Android

- Capacitor core/android/CLI: 8.0.0.
- Angular core: 20.3.9; CLI: 20.3.8.
- Ionic Angular: 8.7.8; toolkit: 12.3.0.
- Camera: 7.0.2; Geolocation: 8.0.0.
- `webDir`: `dist/front/browser`.
- sin `server.url`, hostname o scheme explícitos.
- origin efectivo: `https://localhost` por defaults del código Android instalado.
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
- secure storage candidato `@aparajita/capacitor-secure-storage` 8.0.0/MIT, a revisar e instalar recién en RSP-09C;
- token en JS sólo en memoria mediante servicio encapsulado; CSP native estricta y sin storage web;
- handlers de negocio compartidos tras resolver cookie o Bearer sin fallback ambiguo;
- CORS native exacto `https://localhost`, credentials false y Authorization permitido, separado de CORS web;
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

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`: auditoría, matriz, decisión, contratos, threat model y roadmap.
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`: registro de etapa y validaciones.

No se modificaron archivos de API, frontend, Android, proxy, Compose, migraciones, package manifests ni locks.

## 8. Validaciones ejecutadas

- API TypeScript build: correcto.
- Suite API completa: 267/267 pruebas correctas, incluidas cookie auth, CSRF, Origin/CORS, `version_sesion`, WebSocket, logging y rate limits.
- Frontend production build: correcto.
- Suite frontend ChromeHeadless: 197/197 pruebas correctas. El runner mantuvo advertencias conocidas de assets Ionicons, sin fallos.
- `npm run test:config`: 3/3 contratos correctos; sólo existen targets web development/production y no hay comando native.
- `npm run test:production-build`: correcto; artifact con `/api/` y `/ws` same-origin, sin backend/config native.
- Comparación de runtime contra HEAD inicial: `RUNTIME_UNCHANGED`; no cambiaron API, frontend, Android, proxy, Compose, manifests ni locks.
- Secret scan por firmas de private keys y tokens comunes: correcto, sin coincidencias.
- `git diff --check`: correcto.
- Estado antes del commit: sólo los dos documentos RSP-09A nuevos.

## 9. Roadmap

- RSP-09B: backend, migración, resolver dual, CORS/Origin/CSRF branch, logout y tests.
- RSP-09C: secure storage, transport Bearer, CSP/backup/lifecycle/config y build controlado.
- RSP-09D: tickets WebSocket, replay/revocación/reconnect.
- RSP-09E: APK piloto y pruebas físicas de cámara/GPS/red/upgrade.
- RSP-09F: drafts, idempotencia y resiliencia offline.

## 10. Pendientes y límites

Antes del piloto deben cerrarse appId/firma/dominio, revisión física del plugin, reglas backup, valores configurables finales y política de datos offline. Keystore no elimina el riesgo de XSS, dispositivo desbloqueado o root; la mitigación combina TTL, revocación, TLS, CSP y ausencia de logs.

No se realizó ni se realizará en esta etapa push, merge, rebase, reset, clean, cambio de rama, deploy externo, servicio externo real, Google real ni uso de secretos reales.
