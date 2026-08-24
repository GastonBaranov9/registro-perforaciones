# RSP-07F-R6 — Rate limit de login, WebSocket idle y compensación de fotos

## 1. Alcance y resultado

Se cerraron los tres P2 informados por el review global de RSP-07F-R5:

- `POST /login` se limita antes del parsing y de la validación del body, sin excluir `/login` del límite global.
- las conexiones WebSocket se mantienen con ping/pong y el frontend recupera cierres inesperados con backoff acotado;
- un fallo de `ROLLBACK` SQL ya no impide intentar restaurar las fotografías aisladas.

No se cambiaron reglas de negocio, migraciones ni contratos de datos. Tampoco se usaron secretos reales ni infraestructura externa.

## 2. Login: causa y hook temprano

El limitador global omitía todo el path `/login` y el limitador específico se llamaba dentro del handler de `POST /login`. Fastify rechaza JSON malformado, body vacío o schema inválido antes de entrar al handler, por lo que esas solicitudes no consumían ningún contador. La exclusión por path también dejaba otros métodos, incluido `GET /login`, fuera de la protección global.

La ruta `POST /login` registra ahora `fastify.rateLimitLogin` como hook `onRequest`. Esta fase corre antes del parsing y de la validación de schema. Se conservan la política de 10 intentos por minuto e IP, el 429, `Retry-After` y el mensaje genérico de credenciales.

## 3. Defensa en profundidad: límite global y específico

`/login` dejó de estar en la lista de excepciones del hook global. El contrato resultante es:

- toda request a `/login`, cualquiera sea el método, consume el límite global de API;
- `POST /login` consume además el límite específico de login;
- JSON malformado, body vacío, schema inválido, credenciales incorrectas y login válido consumen el límite específico;
- `/health`, `/ready` y `/ws` conservan sus excepciones intencionales;
- el resto de la API conserva el límite global existente.

El contador continúa siendo en memoria, se pierde al reiniciar y no se comparte entre réplicas. La limitación y la necesidad de un store compartido o ingress confiable antes de escalar horizontalmente siguen documentadas en RSP-07E.

## 4. WebSocket: causa del cierre por idle

Nginx tenía `proxy_read_timeout 300s` para `/ws`, mientras la API no emitía tráfico de protocolo y el frontend no reaccionaba al cierre. Cinco minutos sin notificaciones eran suficientes para que una conexión sana desapareciera silenciosamente.

La API usa ahora el ping/pong estándar de `ws`: cada 30 segundos marca la conexión pendiente y envía `ping`; el `pong` automático del cliente la vuelve a marcar viva. Si el siguiente ciclo no recibió `pong`, o el socket ya no está abierto, se retira y termina. El timer se inicia una vez en `onReady`, usa `unref()` y se limpia en `onClose`, donde también se cierran las conexiones restantes.

## 5. Proxy y recuperación frontend

El bloque `/ws` conserva HTTP/1.1, `Upgrade`, `Connection`, mismo origen y los headers de forwarding. Su `proxy_read_timeout` es ahora 180 segundos, seis intervalos de heartbeat: tolera jitter y períodos arbitrariamente largos sin mensajes de negocio, pero no oculta indefinidamente peers muertos.

El frontend mantiene una única conexión y, ante un cierre inesperado con usuario autenticado, reintenta a 1, 2, 5, 10 y 10 segundos. Tras cinco fallos se detiene, evitando un loop infinito ante sesión revocada. Un `open` exitoso reinicia el backoff.

`disconnect()` distingue el cierre intencional: deshabilita reconexión, cancela el timer, separa el socket actual y lo cierra con código 1000. El efecto de autenticación lo invoca al hacer logout; `ngOnDestroy` aplica el mismo cleanup. Handlers de sockets obsoletos no alteran el estado ni crean listeners o conexiones duplicadas.

## 6. Origin estricto preservado

El simulacro HTTPS detectó que el export por defecto de `origin.ts` recibía `{}` de autoload como segundo argumento y lo interpretaba como configuración runtime; `production` quedaba falso y el hook no se activaba en el registro real. Se corrigió únicamente el wrapper para cargar runtime cuando no se inyecta una configuración explícita. La allowlist, las reglas CORS/CSRF y la comparación exacta de Origin no cambiaron.

El stack aislado confirmó mutación con Origin no autorizado en 403 y handshake WebSocket same-origin en 101.

## 7. Fotos: causa y compensación independiente

Los flujos de borrar foto, borrar pozo y actualizar/reemplazar foto aislaban archivos en `.trash`, pero su `catch` esperaba `ROLLBACK` antes de restaurarlos. Si la conexión PostgreSQL ya estaba perdida, el rechazo del rollback cortaba el bloque y dejaba las fotos aisladas aunque la base conservara sus filas.

`compensarFalloTransaccionalFotos` separa ahora tres resultados:

1. conserva el error primario;
2. intenta el rollback SQL y registra de forma segura cualquier fallo;
3. intenta siempre la restauración del filesystem, aun si el rollback falló.

Si la restauración funciona se vuelve a lanzar el error primario. Si también falla, se lanza un error controlado con el primario como `cause`; `.trash` queda detectable por el reconciliador. El log sólo contiene `id_pozo`, operación, etapa y un código seguro: no incluye fotos, passwords, cookies, tokens ni detalles SQL.

El patrón común se aplica a borrar foto, borrar pozo, reemplazar foto y actualización completa del pozo. La compensación de reemplazo intenta independientemente eliminar el staging/nuevo archivo y restaurar el anterior.

## 8. COMMIT, ambigüedad y purga

La confirmación sólo se marca después de que `COMMIT` resuelve. Con commit confirmado no se restaura la foto eliminada y la purga ocurre después. Si la purga post-commit falla, la base no se revierte y el residuo permanece reconciliable en `.trash`, preservando RSP-07F.

Si la conexión cae durante `COMMIT`, el resultado distribuido no puede conocerse con certeza. El flujo conservador no purga definitivamente el aislado y ejecuta la compensación; el reconciliador continúa siendo la última barrera para contrastar DB y filesystem. No se atribuyen garantías imposibles a ese caso ambiguo.

## 9. Pruebas agregadas

Login:

- política por defecto 10/min;
- login válido y password incorrecta consumen el límite sin revelar la cuenta;
- schema inválido, body vacío y JSON malformado consumen antes de parsing/validación;
- el siguiente intento devuelve 429 con `Retry-After`;
- `GET /login` y otra ruta conservan el límite global.

WebSocket:

- ping/pong simulado durante más de cinco minutos;
- detección y terminación del cliente sin pong;
- timer idempotente y cleanup;
- contrato Nginx de upgrade y relación timeout/heartbeat;
- conexión frontend única, reconnect inesperado, backoff máximo, logout, sesión revocada y destrucción sin timers huérfanos.

Fotos:

- mutación DB fallida con rollback exitoso y fallido;
- restauración ejecutada aunque `ROLLBACK` rechace;
- fallo de restauración controlado y residuo visible al reconciliador;
- commit confirmado sin restauración;
- purga post-commit sin rollback tardío;
- borrar pozo restaura varias fotos sin tocar otro pozo;
- reemplazo y actualización completa restauran la anterior;
- seguridad de paths y traversal preservada por la suite existente.

## 10. Validación ejecutada

- API `npm run build`: OK.
- API suite completa: 237/237 tests.
- frontend `npm run check:utf8`: OK.
- frontend build de producción (`ng build`, configuración por defecto production): OK.
- frontend suite completa ChromeHeadless: 183/183 tests.
- `docker compose -f docker-compose.production.yaml config --quiet` con valores ficticios: OK.
- stack HTTPS aislado `rsp07d-https-r6b`: OK; redirect 308, health/readiness, cookies seguras, CSRF, Origin inválido 403, logout/revocación, login 429 con `Retry-After`, WebSocket 101, upload/PDF y servicios internos no publicados.
- la carga efectiva del proxy dejó Nginx healthy con la plantilla `/ws` nueva.
- el stack eliminó contenedores, redes, volúmenes y temporales al finalizar; una comprobación posterior no encontró recursos `rsp07d-https-r6*`.
- `git diff --check`: OK.
- escaneo de secretos del delta: sin material privado ni tokens reales.

Las pruebas aceleraron heartbeat y reconexión mediante ciclos/timers controlados; no esperaron cinco minutos reales ni llamaron Google.

## 11. Hallazgos cerrados y pendiente fuera de etapa

Quedan cerrados los tres P2 del review: login no evadible por parsing/schema, WebSocket resistente a idle y restauración de fotos independiente del rollback DB. La corrección del wrapper Origin fue una integración mínima necesaria para preservar el hardening exigido por RSP-07.

**P2-10 autenticación Android** permanece pendiente y fuera de RSP-07F-R6. Requiere diseñar cookies/CSRF/Origin para cliente nativo sin debilitar la aplicación web.

Commits funcionales y de pruebas:

- `9c6b2b1` — `fix(api): aplicar limite de login antes de validacion`
- `abd934b` — `fix(ws): mantener y recuperar conexiones inactivas`
- `0f3ddad` — `fix(api): restaurar fotos aunque falle rollback`
- `f22e396` — `fix(security): preservar Origin estricto en autoload`
- `c19a1c2` — `test(prod): cubrir login websocket y compensacion`

La documentación se entrega en un commit local separado. No hubo push, merge, rebase, reset, clean, despliegue externo ni cambio de rama.
