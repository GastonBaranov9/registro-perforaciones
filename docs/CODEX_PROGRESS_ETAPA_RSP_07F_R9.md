# ETAPA RSP-07F-R9 — Reconexión WebSocket tras cortes prolongados

## 1. Alcance

R9 corrige exclusivamente el P2 de reconexión WebSocket del frontend. No modifica API, proxy, heartbeat, autenticación, Origin, CSRF, reglas de negocio ni despliegue.

## 2. Causa

El cliente aplicaba los delays rápidos de 1, 2, 5, 10 y 10 segundos, pero al agotar el quinto intento asignaba `reconnectEnabled = false`. Una caída de aproximadamente 28 segundos dejaba al usuario autenticado sin WebSocket de forma permanente. Como la señal de usuario no cambiaba al volver el servidor, el efecto de aplicación no volvía a invocar `connect()` y la recuperación exigía reload o un nuevo login.

## 3. Backoff rápido y retry lento

Se conserva la secuencia rápida:

```text
1 s → 2 s → 5 s → 10 s → 10 s
```

Después se usa un retry lento periódico de 30 segundos. El contador queda saturado en esa fase, por lo que no crece indefinidamente ni cambia el intervalo. Un `open` confirmado reinicia el contador y el siguiente corte vuelve a comenzar por 1 segundo.

## 4. Condiciones de continuidad y detención

El retry continúa sólo mientras:

- la reconexión esté habilitada;
- el servicio no haya sido destruido;
- `AuthService.userId()` siga indicando una sesión autenticada.

`disconnect()` —incluido el logout— deshabilita reconexión, reinicia el contador, cancela el timer y cierra intencionalmente el socket actual. La revocación observada como usuario nulo impide crear el siguiente socket. `ngOnDestroy()` marca el servicio como destruido y reutiliza el mismo cleanup.

## 5. Un solo socket y un solo timer

La protección existente se conserva:

- `connect()` cancela cualquier timer pendiente antes de abrir;
- no abre si el socket actual está `CONNECTING` u `OPEN`;
- `scheduleReconnect()` no programa si ya existe un timer;
- el callback vacía su referencia antes de intentar abrir;
- handlers de sockets obsoletos no alteran el estado;
- un `open` recuperado no deja timers que creen conexiones posteriores.

Por tanto un retorno de red/servidor crea un único socket y recupera notificaciones sin reload.

## 6. Heartbeat y seguridad preservados

No se modificaron el ping/pong del servidor, su detección de clientes muertos ni el timeout del proxy. Tampoco cambian la URL WebSocket, cookies de autenticación, handshake same-origin, Origin estricto, CORS o CSRF HTTP.

## 7. Pruebas

Las pruebas con reloj falso cubren:

1. conexión única y llamadas `connect()` repetidas;
2. cierre inesperado y primer retry de 1 segundo;
3. cierre intencional por logout;
4. outage superior a los 28 segundos rápidos y recuperación en el retry lento;
5. maintenance prolongado durante varios ciclos de 30 segundos;
6. logout durante retry lento;
7. sesión revocada durante retry lento;
8. destrucción durante retry lento;
9. ausencia de sockets o timers duplicados después de recuperar.

Resultados:

- suite focalizada WebSocket: 8/8;
- frontend production build: OK;
- frontend suite completa ChromeHeadless: 185/185;
- API build: OK;
- API suite completa: 244/244.

Los tiempos prolongados se aceleraron con timers falsos; no se desplegó infraestructura ni se esperó en tiempo real.

## 8. Hallazgo cerrado

El frontend ya no abandona permanentemente la reconexión tras los cinco intentos rápidos. Un maintenance o corte prolongado conserva una cadencia acotada de 30 segundos y se recupera automáticamente cuando vuelve el servicio, siempre que la sesión continúe vigente.

## 9. Pendiente fuera de alcance

Permanece pendiente el P2 Android registrado en etapas anteriores. R9 no modifica Android.
