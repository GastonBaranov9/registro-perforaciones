# RSP-09D — WebSocket native seguro

## Resultado

RSP-09D integra el WebSocket native con el WebSocket web existente en `GET /ws`.
La web continúa autenticándose con cookie `rsp_session`, CSRF/Origin y el JWT
web validado durante el upgrade. Android/iOS usa el contrato de RSP-09B:

`Bearer HTTP → POST /auth/native/ws-ticket → ticket rspw1_ → GET /ws?ticket=...`

El Bearer nunca se envía al handshake WebSocket, no se agrega a la URL, no se
persiste y no se incluye en errores, close reasons o logs. El ticket sí aparece
transitoriamente sólo en el handshake `/ws?ticket=...`; es single-use, corto,
aleatorio, vinculado a la sesión native y nunca se persiste ni se loguea.

## Backend

- `POST /auth/native/ws-ticket` permanece sin cambios de emisión: `rspw1_`,
  256 bits, HMAC del dominio `ws-ticket`, TTL configurable (30 s por defecto),
  rate limit y janitor de RSP-09B.
- La redención valida formato y calcula HMAC; PostgreSQL ejecuta un
  `UPDATE ticket_ws_nativo SET used_at = now()` atómico con
  `used_at IS NULL`, expiry, plataforma/build y sesión padre válida. La
  unicidad y el update atómico hacen que dos redenciones concurrentes del mismo
  ticket tengan exactamente un ganador.
- La misma transacción vuelve a leer y bloquea sesión/usuario antes del commit,
  comprobando `revoked_at`, expiry, usuario activo, `cuenta_acceso`, password,
  `version_sesion` y mínimo de build. Un ticket emitido antes de logout no
  revive la sesión.
- Origin native es exacto: Android `https://localhost` e iOS
  `capacitor://localhost`. Un ticket sólo se acepta con esos origins. La web
  conserva `PUBLIC_ORIGIN` exacto; no hay wildcard, `startsWith` ni fallback.
- La CSP native permite explícitamente el origin HTTPS del backend y su origen
  WSS derivado con parser URL; no agrega hosts, wildcard ni `wss:` abierto.
- El handshake clasifica por presencia de `ticket`: sin ticket exige
  `PUBLIC_ORIGIN` y cookie web; con ticket exige Origin native exacto, formato
  válido y un rate limit por IP antes de tocar PostgreSQL. Nunca hay fallback
  entre autenticación web y native.
- El registry distingue `web` y `native`, permite varias sesiones native del
  mismo usuario y mantiene como máximo un socket por `id_sesion_nativa`. Una
  reconexión reemplaza/cierra el socket anterior con código interno 4001.
- `notifyClient` entrega una vez a todos los sockets válidos del usuario;
  `notifyAdmin` y `notifyAll` recorren el registry directamente, evitando el
  `find()` que impedía fan-out múltiple.
- El heartbeat conserva ping/pong cada 30 s y ejecuta revalidación periódica.
  Web conserva la `version_sesion` capturada del JWT en el handshake. Native
  revalida sesión, revocación, expiry, usuario/cuenta, versión, plataforma y
  build. Fallos cierran el socket sin datos sensibles.
- Logout web/global, logout native-device, cambio de estado de usuario y
  cambios de sesión cierran conexiones identificables best-effort; heartbeat
  permanece como defensa adicional. Shutdown detiene timer y limpia sockets.

## Cliente native

`WebsocketService` mantiene el flujo web existente. En Android/iOS, cada
intento pide un ticket nuevo usando `HttpClient`; el interceptor existente
transporta Bearer y metadata. La URL se construye con `URL`, desde
`NATIVE_BACKEND_ORIGIN`, cambia a `wss:` y añade únicamente `ticket`.

Reconnect usa el backoff existente, nunca reutiliza ticket y sólo corre cuando
AuthService está realmente `authenticated`. `initializing`, `offline-unverified`,
`logout-pending`, `upgrade-required`, `client-error`, `unauthenticated` y
`unknown` no abren ni reintentan sockets. La generación native se captura antes
del request y se verifica antes de abrir el socket; una respuesta tardía de A
no puede conectar la sesión B. 401/426 siguen usando los handlers existentes de
AuthService; un error de red no simula logout.

La app raíz desconecta al comenzar logout o al invalidarse el estado. Resume
continúa esperando la revalidación de AuthService antes de que el efecto vuelva
a conectar. El soporte TypeScript es compartido para Android/iOS; no se creó
`front/ios` ni se afirma validación física en Xcode/iPhone. No se generó APK/AAB/IPA
ni se modificó el appId placeholder; la validación física queda para RSP-09E.

## Tests y validación

- API: tests focalizados de formato/HMAC, migración/configuración, heartbeat,
  registry, reemplazo por sesión, fan-out, cierre device y revalidación: pasan.
- API: `npm run build`: pasa.
- Front: `npm run build`: pasa.
- Suite Angular con ChromeHeadless: `290 SUCCESS`, incluyendo el flujo native
  de ticket, URL WSS, reconnect, logout-pending y protección de generation.
- La integración PostgreSQL local de RSP-09B se ejecutó con redenciones
  single-use y concurrentes: `1/1` pasa. Para aislar el fixture se aplicó en la
  base local el ledger existente hasta la migración 008; no se creó una
  migración nueva.
- `cap sync android` se ejecutó correctamente. Gradle no pudo iniciar porque el
  entorno no tiene `JAVA_HOME` ni `java` en `PATH`; no se instaló JDK/SDK ni se
  generó APK/AAB/IPA.
- No se creó migración nueva ni se modificó 000–008.
- Pendiente operativo: validación física Android/iOS y Gradle cuando exista JDK,
  SDK y hardware; corresponde a RSP-09E.
