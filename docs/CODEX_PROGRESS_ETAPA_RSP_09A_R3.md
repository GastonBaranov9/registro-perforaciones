# ETAPA RSP-09A-R3 — Contrato idempotente de logout native

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial: `7193a4cb14661617389899a069f82c0ea578e6ce`

## 1. Contradicción y resultado

RSP-09A prometía que `POST /api/auth/native/logout` era idempotente y que el cliente podía reintentarlo si se perdía el 204. Sin embargo, el resolver Bearer normal exige `revoked_at IS NULL`; después de que el primer logout confirma, el retry habría recibido 401 antes del handler.

R3 corrige exclusivamente esa contradicción. Logout-device ahora representa “asegurar que esta sesión ya no pueda utilizarse”, con un lookup especial no autenticante. No cambia runtime, DB, migraciones, paquetes ni las decisiones de auth/WS/storage de RSP-09A/R1/R2.

## 2. Resolver normal preservado

El resolver normal continúa rechazando token desconocido, sesión revocada/expirada, usuario inactivo/sin acceso, `version_sesion` obsoleta y binding inválido. Se usa sin relajación para:

- todos los endpoints de negocio;
- `GET /api/auth/native/session`;
- `POST /api/auth/native/ws-ticket`;
- `POST /api/auth/native/logout-all`.

Un Bearer fallido nunca cae a cookie web. Logout-all exige sesión activa porque incrementa `version_sesion` y afecta otros dispositivos y web.

## 3. Lookup exclusivo de logout-device

`POST /api/auth/native/logout` aplica rate limit y native CORS/Origin, exige un único Bearer sintácticamente válido, calcula su HMAC y busca exclusivamente `sesion_nativa.token_hash = $HASH_PRESENTADO`, incluso si esa fila ya está revocada, expirada, quedó en una versión anterior o pertenece a un usuario inactivo.

No usa `id_usuario`, email o `installation_id` aportados por el cliente. No genera `request.user`, roles ni permiso de negocio. Sólo puede ejecutar semántica equivalente a:

```sql
UPDATE sesion_nativa
SET revoked_at = COALESCE(revoked_at, now())
WHERE token_hash = $HASH_PRESENTADO
RETURNING id_sesion_nativa, id_usuario;
```

La transacción confirma antes de responder 204. Los tickets WS quedan inutilizables por parent session; el cierre del registry es best-effort posterior/complementario y nunca causa rollback de `revoked_at`.

## 4. Idempotencia y anti-oracle

Para cualquier Bearer bien formado, logout-device responde 204 vacío:

- activo: lo revoca;
- ya revocado: confirma el estado;
- expirado: confirma que es inutilizable y puede fijar `revoked_at`;
- `version_sesion` antigua: 204 sin cambiar versión;
- usuario inactivo: 204;
- hash desconocido/fila eliminada: 204 sin crear ni modificar otra fila.

Esto no autentica la sesión y no revela existencia, actividad, expiry, usuario o versión. Header ausente, esquema distinto de Bearer, Bearer vacío o formato/longitud inválidos producen 401/error auth estándar. En ningún caso hay fallback a cookie.

Dos logout concurrentes del mismo token terminan 204/204 y sólo existe la transición lógica `active → revoked`; no hay 409, reactivación ni estado intermedio.

## 5. Respuesta perdida y offline

Caso obligatorio cerrado:

```text
T0 POST logout
T1 COMMIT: revoked_at queda fijado
T2 se pierde el 204
T3 cliente conserva temporalmente el token en secure storage, estado logout pending
T4 retry con el mismo Bearer
   -> 204; la sesión sigue revocada y nunca vuelve a autenticarse
```

Al pulsar logout, el cliente bloquea inmediatamente negocio y cierra su WS local. Con 204 elimina token/pending state, limpia usuario y vuelve a login. Con timeout/sin red no supone revocación: conserva de forma segura sólo lo necesario para retry, no usa esa sesión para negocio y repite logout al recuperar conectividad. La UX/cola concreta queda para RSP-09C/RSP-09F.

## 6. Matriz resumida

| Estado Bearer | logout-device | logout-all | negocio/session/ws-ticket |
|---|---:|---:|---:|
| activo | 204 | permitido | permitido |
| revocado | 204 | 401 | 401 |
| expirado | 204 | 401 | 401 |
| versión obsoleta | 204 | 401 | 401 |
| usuario inactivo | 204 | 401 | 401 |
| bien formado desconocido | 204 | 401 | 401 |
| ausente/malformado | 401 | 401 | 401 |

La tabla presupone rate limit y CORS/Origin válidos. Web logout continúa separado con cookie, CSRF, Origin y semántica existente.

## 7. Tests futuros obligatorios RSP-09B

1. logout activo → 204 + `revoked_at` durable;
2. retry mismo token → 204;
3. dos logout concurrentes → ambos 204;
4. token revocado → logout 204;
5. token expirado conocido → logout 204;
6. `version_sesion` antigua → logout 204 sin modificarla;
7. usuario inactivo → logout 204;
8. token bien formado desconocido → 204 sin fabricar/modificar sesión;
9. header ausente → error auth esperado;
10. esquema/token malformado → error auth esperado;
11. token revocado no accede a negocio/session;
12. token revocado no pide ws-ticket;
13. token revocado/expirado/desconocido no ejecuta logout-all;
14. logout-all exige sesión activa y conserva efectos globales;
15. pérdida simulada del 204 tras commit + retry → 204;
16. logout-device de una sesión no revoca/toca otra sesión, ticket o WS.

Los tests validarán status/body uniformes, concurrencia real, no fallback a cookie, redacción, rate limit y Origin native sin modificar web logout/CSRF.

## 8. Archivos y validación

R3 modifica únicamente:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R3.md`.

Validación proporcional ejecutada:

- `git diff --check`: correcto;
- secret scan de los tres documentos: sin firmas comunes de secretos;
- comparación contra HEAD inicial: sólo los tres Markdown RSP-09A/R3;
- `api/src` y `front/src`: sin cambios;
- packages/locks: sin cambios y ninguna dependencia instalada;
- `api/db/migrations`: sin cambios;
- proyecto/build native y APK/AAB/IPA/xcarchive nuevos: ninguno.

No corresponde repetir suites pesadas mientras el diff sea sólo Markdown.
