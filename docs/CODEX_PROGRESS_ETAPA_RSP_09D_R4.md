# RSP-09D-R4 — Expiry web, promoción native y timeout de ticket

## Alcance

R4 corrige exclusivamente tres hallazgos del runtime WebSocket:

- el socket web respeta el `exp` del JWT usado en el handshake;
- un socket native nuevo se registra como candidate y sólo reemplaza al active
  después de completar todas sus validaciones;
- el POST native de `ws-ticket` tiene un timeout real y cancelable.

No se agregaron migraciones ni se modificaron CORS, CSRF, cookies, Origins,
CSP, emisión/redención de tickets o autenticación Bearer.

## Expiry del WebSocket web

`authenticateWeb` exige que el payload ya verificado incluya `exp` numérico,
entero, positivo y seguro. El handler captura ese valor en segundos Unix y lo
guarda en el contexto de la conexión junto a `version_sesion`.

Cada revalidación evalúa primero `floor(Date.now() / 1000) < exp`. Al alcanzar
`exp`, el socket se retira y cierra aunque usuario, cuenta y `version_sesion`
sigan válidos. No se decodifica nuevamente el JWT ni se renueva la conexión;
el cliente web debe reconectar con una cookie todavía vigente.

El fan-out aplica la misma barrera temporal antes de cada envío. Así, una
notificación que coincida con el vencimiento no espera al siguiente heartbeat
para retirar el socket expirado.

## Active, candidate y promoción

Por `native_session` el registry conserva un active operativo y, como máximo,
un candidate no operativo. Registrar el candidate no toca el active. Durante
la validación, fan-out continúa llegando al active y nunca al candidate.

La promoción es síncrona dentro del proceso Node:

1. confirma identidad, registro, estado OPEN y que sea el candidate vigente;
2. marca el candidate como operativo/current;
3. retira el active anterior por identidad;
4. recién entonces cierra el anterior con `4001`.

No hay `await` entre el cambio de referencias. El callback `close` del socket
anterior sólo puede retirar su propia entrada y no elimina al sucesor.

Si el candidate falla, se desconecta o es superado por otro candidate, se
limpia sin cerrar el active. Si ocurre logout durante la validación, se cierran
active y candidate; una promoción tardía falla porque el candidate ya no está
registrado. Dos candidates se resuelven determinísticamente conservando el más
reciente y nunca hay más de un active operativo.

## Timeout del ticket native

El POST `/api/auth/native/ws-ticket` usa el operador RxJS `timeout` con 10
segundos, coherente con el timeout de bootstrap/session. El timeout cancela la
suscripción HTTP real, rechaza el vuelo, libera `nativeConnectFlight` y entra al
backoff recuperable existente si la auth generation y `connectionEpoch` siguen
vigentes.

No produce logout ni borra el token. `disconnect`, logout, cambio de generación
o un estado terminal `4001` invalidan el intento; un timeout stale no programa
reconnect. El siguiente intento solicita un ticket nuevo y nunca reutiliza el
anterior.

## Validación

- Tests API focalizados cubren expiry, unidades, active/candidate, fallo,
  desconexión, candidates concurrentes, logout y cleanup por identidad.
- Tests frontend focalizados cubren timeout, cancelación real, liberación del
  flight, backoff y ausencia de reconnect stale.
- Tests focalizados API: `28/28`; suite API completa: `301/301`.
- Spec native frontend: `10 SUCCESS`; suite Angular: `296 SUCCESS`.
- PostgreSQL real: native auth/concurrencia `1/1` y revocación web `1/1`.
- Config/CSP: `13/13`; contratos native: `6/6`.
- Builds API, web, web production y native-development: OK.
- `cap sync android`: OK; chequeo UTF-8: OK.
- Gradle no se ejecutó: `java` no está disponible y `JAVA_HOME` no está definido.
- No se crearon migraciones ni artefactos APK/AAB/IPA.
- Se preservan rate limit pre-DB, single-use, post-validation R1, separación de
  Origins R2 y single-flight/terminal `4001` R3.
