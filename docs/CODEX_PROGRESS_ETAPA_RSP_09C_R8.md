# RSP-09C-R8 — logout durable, timeout y lifecycle fail-closed

## Logout native durable

El defecto P1 permitía terminar el logout tras fallar simultáneamente el marker de Preferences, la revocación remota y el borrado del secure storage. R8 exige persistir `logout_pending_v1` antes de limpiar usuario, bloquear negocio o avanzar la generación. Si esa escritura falla, se aborta el cierre: el token, el usuario y el estado previo quedan intactos y no se envía logout-device.

Con marker durable, un fallo de red conserva `token + pending` exclusivamente para retry. Un 204 confirma revocación remota y permite terminar localmente aunque falle el borrado del token seguro, porque ese token ya no puede autenticarse server-side. El bootstrap nunca trata `pending + token` como sesión de negocio.

## Reentrancia y timeout

Las requests auth ejecutadas dentro de `nativeMutationLock` usan `SKIP_GLOBAL_NATIVE_AUTH_HANDLER`, un `HttpContextToken` interno. El interceptor sigue adjuntando Bearer/metadata conforme al contrato, pero no invoca nuevamente handlers globales que adquieren el mismo lock. `logoutAll()` interpreta directamente 401/426; un 401 limpia la sesión inválida y libera la cola para operaciones posteriores. Logout-device y sus variantes internas también se marcan de forma explícita.

El retry de logout pending usa el timeout RxJS de autenticación de 10 segundos. El timeout cancela la suscripción, libera bootstrap y conserva token/marker en `logout-pending`; no llama `native/session` ni permite negocio. Un retry posterior puede completar la revocación.

## Lifecycle fail-closed

Si `App.addListener()` falla, se conserva la credencial segura pero se limpia el usuario visible, se establece `client-error` y se navega de forma idempotente a `/session-unavailable?reason=client-error`. La ruta protegida queda desmontada sin simular logout ni borrar el token; un arranque posterior puede volver a validar la sesión.

## Pruebas y alcance

Se agregaron pruebas para fallo de pending antes del logout, fallo remoto con pending durable, 204 con fallo de secure clear, timeout/cancelación de bootstrap, retry posterior, `logout-all` 401 sin deadlock, liberación del lock, supresión contextual del handler global y fallo del listener con retiro de UI y navegación idempotente. La suite Angular queda en `286 SUCCESS`.

No se modificó `api/`, Android, WebSocket, web cookie/CSRF ni la protección exact-origin del Bearer.
