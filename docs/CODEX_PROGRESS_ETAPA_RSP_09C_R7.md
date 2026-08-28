# RSP-09C-R7 — serialización de mutaciones de autenticación native

## Causa común

Logout pending e invalidación por 401 podían continuar después de que un login instalara una sesión nueva. Sus limpiezas asíncronas podían borrar el token B, modificar `MainStore` o dejar `logout-pending` sobre la sesión equivocada.

## Coordinador

`AuthService` incorpora una cola/mutex `withNativeAuthMutationLock`. La cola se recupera ante rejection y sólo cubre mutaciones sensibles: login native, logout-device y retry pending, logout-all e invalidación 401. Los helpers llamados desde una operación protegida son variantes `Locked` y no reacquieren el lock, evitando deadlocks. Los requests normales, imágenes, PDF y la lectura HTTP de session no se serializan.

La invalidación 401 conserva la generación de la request y la comprueba nuevamente dentro del lock. Si login B ganó primero, una invalidación de A queda stale y es no-op. Si A ganó primero, login B espera a que termine toda la limpieza. Retry pending conserva la misma exclusión, por lo que una finalización de A nunca puede borrar o degradar B.

## Estados y validación

`logout-pending + token` sigue reservado exclusivamente para revocación; `offline-unverified` y `upgrade-required` permanecen bloqueados. Login duplicate queda single-flight y no crea B/C concurrentes. Se agregaron pruebas deterministas para pending logout/login, 401 cleanup/login, invalidación stale, preservación de secure storage y usuario, además de las regresiones de generación existentes.

La suite Angular final es `279 SUCCESS`; contratos y builds R6 siguen vigentes. No se modificó `api/`, Android ni contratos web cookie/CSRF. No se ejecutó ningún release.
