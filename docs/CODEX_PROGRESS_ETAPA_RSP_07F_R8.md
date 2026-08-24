# ETAPA RSP-07F-R8 — Smoke independiente de datos de negocio

## 1. Alcance y causa del P1

El smoke de producción trataba la presencia de un pozo y una foto como precondiciones técnicas. Tanto `ops/smoke.sh` como `ops/smoke.ps1` elegían el primer pozo y exigían detalle, foto y PDF. Una lista válida `[]` hacía fallar el parseo y un pozo sin foto terminaba en un `GET /foto` obligatorio. Deploy y rollback podían rechazar así un stack sano por el contenido legítimo del dataset.

R8 modifica exclusivamente los smoke tests y sus pruebas. No siembra, altera ni elimina datos de negocio.

## 2. Salud técnica y datos de negocio

Siguen siendo obligatorios:

- frontend HTTPS, ruta SPA profunda y headers de seguridad;
- health, readiness y Swagger deshabilitado;
- login, cookies, sesión autenticada y CSRF;
- listado autenticado de pozos con HTTP 200, JSON array e identificadores numéricos;
- WebSocket 101, servicios sin puertos internos publicados, logout y revocación.

Son condicionales:

- detalle y PDF, sólo cuando existe al menos un pozo;
- foto, sólo cuando algún pozo declara una `foto_url` no vacía.

El smoke no tenía una comprobación de mapa, por lo que R8 no agregó una llamada a Google ni un nuevo contrato externo.

## 3. Semántica PASS, SKIP y FAIL

- `PASS wells-list` confirma que el endpoint y el esquema general son válidos, incluso para `[]`.
- `SKIP well-detail`, `SKIP photo` y `SKIP pdf` describen una ausencia legítima de candidato y no cambian el exit code.
- Los checks ejecutados de detalle, PDF y foto emiten `PASS`.
- Un status inesperado, JSON inválido, MIME/firma de foto inválidos o una foto referenciada que no puede leerse siguen siendo `FAIL` mediante exit distinto de cero.
- Sólo una ejecución completa emite la línea exacta `SMOKE_OK`, que continúa siendo el contrato consumido por deploy y rollback.

La salida JSON PowerShell informa `foto=false` o `pdf=false` cuando el check fue omitido, en vez de afirmar que se ejecutó.

## 4. Dataset vacío

Con cero pozos, el listado sigue siendo obligatorio y pasa. Detalle, foto y PDF se omiten explícitamente. Los checks técnicos posteriores, incluido WebSocket, aislamiento de puertos, logout y revocación, se ejecutan normalmente y el smoke termina con exit 0 y `SMOKE_OK`.

## 5. Pozos sin foto y selección de candidato

Con uno o más pozos se valida el detalle del primero y su PDF. La foto ya no se asume en el índice cero: ambos scripts buscan el primer pozo con `foto_url` no vacía. Si ninguno existe, emiten `SKIP photo` y terminan correctamente.

La matriz también incluye dos pozos donde el primero no tiene foto y el segundo sí; la foto del segundo se comprueba correctamente.

## 6. Foto válida e inconsistencia

Cuando existe una referencia de foto:

- se conserva el 401 sin sesión;
- la lectura autenticada debe devolver 200;
- el `Content-Type` debe ser JPEG o PNG;
- los bytes iniciales deben coincidir con la firma del formato.

Una referencia cuyo archivo devuelve 404 no se convierte en skip: ambos smoke tests fallan. Esto preserva la detección de inconsistencias DB → filesystem.

## 7. PDF y otros datos opcionales

El PDF conserva status 200 y firma `%PDF` cuando hay un pozo. Sin pozos se informa `SKIP pdf`. No se generan fixtures persistentes ni datos ficticios en producción.

## 8. Paridad POSIX/PowerShell

Un arnés aislado ejecuta ambos scripts completos con respuestas HTTP, cookies, WebSocket y estado Compose simulados. Cubre:

1. lista vacía: pasa con skips;
2. pozo sin foto: detalle/PDF pasan y foto se omite;
3. pozo con foto: lectura, MIME y firma pasan;
4. foto sólo en un pozo posterior: se encuentra y valida;
5. foto referenciada ausente: falla;
6. listado HTTP 500: falla;
7. listado con JSON malformado: falla.

El fixture usa credenciales ficticias, no accede a Google y elimina todos sus temporales. También verifica que deploy y rollback, POSIX y PowerShell, reconocen `SMOKE_OK` aunque la salida contenga líneas `PASS`/`SKIP`.

## 9. Deploy y rollback

No se realizó despliegue externo. La simulación controlada demuestra que un dataset vacío produce `SMOKE_OK`; los cuatro consumidores de smoke (`deploy.sh`, `rollback.sh`, `deploy.ps1` y `rollback.ps1`) mantienen su aceptación por línea/colección. Por tanto la ausencia de pozos o fotos no activa por sí sola maintenance, audit failed ni rollback adicional, y tampoco bloquea un rollback recuperado.

## 10. Validación final

- matriz R8 PowerShell/POSIX: OK en los siete escenarios;
- sintaxis `sh -n` de smoke y fixtures POSIX: OK;
- parser PowerShell de smoke y arnés R8: OK;
- API build TypeScript: OK;
- API suite completa: 244/244 tests;
- `docker compose -f docker-compose.production.yaml config --quiet` con valores fixture: OK;
- frontend no se recompiló porque R8 no modifica frontend ni un contrato consumido por él;
- escaneo del delta para formatos comunes de claves/tokens privados: sin hallazgos;
- `git diff --check`: OK;
- recursos temporales: eliminados por el arnés.

## 11. Hallazgo cerrado

Queda cerrado el P1 de smoke dependiente de pozos/fotos sembrados, con paridad POSIX/PowerShell y sin debilitar los checks técnicos ni la detección de fotos inconsistentes. RSP-07F-R1..R7 permanecen sin cambios funcionales.

## 12. Pendiente fuera de alcance

Permanece pendiente el P2 Android ya registrado en etapas anteriores; R8 no modifica Android ni frontend.
