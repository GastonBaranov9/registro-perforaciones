# RSP-09D-R5 — Sincronizar auth web ante cierre 4003

## Alcance

R5 corrige exclusivamente el reconnect loop del WebSocket web después de un
cierre de autenticación `4003`. No modifica API, cookies HttpOnly, CSRF,
SameSite, Origins ni el flujo native de tickets.

## Semántica de cierres

El servidor usa `4003` para una conexión no autorizada o que dejó de ser
válida: JWT web expirado, sesión/version revocada, usuario/cuenta inválida o
fallo equivalente de autenticación. El cliente web no lo trata como caída
recuperable.

`4001` continúa siendo exclusivo del replacement de un socket native de la
misma sesión y conserva su comportamiento terminal por auth generation. Los
cierres web recuperables, como una caída de red, mantienen el reconnect con
backoff existente.

## Sincronización web

Al recibir `4003`, WebsocketService confirma primero que el callback pertenece
al socket rastreado, cancela timers, deshabilita reconnect y marca terminal la
generación web actual. Luego solicita una única revalidación a través de
`AuthService.synchronizeWebSession`, que reutiliza `AuthService.getUser` y la
cookie web existente.

Si la sesión es inválida, AuthService limpia MainStore, cambia el estado a
`unauthenticated` y navega una sola vez a `/login`. JavaScript nunca intenta
leer o borrar la cookie HttpOnly. La aplicación queda sin WS ni retry mientras
esa generación siga inválida.

Aunque la revalidación confirme que la cookie sigue siendo válida, el cierre
4003 permanece terminal para esa generación: no se vuelve a abrir el socket ni
se programa un timer. Sólo un login web nuevo incrementa la generación y
vuelve a habilitar la conexión. Por ello una respuesta stale de la
revalidación anterior no puede limpiar, navegar ni bloquear la sesión nueva.

## Tests y validación

- WebSocket web focalizado: `13 SUCCESS`; cubre 4003 inválido, 4003 terminal
  aun con revalidación válida, ausencia de timer/reconnect, login nuevo y
  cierre recuperable.
- `4003` stale del socket A y de su revalidación después de login nuevo: no
  destruye el socket ni la sesión nueva.
- Cierre web recuperable: conserva backoff/reconnect.
- Native WebSocket: `10 SUCCESS`; `4001`, tickets, generation, epoch y
  reconnect native permanecen sin cambios funcionales.
- Suite Angular completa con ChromeHeadless: `301 SUCCESS`.
- Config/CSP: `13/13`; contratos native: `6/6`; UTF-8 y `git diff --check`:
  OK.
- Build web, web production y native-development con origin HTTPS de prueba:
  OK. API sin cambios; build TypeScript y suite API: `301 pass`.
- Security scan sin aplicar fixes: frontend reporta 12 vulnerabilidades (9
  high, 3 moderate) y API 14 (9 high, 4 moderate, 1 critical), todas en
  dependencias existentes y fuera del alcance R5.
- No se crearon migraciones ni artefactos de release.
