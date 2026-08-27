# Progreso ETAPA RSP-09B-R1 — serialización de logout y límite native

## Hallazgo y causa

RSP-09B serializaba login, replacement y eviction mediante un row lock sobre `usuario`, pero logout-device actualizaba directamente `sesion_nativa`. Si logout confirmaba después del `count(*)` del login y antes de su eviction, el login conservaba un cálculo obsoleto y podía revocar un segundo dispositivo innecesariamente.

El límite máximo seguía cumpliéndose, pero el conjunto final no equivalía al orden lógico esperado: un logout explícito podía terminar acompañado por una eviction basada en una sesión que ya no estaba activa.

## Flujo corregido

Para un Bearer sintácticamente válido, logout-device ahora:

1. calcula el mismo HMAC-SHA-256 de sesión;
2. hace un lookup no bloqueante de `id_usuario` por `token_hash`;
3. si el hash es desconocido, termina sin mutación;
4. para una fila conocida, abre una transacción;
5. adquiere `usuario FOR UPDATE`;
6. ejecuta el único `UPDATE` mutante sobre ese hash y usuario, conservando `revoked_at IS NULL`;
7. confirma y mantiene la respuesta HTTP `204` independientemente de actualizar cero o una fila.

El lookup inicial no autentica: no inspecciona revocación, expiry, `version_sesion`, estado del usuario ni cuenta de acceso. Si el janitor/cascade elimina la sesión o el usuario entre lookup y lock/update, el resultado es cero filas y logout continúa siendo éxito anti-oracle.

## Orden de locks y deadlocks

El orden compartido es:

`usuario → sesion_nativa`

Login ya bloqueaba usuario antes de replacement/count/eviction/inserción. Logout-device no bloquea la sesión en su lookup inicial y sólo intenta actualizarla después de obtener el lock de usuario. No se introdujo el orden inverso `sesión → usuario` ni advisory locks nuevos.

Logout-all incrementa `usuario.version_sesion` mediante `UPDATE`, que adquiere el mismo row lock y no bloquea sesiones después. La edición/desactivación de cuentas y el cambio directo de roles bloquean primero usuario; no existe inversión nueva con logout-device. Las operaciones globales de definición/eliminación de rol mantienen su orden previo `rol → usuarios`, pero logout no toma locks de rol, por lo que este fix no agrega un ciclo.

## Interleavings seriales

Si logout obtiene primero el lock con cinco sesiones, revoca S5 y confirma; login ve cuatro, no hace eviction e inserta S6. Quedan exactamente S1..S4 y S6 activas.

Si login obtiene primero el lock, ve cinco, ejecuta la eviction legítima e inserta S6. Logout corre después: si su objetivo sigue activo lo revoca y quedan cuatro; si ya fue la sesión evicted, actualiza cero filas y quedan cinco. Ambos resultados corresponden al orden serial real y nunca superan el máximo.

Login de la misma `installation_id` y logout de su token anterior también comparten el lock. En cualquiera de los órdenes queda una sola sesión activa para esa instalación y no se revoca otra instalación por un count obsoleto.

## Anti-oracle e idempotencia

Se preservan los contratos RSP-09B:

- activo conocido: una única escritura y `204`;
- retry o ya revocado: `UPDATE` cero filas, sin rewrite de `revoked_at`, y `204`;
- expirado, versión vieja o usuario inactivo: `204`;
- token desconocido bien formado: `204` sin revelar existencia;
- Authorization ausente o malformado: error auth estándar en la ruta.

No se usa `COALESCE`, no se modifica expiry y no se introduce write amplification.

## Pruebas PostgreSQL reales

`native-auth-logout-race-postgres.local.ts` usa una transacción barrera sobre la fila usuario y confirma mediante `pg_stat_activity` qué operación está esperando el row lock antes de encolar la segunda. No usa sleeps para decidir el orden.

La cobertura incluye:

- logout-first al cap: cinco activas finales, sin eviction adicional y las otras cuatro autenticables;
- login-first al cap: eviction determinista seguida por logout explícito y cuatro activas coherentes;
- mismo token concurrente: una escritura y resultados `true/false` internos, ambos `204` en HTTP;
- retry sin cambio de timestamp y token desconocido;
- dos sesiones distintas del mismo usuario: cada logout revoca sólo su token;
- usuario A bloqueado no impide logout de usuario B;
- login/logout de la misma instalación al cap: una sola sesión de esa instalación, las otras cuatro intactas y máximo no excedido.

El harness RSP-09B continúa validando fresh `000..008`, upgrade `007→008`, rerun no-op y checksums históricos, y ahora ejecuta también esta suite R1.

## Alcance preservado

No se creó migración `009` ni se modificó `000..008`. No cambiaron formato/HMAC, resolver Bearer, cookie/CSRF/CORS/Origin, builds mínimos, endpoints, política de eviction, logout-all, tickets, janitor, retención, readiness, logging, frontend ni WebSocket runtime.
