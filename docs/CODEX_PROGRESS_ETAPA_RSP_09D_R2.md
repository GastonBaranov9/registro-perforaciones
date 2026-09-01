# RSP-09D-R2 — Rate limit WS y separación de Origins

## Alcance

R2 corrige exclusivamente los dos hallazgos del review:

1. floods de redención native limitados antes de cualquier acceso PostgreSQL;
2. separación estricta entre WebSocket web por cookie y WebSocket native por
   ticket.

No se modificaron CORS, CSRF, cookies, CSP, migraciones ni el cliente native.

## Handshake y rate limit

La presencia del parámetro `ticket` clasifica el handshake antes de cualquier
consulta:

- sin `ticket`: branch web, Origin exacto `PUBLIC_ORIGIN`, autenticación por
  cookie `rsp_session`;
- con `ticket`: branch native, Origin exacto Android/iOS, formato `rspw1_`,
  limiter por IP y luego redención atómica.

El limiter native usa `MemoryRateLimiter`, reutiliza
`RATE_LIMIT_NATIVE_WS_TICKET_MAX` y aplica una ventana fija de 60 segundos,
con default de 30 intentos por `request.ip`. Fastify calcula esa IP usando su
configuración `trustProxy` existente; no se leen manualmente
`X-Forwarded-For` ni `X-Real-IP`.

La secuencia native es formato barato → limiter → `pool.connect()`/`BEGIN` →
redención. Un exceso devuelve 429 con `Retry-After`, no revela si el ticket
existe y no toca PostgreSQL. Los tickets malformados se rechazan incluso antes
del limiter y tampoco llegan a DB. El bucket se recupera al terminar la
ventana; cada IP mantiene su bucket independiente. El branch web no usa este
limiter.

## Separación de autenticación

La validación global de Origin y la defensa específica de `/ws` usan el mismo
helper exacto. La matriz es:

| Query | Origin | Auth |
|---|---|---|
| sin `ticket` | `PUBLIC_ORIGIN` | cookie web |
| con `ticket` | `https://localhost` | ticket native |
| con `ticket` | `capacitor://localhost` | ticket native |

Se rechazan native Origin sin ticket, `PUBLIC_ORIGIN` con ticket, Origins
externos, ausencia de Origin en producción y tickets inválidos. Un ticket
inválido, usado o expirado nunca cae a cookie web. Una cookie presente no
convierte un handshake native en web; la autenticación sigue siendo la del
branch clasificado por ticket.

El ticket raw continúa viajando transitoriamente sólo en `/ws?ticket=...`.
Bearer nunca aparece en la URL. Los access/error logs no serializan la URL raw
y el sanitizador existente redacta `ticket`, `ws_ticket` y tokens.

## Regresiones preservadas

Se conserva el WebSocket web por cookie, `PUBLIC_ORIGIN`, CSRF, heartbeat,
reconnect, fan-out y toda la implementación native de RSP-09D/R1: HMAC,
single-use atómico, TTL, Origins native, registry, post-validation,
replacement/eviction post-commit, revalidación y generation frontend.

## Validación

- Tests focalizados R2: pasan `13/13`.
- Suite API completa: `294/294`.
- PostgreSQL real con concurrencia/single-use y cierres R1: `1/1`.
- Tests de configuración native/CSP: `13/13`.
- Builds web y production: OK.
- `cap sync android`: OK.
- Gradle bloqueado por ausencia de `JAVA_HOME` y `java` en `PATH`.
- No se generaron APK/AAB/IPA.
- No se creó migración.

