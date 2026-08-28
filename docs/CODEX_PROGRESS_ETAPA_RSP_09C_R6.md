# RSP-09C-R6 — estado bloqueado, bootstrap acotado y resume seguro

## Estado de login native

`AuthService` captura el estado previo antes de comenzar un login. Si falla el probe de Preferences u otra precondición antes de revocar la sesión anterior, un token que estaba en `offline-unverified` o `upgrade-required` conserva exactamente ese estado y nunca se promociona a `authenticated`. Sólo una sesión realmente autenticada con usuario disponible puede conservar ese estado durante un fallo previo a la revocación. Si la revocación ya fue confirmada, ningún error posterior restaura A.

Las precondiciones locales siguen ejecutándose antes de revocar; cuando existe A, la revocación explícita continúa ocurriendo antes de enviar el login B. Logout-pending, auth generation y single-flight permanecen intactos.

## Bootstrap con límite

Las lecturas de sesión web y native usan un timeout determinista de 10 segundos mediante el operador RxJS `timeout`, que cancela la suscripción HTTP en vez de dejar una request viva. Un timeout native conserva el token y termina en `offline-unverified`; la web mantiene su flujo de sesión no autenticada. Una respuesta tardía no puede aplicar efectos posteriores porque la request fue cancelada y la revalidación conserva su comprobación de generación.

## Resume y vista protegida

Una revalidación native de la generación actual que termina por red/timeout/5xx limpia el usuario visible, marca `offline-unverified` y navega inmediatamente a `/session-unavailable?reason=offline`. `navigateOnce` evita duplicados y los resultados stale se descartan antes de cambiar estado o navegar. La navegación desmonta la ruta protegida activa; 401 y 426 continúan usando sus flujos existentes.

## Validación

Se agregaron regresiones para probe fallido desde `offline-unverified` y `upgrade-required`, timeout de bootstrap web/native y fallback de navegación en resume. Suite Angular completa: `276 SUCCESS`. Se conservaron contratos web cookie/CSRF, native Bearer, secure storage, logout-pending, generación de sesión, recursos protegidos y runtime unknown. No se modificó `api/` ni Android en R6.
