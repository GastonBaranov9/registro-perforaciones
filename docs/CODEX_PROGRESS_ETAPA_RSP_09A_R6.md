# ETAPA RSP-09A-R6 — Límite y retención de sesiones native

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial auditado: `2294ff94bcc2b14f2fe839a95fc693b1b11d243d`

## 1. Alcance y resultado

Se corrigieron exclusivamente dos P2 documentales:

1. el máximo anunciado de cinco sesiones native por usuario no tenía enforcement transaccional;
2. `sesion_nativa` revocada/expirada carecía de retención y cleanup obligatorio.

R6 no modifica runtime, migraciones, paquetes ni los contratos R1–R5 de web/native auth, logout, minimum build, WS, registry, revalidación o secure storage.

## 2. Máximo y definición active

Default centralizado:

```text
NATIVE_MAX_ACTIVE_SESSIONS_PER_USER=5
```

Debe ser entero >= 1 y validarse fail-fast. `installation_id` no es el límite.

Una sesión consume cupo únicamente cuando:

- `revoked_at IS NULL`;
- `expires_at > now()`;
- `version_sesion_emitida = usuario.version_sesion`.

Revocadas, expiradas o de versión antigua no cuentan. Logout-all incrementa la versión y las excluye inmediatamente sin actualizar todas las filas.

## 3. Login serializado y eviction

bcrypt/credenciales se validan antes de tomar locks. Después, una única transacción corta:

1. bloquea la fila `usuario` con `FOR UPDATE` o equivalente PostgreSQL;
2. revalida activo/acceso, que la credencial validada no cambió durante bcrypt, y lee la versión actual;
3. revoca sesiones activas previas del mismo usuario+installation;
4. cuenta activas restantes sólo de ese usuario;
5. revoca las más antiguas necesarias por `created_at ASC, id_sesion_nativa ASC`;
6. inserta la nueva sesión;
7. hace commit antes de devolver el raw.

No se usa `SELECT count → INSERT` desprotegido, Redis, lock externo, trigger complejo ni `CHECK` entre filas.

Cinco activas + login nuevo deja cinco. Re-login de la misma installation reemplaza primero su sesión y no consume dos cupos. Dos logins concurrentes desde cuatro terminan <=5; seis logins concurrentes desde cero pueden completar pero terminan exactamente con cinco activas. Ninguna query puede tocar otro `id_usuario`.

## 4. Efectos de eviction

La DB es autoritativa:

- Bearer evicted deja de autenticar y el cliente vuelve a login;
- no puede emitir un ticket nuevo;
- tickets pendientes fallan por parent session inválida;
- RSP-09D cierra el socket best-effort y heartbeat lo cierra aunque se pierda el evento.

No se exige código de error especial. Puede guardarse `session_limit_eviction` como causa acotada sin exponer datos sensibles.

## 5. Retención de sesiones

Default:

```text
NATIVE_SESSION_RETENTION_DAYS=30
```

Entero >= 1 y configurable. Estado terminal:

- revocada: `terminal_at = revoked_at`;
- expirada sin revocación: `terminal_at = expires_at`;
- versión antigua sin revocación: no se inventa timestamp; espera hasta expiry + retention.

Elegibilidad conceptual:

```sql
(revoked_at IS NOT NULL AND revoked_at < cutoff)
OR
(revoked_at IS NULL AND expires_at < cutoff)
```

Con TTL ~30 días y retention ~30 días, una sesión nunca revocada puede permanecer aproximadamente 60 días desde creación. Una revocada tempranamente puede borrarse ~30 días después de `revoked_at`. Son cotas aproximadas/configurables, no garantías exactas.

La expiración/revocación/version mismatch invalida inmediatamente; physical cleanup nunca define autenticación.

## 6. Janitor, batching y FK

RSP-09B usa un único janitor:

```text
NATIVE_AUTH_JANITOR_INTERVAL_SECONDS=300
NATIVE_AUTH_JANITOR_BATCH_SIZE=500
```

- ejecuta al startup y periódicamente;
- limpia primero tickets fuera de retention;
- limpia después sesiones terminales fuera de retention;
- selecciona IDs por índice/tiempo terminal, limita el lote y elimina sólo esos IDs;
- agenda más tandas con yield si queda backlog;
- es idempotente y seguro ante procesos futuros concurrentes.

La FK `ticket_ws_nativo.id_sesion_nativa` usa `ON DELETE CASCADE`. Los tickets deberían haberse eliminado mucho antes; cascade evita que un residuo bloquee session cleanup y no sustituye el cleanup normal de tickets.

Un fallo temporal no reactiva credenciales y no bloquea inmediatamente un login válido. Se reintenta y registra sin secretos. Backlog persistente supera un umbral operativo y degrada health/readiness; R5 permite suspender emisión de tickets. No se crea otro scheduler ni infraestructura distribuida.

## 7. Índices y minimización

Migración futura 008 debe soportar:

- token hash exacto;
- usuario/estado/versión y orden de eviction;
- usuario+installation para replacement;
- `revoked_at` y `expires_at` para cleanup;
- ticket hash, FK de sesión y ticket expiry.

La composición final se confirma con queries/`EXPLAIN`, sin índices redundantes. El cupo no se expresa con un `CHECK` imposible.

No se conserva historial indefinidamente por auditoría ni se añaden IP/device fingerprints sin decisión posterior. Treinta días post-terminal es el default de minimización para soporte e incidentes recientes.

## 8. Tests y roadmap

RSP-09B añade 13 tests de límite: 0→1, cinco instalaciones, sexta/eviction, misma installation, estados que no cuentan, dos y seis logins concurrentes, orden determinista, aislamiento de usuario y credenciales/tickets evicted.

También añade 14 tests de retención: activa, revocada/expirada dentro y fuera, versión vieja no expirada, batch, idempotencia, aislamiento, cascade, orden del janitor, startup, índices y convergencia acotada.

RSP-09D prueba redemption/cierre de ticket/socket cuya parent fue evicted.

Roadmap:

- RSP-09B: migración 008, sesiones, límite transaccional, ws-ticket, minimum-build y janitor común;
- RSP-09C: cliente Capacitor, secure storage, headers y UX;
- RSP-09D: redemption, registry/fan-out y revalidación;
- RSP-09E: piloto/GPS;
- RSP-09F: resiliencia offline.

## 9. Archivos y validación

R6 modifica únicamente:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R6.md`.

Validación docs-only ejecutada:

- `git diff --check`: correcto; sólo avisos de normalización LF/CRLF, sin errores de whitespace;
- secret scan de los tres documentos: sin coincidencias de claves privadas, credenciales asignadas ni patrones conocidos de tokens;
- comparación contra HEAD inicial `2294ff94bcc2b14f2fe839a95fc693b1b11d243d`: exactamente los tres Markdown declarados;
- `api/src` y `front/src`: sin cambios;
- packages/locks: sin cambios y ninguna dependencia instalada;
- `api/db/migrations`: sin cambios; no se creó 008 ni se modificó 000..007;
- ningún APK/AAB/IPA/xcarchive ni build native productivo nuevo.

No corresponde repetir suites pesadas mientras el diff sea exclusivamente Markdown.
