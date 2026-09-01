# RSP-09D-R6 — Orden canónico de locks en WebSocket native

## Alcance y causa

R6 corrige exclusivamente el P2 detectado en la redención de tickets WebSocket
native. El flujo anterior reclamaba primero `ticket_ws_nativo`, unido a
`sesion_nativa`, y después ejecutaba `FOR UPDATE OF s, u`. PostgreSQL podía
adquirir así la sesión antes del usuario, mientras login, replacement, eviction
y logout-device ya serializaban en el orden contrario. La combinación permitía
el ciclo de espera `sesion_nativa → usuario` contra `usuario → sesion_nativa`.

El contrato global queda fijado en:

`usuario → sesion_nativa`

No se añadió retry de `40P01`: la solución elimina la inversión de locks.

## Redención del ticket

`consumirTicketWsNative` realiza primero una lectura no bloqueante por el HMAC
del ticket. Esa lectura sólo descubre `id_sesion_nativa` e `id_usuario`; no
autoriza, no consume el ticket y no usa `FOR UPDATE`.

La transacción corta posterior ejecuta, en orden:

1. `SELECT usuario ... FOR UPDATE`, revalidando existencia, estado activo,
   cuenta de acceso, password y `version_sesion`.
2. `SELECT sesion_nativa ... FOR UPDATE`, exigiendo la sesión y el usuario
   descubiertos, ausencia de revocación, expiry vigente, plataforma y la misma
   `version_sesion_emitida` que el usuario bloqueado.
3. `UPDATE ticket_ws_nativo ... WHERE ... RETURNING`, con HMAC exacto, sesión
   esperada, `used_at IS NULL`, expiry, plataforma y mínimo de build.

La tercera operación sigue siendo el claim atómico single-use. La lectura de
discovery nunca se usa como evidencia de autorización; todas las condiciones
mutables se revalidan bajo los locks canónicos o en el `UPDATE` atómico de la
fila ticket. Cualquier rechazo hace rollback y no deja `used_at` persistido.

No hay I/O de red, operaciones WebSocket, timers ni logging dentro de la
transacción. El registro, revalidación post-registration y cierre de sockets
permanecen fuera o después del COMMIT.

## Auditoría de locks native

| Flujo | Orden real después de R6 |
| --- | --- |
| `crearSesionNative` | lock de `usuario`; luego replacement/eviction sobre `sesion_nativa`; COMMIT; cierre WS post-COMMIT |
| replacement same-installation | heredado de `crearSesionNative`: `usuario → sesion_nativa` |
| eviction por máximo | heredado de `crearSesionNative`: `usuario → sesion_nativa`, selección determinista por `created_at, id_sesion_nativa` |
| `revocarSesionNativePorToken` / logout-device | discovery sin lock; `usuario FOR UPDATE`; `UPDATE sesion_nativa`; COMMIT; cierre WS post-COMMIT |
| logout-all | `UPDATE usuario`; no mantiene simultáneamente un lock de sesión; cierre por usuario después de la query |
| `consumirTicketWsNative` | discovery sin lock; `usuario FOR UPDATE`; `sesion_nativa FOR UPDATE`; claim atómico del ticket |
| emisión/resolución/revalidación WS | sin locks simultáneos de usuario y sesión |
| janitor | procesa tickets o sesiones por separado con `FOR UPDATE SKIP LOCKED`; no toma lock de usuario |

La búsqueda explícita de `FOR UPDATE`, `FOR NO KEY UPDATE`, updates de usuario y
sesión, `pool.connect`, `BEGIN` y `COMMIT` no encontró otra inversión
`sesion_nativa → usuario` en los caminos native de RSP-09D.

## Concurrencia PostgreSQL real

`native-ws-lock-order-postgres.local.ts` corre contra PostgreSQL 16.14 aislado
y migrado de 000 a 008. Usa una transacción barrera que bloquea la fila usuario
y observa `pg_stat_activity` para confirmar que cada operación llegó al lock
esperado antes de encolar la siguiente. El polling no decide el resultado por
tiempo y no se usan sleeps arbitrarios como sincronización. El harness impone
timeouts de query/test para detectar falta de progreso.

Interleavings cubiertos:

- redención normal y rechazo de reutilización;
- dos redenciones concurrentes del mismo ticket, exactamente un ganador;
- redemption primero y logout-device después: ambos terminan, logout revoca y
  la revalidación impide promover un socket operativo;
- logout-device primero: redemption rechaza sin consumir el ticket;
- replacement same-installation primero: A queda revocada, B vigente y el
  ticket de A no produce identidad WS;
- eviction al límite primero: se conserva el máximo, se expulsa de forma
  determinista la candidata, se cierra su WS post-COMMIT y su ticket rechaza;
- usuarios distintos: el lock de un usuario no detiene la redención del otro;
- rollback real después de que `used_at` fue modificado dentro de la
  transacción: el ticket vuelve a estar disponible y luego puede consumirse.

Resultado: `1/1 pass`, sin deadlock ni retry de deadlock.

## Validación

- PostgreSQL real R6: `1/1 pass` sobre PostgreSQL 16.14 y migraciones 000–008.
- Suite API completa: `301/301 pass`.
- TypeScript API: `npm run build`, correcto.
- Suite Angular completa: `301 SUCCESS` en ChromeHeadless.
- Frontend: build web, build production y build native-development con origin
  HTTPS de prueba, correctos; config `13/13`, contrato native `6/6` y UTF-8 OK.
- Security scan sin fixes: API 14 vulnerabilidades existentes (4 moderate,
  9 high, 1 critical); frontend 12 existentes (3 moderate, 9 high). R6 no
  modifica dependencias.
- `git diff --check`: correcto.
- No se modificó `front/`, no se creó migración, no se alteró 000–008 y no se
  generó APK/AAB/IPA.

## Archivos R6

- `api/src/services/native-auth-service.ts`
- `api/test/websocket-native-contract.test.ts`
- `api/test/native-ws-lock-order-postgres.local.ts`
- `scripts/test-rsp09d-r6-lock-order.ps1`
- `docs/CODEX_PROGRESS_ETAPA_RSP_09D_R6.md`
- `docs/CODEX_PROGRESS_ETAPA_RSP_09D.md`
