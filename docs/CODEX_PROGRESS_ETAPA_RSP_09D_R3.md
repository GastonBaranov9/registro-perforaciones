# RSP-09D-R3 — Serialización native y replacement terminal

## Alcance

R3 corrige los dos hallazgos del review del cliente WebSocket native:

- una única apertura native en vuelo por instancia del servicio;
- ningún reconnect automático después de un cierre server-side `4001`.

No se modificó `api/`; se preservan los contratos de RSP-09D y R2.

## Single-flight y epochs

`AuthService.nativeAuthGeneration` identifica la sesión/autenticación. R3
añade `WebsocketService.connectionEpoch`, que identifica el ciclo de apertura
del socket y es independiente de auth generation.

Mientras existe un `nativeConnectFlight`, llamadas repetidas a `connect()` para
la misma auth generation son no-op. El vuelo conserva la generación y epoch
capturados. Si cambia la generación, el vuelo anterior se invalida y se permite
iniciar el nuevo.

`disconnect()` incrementa el epoch, cancela la suscripción del POST de ticket,
limpia el reconnect timer y elimina la referencia al vuelo. Por tanto, una
respuesta tardía A no puede crear un socket después de `disconnect()` y
`connect()` B. La comprobación de epoch y generación se repite antes de crear
el WebSocket.

Cada socket conserva su epoch; `onopen`, `onmessage`, `onclose` y la referencia
actual verifican identidad socket/epoch. Los callbacks stale no pueden borrar,
activar, cambiar estado ni programar reconnect para otro socket. Los timers
también guardan epoch y generación.

## Cierre 4001

El registry server-side usa `4001` para indicar replacement de otra conexión
de la misma `native_session`. El cliente lo trata como terminal para la
`auth generation` vigente: desactiva reconnect, cancela timers y no solicita
otro ticket.

Un cierre recuperable mantiene el backoff existente y pide un ticket nuevo.
Una auth generation nueva limpia el bloqueo terminal y puede conectar; un
callback `4001` stale de la sesión anterior no afecta esa nueva sesión.

## Seguridad y recursos

El Bearer sigue limitado al POST HTTP por el interceptor. El WebSocket sólo
recibe el ticket transitorio en `/ws?ticket=...`; no se persiste ni se loguea.
Se mantiene Origin exacto, CSP HTTPS/WSS, rate limit R2, ticket single-use,
revalidación y todos los cierres server-side de RSP-09D/R1.

## Validación

- Spec native R3 focalizado: `8 SUCCESS`.
- Suite Angular completa con ChromeHeadless: `294 SUCCESS`.
- Contratos de configuración/CSP: `13/13`; contratos native: `6/6`.
- Builds web y production: OK; chequeo UTF-8: OK.
- Se conservaron los tests web de reconnect/logout y los contratos de ticket.
- API no fue modificada; debe conservar suite/build de R2 sin regresión.
- No se generaron APK/AAB/IPA ni se modificó `appId`.
- La validación física iOS/Android y Gradle con JDK/SDK continúan pendientes
  para RSP-09E.
