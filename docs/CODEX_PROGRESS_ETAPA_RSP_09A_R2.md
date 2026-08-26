# ETAPA RSP-09A-R2 — Consumo WS ticket y revalidación de sesión

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial: `976e802d384e05338e0871e8ef7f7261f529c26c`

## 1. Alcance y resultado

Se corrigieron exclusivamente los dos P2 documentales detectados después de RSP-09A-R1:

1. el consumo conceptual de WS tickets podía afectar todas las filas válidas porque omitía filtrar el hash presentado;
2. la sesión native padre se validaba al emitir el ticket, pero la revalidación al redimir/usar el socket no quedaba obligatoria.

R2 no cambia runtime, DB, migraciones, dependencias ni decisiones base. Web mantiene cookie HttpOnly + CSRF + `PUBLIC_ORIGIN`; native mantiene Bearer opaco, sesión única, 256 bits, HMAC server-side, TTL recomendado 30 días y ticket single-use de 256 bits/~30 s configurables para Android+iOS.

## 2. Causa y predicate corregido

El diseño anterior mostraba:

```sql
UPDATE ticket_ws_nativo
SET used_at = now()
WHERE used_at IS NULL
  AND expires_at > now()
RETURNING ...;
```

Sin `ticket_hash`, una redención podía marcar usados todos los tickets vigentes y devolver sesiones ambiguas. El contrato corregido deriva el HMAC desde el único raw presentado y exige:

```sql
WHERE ticket_hash = $HASH_PRESENTADO
  AND used_at IS NULL
  AND expires_at > now()
  AND parent_session_is_valid
```

`ticket_hash` es único; la operación devuelve como máximo una fila. Cero filas siempre rechaza el handshake y nunca provoca búsqueda o consumo de otro ticket. El raw sólo existe en cliente/request, no se persiste ni registra.

## 3. Atomicidad y concurrencia

Single-use y consumo se resuelven en una única sentencia `UPDATE ... RETURNING` con join/CTE de validación, o en una transacción con locking equivalente sobre ticket/sesión/usuario. Se prohíbe `SELECT` seguido de `UPDATE` cuando dos handshakes puedan observar el mismo estado libre.

- mismo ticket presentado simultáneamente: uno consume/continúa y uno recibe rechazo;
- dos tickets distintos simultáneos: cada predicate sólo alcanza su hash; ninguno consume al otro;
- fallo de cualquier condición: cero sockets autenticados para esa redención.

## 4. Vínculo y validación de sesión padre

Cada `ticket_ws_nativo` referencia por FK exactamente un `id_sesion_nativa`. Al redimir y antes de registrar socket/subscripciones se exige:

- ticket exacto, no usado y no expirado;
- sesión native existente, no revocada y no expirada;
- usuario existente, activo y con cuenta de acceso;
- `version_sesion_emitida` igual a `usuario.version_sesion`;
- roles/permisos actuales por el mecanismo compartido;
- binding de installation/session coherente.

Un ticket no congela el estado válido observado al emitirse. Si entre emisión y redención ocurre logout de dispositivo/global, desactivación, cambio de versión o expiración natural, el handshake se rechaza aunque el ticket aún esté dentro de sus ~30 s.

## 5. Socket establecido y revalidación

Cada socket native queda asociado a `id_sesion_nativa` e `id_usuario`. El heartbeat server existente, aproximadamente cada 30 s, debe revalidar obligatoriamente contra PostgreSQL la sesión, usuario, expiry, `revoked_at` y `version_sesion`. El intervalo es configurable pero su recomendación inicial no supera ese ciclo de 30 s.

Si una sesión expira naturalmente, el siguiente ciclo cierra/desregistra el socket sin esperar otra request HTTP. Si una validación ya venció al despachar un evento, se revalida antes de enviarlo. No se agrega otro timer de alta frecuencia.

Logout de dispositivo cierra best-effort los sockets del `id_sesion_nativa`; logout global/desactivación/cambio de versión hace lo mismo por usuario. Tickets pendientes no necesitan borrarse: la sesión padre inválida impide su redención. El cierre dirigido reduce latencia, pero no reemplaza el heartbeat porque el evento puede perderse, originarse en DB/otra instancia o la sesión puede expirar sola.

El WebSocket web sigue separado: cookie/session actual, `PUBLIC_ORIGIN` exacto y heartbeat existente. Su ventana histórica de falta de revalidación tras logout continúa pendiente para RSP-09D; R2 no la corrige en runtime.

## 6. Fail-safe, multi-instancia y costo

Si DB/error interno impide comprobar el estado durante la revalidación, se aplica fail-closed: retirar/cerrar socket y no entregar datos autenticados. El cliente pide un ticket nuevo y reconecta normalmente cuando el backend vuelve.

Un registry sólo puede cerrar directamente sockets de su instancia local. La seguridad depende de revalidación periódica contra el estado autoritativo, por lo que sigue siendo correcta con más instancias aun sin evento compartido. No se introduce Redis/pub-sub en esta etapa.

Para pocos usuarios/conexiones, una consulta indexada cada heartbeat es aceptable. RSP-09B/09D deberán asegurar índices para lookup de token/session id, `id_usuario`, FK de ticket y `ticket_hash`; no se crea migración ahora.

## 7. Tests futuros obligatorios

Ticket/redemption:

1. correcto: éxito;
2. incorrecto: rechazo;
3. expirado: rechazo;
4. usado: rechazo;
5. mismo ticket concurrente: sólo uno gana;
6. dos tickets distintos concurrentes: uno no consume al otro;
7. sesión revocada: rechazo;
8. `version_sesion` vieja: rechazo;
9. usuario inactivo/sin acceso: rechazo.

Socket establecido:

10. sesión expira: socket cierra;
11. logout dispositivo: socket cierra y tickets pendientes no redimen;
12. logout global: sockets/tickets de versiones anteriores quedan inválidos;
13. usuario desactivado: socket cierra;
14. `version_sesion` cambia: socket cierra;
15. error transitorio de DB: cierre fail-closed y reconexión normal posterior;
16. otro usuario/sesión/ticket no se consume ni cierra.

Las carreras deben probarse con concurrencia coordinada real. El test de revalidación también debe funcionar cuando se omite deliberadamente el evento de cierre local.

## 8. Archivos y validación

R2 modifica únicamente:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R2.md`.

Validación proporcional ejecutada:

- `git diff --check`: correcto;
- secret scan de los tres documentos: sin firmas comunes de secretos;
- comparación contra HEAD inicial: sólo los tres Markdown RSP-09A/R2;
- `api/src` y `front/src`: sin cambios;
- manifests/locks: sin cambios y ninguna dependencia instalada;
- `api/db/migrations`: sin cambios;
- proyecto/build native y APK/AAB/IPA/xcarchive nuevos: ninguno.

No corresponde repetir suites pesadas mientras el diff sea sólo Markdown.
