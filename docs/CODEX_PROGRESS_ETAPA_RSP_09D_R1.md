# RSP-09D-R1 — CSP WSS y cierre inmediato

## Alcance

R1 corrige exclusivamente los tres hallazgos del review de RSP-09D:

1. la CSP native ahora autoriza el origen HTTPS configurado y su equivalente
   WSS;
2. un socket native se registra inicialmente como no operativo y se activa sólo
   después de revalidar la sesión padre;
3. las sesiones revocadas durante login cierran sus sockets después del commit.

No se modificaron CORS, Origin, cookies web, CSRF, autenticación, appId,
migraciones ni configuración de navegación Capacitor.

## CSP native

`build-native.mjs` valida `NATIVE_BACKEND_ORIGIN` como origin HTTPS exacto y
deriva el origen WS mediante `URL`: `https://api.example.com` produce
`wss://api.example.com`, y un puerto explícito se conserva.

La CSP generada queda conceptualmente:

`connect-src 'self' https://api.example.com wss://api.example.com`

La derivación falla cerrado ante protocolos, paths, credenciales, query o hash
inesperados. No usa wildcard, `wss:` abierto ni hosts adicionales. El build web
continúa usando su configuración same-origin y no recibe configuración native.

## Race redemption/register

La redención atómica del ticket conserva el contrato de RSP-09D. El handler
registra el socket native con `operational=false`; ese socket no participa en
fan-out. Luego reutiliza la misma función `revalidate` de heartbeat para validar
sesión, revocación, expiry, usuario/cuenta, versión, plataforma y build.

Sólo si la conexión sigue presente en el registry se activa. Si logout ocurre
después de la redención y antes del registro, la validación posterior observa la
sesión revocada. Si logout ocurre después del registro, el cierre inmediato
retira el socket; la post-validación es idempotente y no lo reactiva. Un socket
retirado no recibe fan-out y no deja referencia fantasma.

## Revocaciones durante login

`crearSesionNative` conserva el lock de usuario y la selección determinista de
RSP-09B. Las queries que revocan por `installation_id` o por límite máximo usan
`RETURNING id_sesion_nativa` y acumulan los identificadores durante la
transacción.

Los cierres se ejecutan únicamente después de `COMMIT`. Si hay rollback no se
cierra ningún socket válido. Se cubren tanto reemplazo de la misma instalación
como eviction de la sesión activa más antigua al superar el máximo de cinco.

La autoridad de registro, activación, fan-out y cierre continúa siendo el
registry WebSocket existente; el servicio de autenticación sólo invoca su
operación de cierre post-commit y no importa rutas.

## Ticket y logging

El Bearer sólo viaja en la petición HTTP de emisión. No aparece en la URL WS.
El ticket raw sí viaja transitoriamente en `/ws?ticket=...`, como permite el
contrato aprobado: es aleatorio de 256 bits, TTL corto, single-use, vinculado a
la sesión native y almacenado sólo como HMAC/hash server-side.

Los serializers y sanitizadores de logging redactan query params `ticket` y
`ws_ticket`, tokens y headers sensibles. No se agregaron logs del ticket.

## Validación R1

- API TypeScript: OK.
- Tests API focalizados registry/post-validación: OK.
- Suite API completa: OK.
- PostgreSQL local real: `1/1`, incluyendo replacement, eviction y cierres.
- Tests CSP/configuración native: OK.
- Suite Angular y builds web/native: ejecutados según disponibilidad local.
- `cap sync android`: OK.
- Gradle: bloqueado porque el entorno no tiene `JAVA_HOME` ni `java` en `PATH`.
- No se generó APK/AAB/IPA ni se ejecutó validación física Android/iOS.
- `git diff --check`: OK.
- No se creó migración.

