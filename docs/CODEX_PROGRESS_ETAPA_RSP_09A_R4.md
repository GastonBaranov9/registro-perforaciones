# ETAPA RSP-09A-R4 — Logout, concurrencia WS y roadmap de tickets

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial auditado: `66287efb5177556453bc16ab423d1f7ac48c2f0a`
Ancestro mínimo verificado: `7193a4cb14661617389899a069f82c0ea578e6ce`

## 1. Alcance y resultado

Se corrigieron exclusivamente tres P2 documentales:

1. logout-device repetía un `UPDATE` físico sobre sesiones ya revocadas;
2. el notifier basado en `find(id_usuario)` no podía servir múltiples sockets native sin starvation/duplicación;
3. endpoint/persistencia de WS tickets y sus tests estaban divididos contradictoriamente entre RSP-09B y RSP-09D.

R4 no modifica runtime, migraciones, paquetes ni decisiones de autenticación, criptografía, storage o revalidación ya aprobadas.

## 2. Logout sin repeat-write

La mutación futura queda:

```sql
UPDATE sesion_nativa
SET revoked_at = now()
WHERE token_hash = $HASH_PRESENTADO
  AND revoked_at IS NULL
RETURNING id_sesion_nativa, id_usuario;
```

Una sesión activa produce la única escritura. Sesión ya revocada, token desconocido/fila limpiada o carrera con otro logout devuelven cero filas y la ruta responde igualmente 204, sin lookup/`UPDATE` adicional para distinguir estado. Se preservan resolver especial, anti-oracle, malformed/ausente → 401, Bearer bien formado → 204, logout-all estricto, `logout pending` y ausencia de fallback a cookie.

Dos requests simultáneos quedan serializados: A afecta una fila; B reevalúa `revoked_at IS NULL`, afecta cero; ambos responden 204. No hay segunda escritura, WAL/dead tuple de retry, 409 ni reactivación.

El cierre WS usa los IDs retornados sólo en la transición activa. Si el retry devuelve cero, no busca la sesión para repetir side effects: el primer cierre best-effort o el heartbeat/revalidación autoritativa completan la limpieza.

## 3. Hallazgo del notifier actual

`api/src/plugins/websocket.ts` mantiene un array `clientConnections`:

- `notifyClient` usa `.find(id_usuario)` y sólo envía a la primera conexión;
- `notifyAdmin` y `notifyAll` iteran el array pero vuelven a invocar `notifyClient`;
- con varias entradas del mismo usuario pueden enviar repetidamente a la primera y omitir las demás.

R4 sólo registra el hallazgo. La sustitución pertenece a RSP-09D.

## 4. Registry y política de conexiones RSP-09D

Política elegida: una conexión native activa por `id_sesion_nativa`. Varias sesiones del mismo usuario pueden coexistir y recibir:

```text
usuario U
├── web W
├── native session A / Android → socket A
└── native session B / iPhone  → socket B
```

Fuente canónica conceptual: `connectionsById: Map<connectionId, Connection>`. Los índices `connectionIdsByUser` y `connectionIdByNativeSession` almacenan IDs, no copias de conexiones.

Una conexión native entra al registry únicamente tras consumo del ticket y validación de parent/user/version/binding. Si B reconecta para la misma sesión que A, B pasa a activa y A queda reemplazada/cerrada. El callback tardío de A elimina por su `connectionId` y sólo limpia el índice de sesión si aún apunta a A, por lo que nunca elimina B.

El cleanup elimina connection canónica, set del usuario e índice de sesión condicionalmente. Nunca usa `delete(nativeSessionId)` sin comparar el connection ID actual.

## 5. Fan-out y garantías

- `notifyClient(U)`: una entrega a cada conexión única elegible de U —cada web activa y una por cada native session activa—, nunca first/`.find()`;
- `notifyAdmin`: unión de conexiones admin elegibles deduplicada por `connectionId`;
- `notifyAll`: snapshot de `connectionsById`, una entrega por conexión elegible;
- un evento con destinatario directo + admins/all usa un único dispatch/unión de selectores para no duplicar por índices o rol;
- si una revalidación native está vencida, valida antes de send; inválida/error → cerrar y no enviar.

La garantía no es exactly-once ni durable. Sólo evita starvation estructural y duplicación deliberada dentro de un dispatch, mantiene una conexión por sesión native y entrega a múltiples sesiones válidas. Ack/outbox/deduplicación durable quedan fuera de RSP-09A.

## 6. Frontera definitiva RSP-09B/RSP-09D

### RSP-09B

- futura migración canónica 008, posterior a `007_datos_propietario_padron_sitio.sql`;
- `sesion_nativa` y `ticket_ws_nativo`, FK, hashes, expiry, constraints e índices;
- login/session/logout-device/logout-all y resolver Bearer;
- `POST /api/auth/native/ws-ticket`;
- Bearer activo, raw aleatorio 256 bits devuelto una vez, HMAC-only en DB, TTL ~30 s, parent FK, rate limit y redaction;
- tests HTTP/DB de auth y emisión/persistencia.

RSP-09B no implementa handshake, redemption, single-use concurrente, registry, heartbeat o fan-out.

### RSP-09D

- ticket en handshake, HMAC y consumo atómico por hash exacto;
- single-use y parent validation al redimir;
- registry canónico, una conexión por sesión, replacement y fan-out/deduplicación;
- revalidación obligatoria/fail-closed y cierre por logout/revocation/version/expiry;
- coexistencia web/native y tests de concurrencia/delivery.

RSP-09D sólo añade una migración posterior si aparece una necesidad de datos real no prevista por 008. R4 no crea ni modifica migraciones.

## 7. Tests por etapa

RSP-09B cubre 17 contratos de login/session/resolver/logout/logout-all y emisión de ticket: raw aleatorio, HMAC-only, FK, expiry, estados inválidos, migración 008/índices y redacción. Conserva además la matriz detallada de 16 tests de logout-device, incluido retry con cero filas y dos logout concurrentes con una sola escritura.

RSP-09D cubre redemption correcta/incorrecta/expirada/usada, replay concurrente, tickets distintos, parent revocada/version vieja/inactive, expiry/logout/revalidation failure y aislamiento. Añade 14 casos de registry/fan-out: una sesión/un socket, dos sesiones reciben, reconnect reemplaza, close viejo no borra nuevo, notifier sin first/find, deduplicación client/admin/all, cleanup de índices, estados inválidos sin entrega, aislamiento y coexistencia web/native.

## 8. Archivos y validación

R4 modifica únicamente:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R4.md`.

Validación proporcional ejecutada:

- `git diff --check`: correcto; sólo se informaron avisos de normalización LF/CRLF de Git, sin errores de whitespace;
- secret scan sobre los tres documentos: sin coincidencias de claves privadas, credenciales asignadas ni patrones conocidos de tokens;
- comparación contra el HEAD inicial `66287efb5177556453bc16ab423d1f7ac48c2f0a`: exactamente los tres Markdown declarados;
- `api/src` y `front/src`: sin cambios;
- packages/locks: sin cambios y ninguna dependencia instalada;
- `api/db/migrations`: sin cambios; no se creó 008 ni se modificó 000..007;
- sin proyecto/build native nuevo ni APK/AAB/IPA/xcarchive.

No corresponde repetir suites pesadas mientras el diff sea sólo Markdown.
