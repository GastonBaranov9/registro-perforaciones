# ETAPA RSP-07E — Hardening y operabilidad pre-piloto

Fecha de cierre: 2026-08-13. Rama auditada: `feature/rsp-07-produccion`.

## 1. P2 abordados

Se relevaron los IDs exactos de RSP-07A y el estado posterior de RSP-07B/C/D.

| ID | Hallazgo histÃ³rico | Resultado RSP-07E |
|---|---|---|
| P2-01 | Sin rate limiting | Resuelto para el piloto de una instancia: lÃ­mite general moderado y lÃ­mites especÃ­ficos de login, Maps, PDF y upload. |
| P2-02 | Headers HTTP incompletos | Resuelto: CSP probada con el build, Permissions-Policy, framing, nosniff, Referrer-Policy y contrato HSTS booleano. |
| P2-03 | `/docs` pÃºblico | Resuelto: Swagger/OpenAPI UI no se registra en producciÃ³n. |
| P2-04 | Logout no revoca JWT copiado | Resuelto: logout incrementa `version_sesion` y revoca de inmediato todas las sesiones del usuario. |
| P2-05 | Logging sin normalizar/redactar/rotar | Resuelto para operaciÃ³n local: JSON Pino/Fastify, request ID, ruta normalizada, redacciÃ³n y rotaciÃ³n Docker. |
| P2-06 | Esperas PostgreSQL ilimitadas y sin cierre | Resuelto: pool acotado, timeouts explÃ­citos y cierre ante SIGTERM/SIGINT. |
| P2-07 | PDF sin control de concurrencia/recursos | Resuelto para una instancia: rate limit, semÃ¡foro, cola finita, timeout de espera y rechazo 503. |

No se reescribe la evidencia histÃ³rica de RSP-07A.

## 2. Rate limits y justificaciÃ³n

Los lÃ­mites son ventanas fijas en memoria, suficientes para el piloto de una sola instancia y sin introducir Redis:

| Clase | Default | Clave | Conducta |
|---|---:|---|---|
| API normal | 600/min | IP confiable del proxy | Piso de protecciÃ³n amplio. Excluye `/health`, `/ready`, `/login` y `/ws`. |
| Login | 10/min | IP | 429 y `Retry-After`; no bloquea permanentemente una cuenta ni revela si el email existe. |
| Maps preview/persistido | 30/min | usuario + IP | Se evalÃºa despuÃ©s de autorizaciÃ³n y antes de Google. |
| PDF | 10/5 min | usuario + IP | Se evalÃºa despuÃ©s de autorizaciÃ³n y antes de adquirir capacidad/generar. |
| Upload multipart | 30/5 min | usuario + IP | Permite lotes operativos normales; conserva 5.000.000 bytes y 413 multipart. |

Variables: `RATE_LIMIT_API_MAX`, `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_MAP_MAX`, `RATE_LIMIT_PDF_MAX` y `RATE_LIMIT_UPLOAD_MAX`. Los valores se validan al inicio. Los contadores se pierden al reiniciar y no se comparten entre rÃ©plicas; antes de escalar horizontalmente se requiere un store compartido o rate limit en un ingress confiable.

La prueba focalizada verificÃ³ que el request 31 de Maps devuelve 429 y que el spy del proveedor permanece en 30 llamadas: un rechazo no consume cuota Google.

## 3. Headers

Nginx es la capa Ãºnica de headers pÃºblicos:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`;
- `X-Frame-Options: DENY`;
- CSP con `frame-ancestors 'none'`;
- Permissions-Policy explÃ­cita;
- HSTS controlado por `HSTS_ENABLED`.

Los `add_header ... always` cubren SPA, API y errores HTTPS del proxy. Las respuestas API, salvo health/readiness, reciben `Cache-Control: private, no-store` si la ruta no definiÃ³ una polÃ­tica mÃ¡s especÃ­fica; Maps conserva su `private, no-store`.

## 4. CSP

PolÃ­tica efectiva:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

No se habilitan `unsafe-eval`, scripts inline, wildcards ni hosts Google: Maps continÃºa backend-only. `style-src 'unsafe-inline'` es la excepciÃ³n mÃ­nima necesaria para estilos dinÃ¡micos de Ionic. El build Angular producÃ­a un handler `onload` inline al diferir el CSS crÃ­tico; `inlineCritical=false` conserva minificaciÃ³n/hashing pero emite un `<link rel="stylesheet">` normal, por lo que `script-src 'self'` sigue cerrado.

## 5. Permissions-Policy

Se permite `geolocation=(self)` y `fullscreen=(self)`. Se bloquean `camera`, `microphone`, `payment` y `usb`, que la aplicaciÃ³n web actual no utiliza. La foto web usa selector de archivo; una futura aplicaciÃ³n Android deberÃ¡ declarar permisos nativos y no justifica abrir capacidades web ahora.

## 6. HSTS

`HSTS_ENABLED` solo acepta `true`/`false`; la API rechaza activarlo fuera de `NODE_ENV=production` y el entrypoint del proxy tambiÃ©n falla ante cualquier otro valor. Con `false`, Nginx no emite el header. Con `true`, emite:

```text
Strict-Transport-Security: max-age=31536000
```

No se usan `includeSubDomains` ni `preload`. Debe cambiarse a `true` solo despuÃ©s de instalar un certificado pÃºblico renovable, verificar HTTPS/redirect y confirmar que el dominio podrÃ¡ mantenerse durante el `max-age`. La prueba autofirmada conserva `false`.

## 7. Swagger/docs

`ENABLE_API_DOCS` vale `true` por defecto en development y `false` en production. ProducciÃ³n rechaza explÃ­citamente `ENABLE_API_DOCS=true`, por lo que ni Swagger UI ni su contrato JSON se registran. El ensayo HTTPS comprobÃ³ `/api/docs => 404`.

## 8. Logout y revocaciÃ³n

`POST /logout` sigue requiriendo cookie vÃ¡lida, Origin permitido y CSRF. Ejecuta un `UPDATE` parametrizado que incrementa `version_sesion` para el usuario activo y luego elimina `rsp_session` y `rsp_csrf`.

DecisiÃ³n del piloto: logout revoca todas las sesiones del usuario. Es coherente con el mecanismo ya utilizado para password, roles e inactivaciÃ³n, evita una blacklist nueva y hace que una copia anterior del JWT falle en el siguiente request. El test HTTPS copiÃ³ el cookie jar antes de logout y obtuvo 401 al reutilizarlo. No se debilita la revocaciÃ³n administrativa.

## 9. Logging y redaction

Fastify/Pino escribe JSON a stdout/stderr con `timestamp`, nivel, request ID, mÃ©todo, ruta normalizada, status y duraciÃ³n. Se deshabilitÃ³ el request logging automÃ¡tico para evitar URL/query y bodies crudos. Nginx emite JSON con `$uri` (sin query string), `$request_id`, status, duraciÃ³n y upstream; sobrescribe `X-Request-Id` y Fastify usa ese ID del Ãºnico proxy confiable.

Se redactan Authorization, Cookie, Set-Cookie, CSRF, password, fotos/base64. El serializador de errores conserva tipo/mensaje/stack del servidor pero sanea `key=`, tokens de query y passwords de URLs PostgreSQL. Se retiraron `console.log/error` del runtime HTTP tocado. El test registra marcadores controlados para password, cookies, token, CSRF, base64 y key Google y confirma que ninguno aparece.

Compose aplica `json-file` con `max-size=10m` y `max-file=3` a PostgreSQL, API, frontend y proxy. No se escriben logs persistentes dentro de la imagen.

## 10. PostgreSQL pool y timeouts

Defaults de una API en servidor piloto 2 vCPU/4 GiB:

| Variable | Default |
|---|---:|
| `PG_POOL_MAX` | 10 conexiones |
| `PG_CONNECTION_TIMEOUT_MS` | 5.000 ms |
| `PG_STATEMENT_TIMEOUT_MS` | 30.000 ms |
| `PG_IDLE_TRANSACTION_TIMEOUT_MS` | 15.000 ms |
| `PG_QUERY_TIMEOUT_MS` | 35.000 ms |
| idle del pool | 10.000 ms |

Se exige que query timeout no sea menor al statement timeout. SIGTERM/SIGINT deja de aceptar trÃ¡fico, cierra Fastify y termina el pool. Migrate, backup y restore siguen siendo procesos one-shot con perfiles operativos propios; estos defaults no se fuerzan sobre `pg_dump` ni sobre migraciones.

## 11. PDF concurrency y queue

Defaults: `PDF_MAX_CONCURRENT=2`, `PDF_MAX_QUEUE=4`, `PDF_QUEUE_TIMEOUT_MS=15000`.

La autorizaciÃ³n y el rate limit ocurren antes del trabajo costoso. Si hay capacidad, un semÃ¡foro FIFO concede un slot. La cola es finita; saturaciÃ³n o timeout devuelve 503 con `Retry-After: 5`. Un `finally` libera siempre el slot, incluso ante error de DB, foto, mapa o generaciÃ³n. Los eventos `pdf_started`, `pdf_capacity_rejected` y `pdf_completed` dejan ocupaciÃ³n/cola sin datos del informe.

Los recursos individuales tambiÃ©n siguen acotados por foto de 5 MB, lÃ­mite del mapa, timeout de proveedor, timeouts DB y timeout del proxy. No se agregÃ³ un worker/Redis: el semÃ¡foro es local a cada instancia.

## 12. Pruebas de saturaciÃ³n

- test unitario: mÃ¡ximo activo 1, cola 1, tercera adquisiciÃ³n rechazada, transferencia FIFO y retorno a cero;
- test de error: el slot se libera en el camino fallido;
- stack HTTPS aislado: 12 descargas PDF concurrentes con `maxConcurrent=1`, `maxQueue=0`, se observa 503 y `/api/health` continÃºa en 200;
- no hubo llamadas Google reales; el pozo del fixture no tiene coordenadas y Maps usa mock/estado controlado.

## 13. Config nueva

`.env.example` agrupa variables de hardening sin valores secretos funcionales. AdemÃ¡s de rate/PG/PDF incorpora `ENABLE_API_DOCS`, `LOG_LEVEL` y `HSTS_ENABLED`. Los enteros, rangos, booleanos y combinaciones imposibles se validan fail-fast sin imprimir valores sensibles.

## 14. Regresiones RSP-07B/C/D

El stack aislado ejecutÃ³ fresh migration 000..006, bootstrap admin one-shot, frontend/API/proxy/PostgreSQL, login, CSRF correcto/incorrecto, Origin incorrecto, WebSocket, upload exacto de 5.000.000 bytes, rechazo de 5.000.001, foto protegida, PDF, estado Maps sin key, health/readiness, SPA y 404 API. API/frontend/PostgreSQL continuaron sin puertos al host; solo proxy publicÃ³ HTTP/HTTPS. No fue necesario repetir disaster recovery porque el formato de datos, migrador y herramientas de backup/restore no cambiaron.

El proyecto Docker, redes, volÃºmenes, certificado y archivos temporales del ensayo fueron eliminados exclusivamente por su project name aislado.

## 15. P2 restantes

| ID | Estado |
|---|---|
| P2-08 | Abierto: `DELETE pozo` todavÃ­a no coordina el archivo y no existe reconciliador DB/volumen. Revalidado contra el cÃ³digo real y diferido a RSP-07F para incorporarlo al cierre operativo, fuera de los ocho objetivos expresos de 07E. |
| P2-09 | Diferido a RSP-07F: deploy por digest, smoke y rollback integral sin `down`. |
| P2-10 | Diferido a la etapa Android: cookie/CSRF/origin nativa, sin aflojar la web. |

## 16. QuÃ© pasa a RSP-07F

- automatizar `backup -> imagen por digest -> migrate one-shot -> actualizaciÃ³n -> health/smoke -> rollback`;
- resolver P2-08 y ejecutar su prueba de reconciliaciÃ³n;
- ensayar fallos de migraciÃ³n, health y rollback usando las seÃ±ales/logs estructurados de esta etapa;
- elegir y preparar el host sin desplegar desde RSP-07E.

## 17. QuÃ© pasa a Android

P2-10 permanece intacto. No se agregaron origins nativos, no se modificÃ³ SameSite, no se expuso bearer auth y no se debilitÃ³ CSRF/CORS. El rate limit en memoria y la misma API podrÃ¡n reutilizarse, pero el contrato de autenticaciÃ³n nativo requiere un spike separado.

## 18. Riesgos residuales

- rate limits y semÃ¡foro PDF son por proceso; varias rÃ©plicas multiplican capacidad efectiva;
- logout revoca todas las sesiones, no una sesiÃ³n individual;
- `style-src 'unsafe-inline'` permanece por Ionic; scripts continÃºan estrictos;
- HSTS queda intencionalmente apagado hasta certificado pÃºblico renovable;
- el tamaÃ±o/tiempo de una generaciÃ³n individual depende ademÃ¡s de los lÃ­mites de entrada y proxy; no existe cancelaciÃ³n cooperativa interna de `pdf-lib`;
- P2-08, deploy/rollback y Android siguen abiertos segÃºn la tabla anterior.

## Evidencia de validaciÃ³n

- API build: correcto.
- API suite final: 208/208.
- Frontend production build: correcto; `index.html` no contiene handler `onload` ni `<style>` inline y usa stylesheet same-origin.
- Frontend suite: 178/178 en ChromeHeadless (warnings preexistentes de Ionicons sin fallos).
- Docker images: API y frontend construidas correctamente.
- `docker compose config --quiet`: correcto con placeholders controlados.
- HTTPS aislado: redirect 308, canonical host 421, SPA, health/ready, cookies Secure/HttpOnly, CSRF/Origin, Swagger 404, logout 401 sobre token copiado, login 429/Retry-After, WebSocket 101, upload 5 MB/413, foto protegida, PDF y puertos internos.
- bÃºsqueda frontend: sin localhost, key Google ni secreto.
- no se realizaron requests reales a Google.
