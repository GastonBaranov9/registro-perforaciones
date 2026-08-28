# CODEX — PROGRESS ETAPA RSP-09C-R4

## Alcance

R4 corrige exclusivamente las dos regresiones detectadas en el review: el fallback visual del mapa aéreo en web y la limpieza de credenciales legacy del navegador. No hubo cambios en `api/`, Android, migraciones ni WebSocket native.

## Fallback del mapa

`MapaAereoComponent` conserva `ProtectedResourceService` y el flujo Blob/object URL native. El `<img>` ahora maneja tanto `protectedResourceError` (fallo HTTP native o URL no autorizada) como el evento DOM `error`. Esto cubre la URL directa de web, donde el navegador es quien detecta 404, 500 o contenido inválido. En ambos casos se activa `falloImagen`, se elimina la imagen rota del DOM y se muestra el fallback existente “Mapa aéreo no disponible”. Las coordenadas y cambios de recurso siguen reiniciando el estado como antes; no se agregaron reintentos.

Las URLs protegidas continúan pasando por el loader autenticado native; no se envían Bearer en URLs ni a origins externos. La directiva mantiene cancelación de respuestas stale y `revokeObjectURL`; uploads multipart, descargas PDF y Maps backend no cambian.

## Limpieza legacy

`MainStore.init()` elimina `localStorage.token` y `localStorage.user`, las dos claves de credenciales/PII identificadas en la implementación histórica. El código moderno no las lee, no las usa para autenticación, no las migra a Preferences o secure storage y nunca escribe tokens en localStorage. La limpieza sólo elimina esas claves conocidas y preserva claves no relacionadas, permitiendo upgrades seguros desde versiones antiguas sin contradecir la prohibición de usar localStorage como almacenamiento de sesión.

## Pruebas y validación

- Mapa: error DOM web muestra fallback y elimina la imagen; `protectedResourceError` native muestra el mismo fallback.
- MainStore: elimina token/user legacy, conserva claves no relacionadas y deja el usuario en memoria sin sesión.
- Suite Angular completa: 267/267.
- Builds web normal, production y native-development: PASS.
- Contratos de configuración/native-config y API: sin cambios de contrato; `api/` permanece intacto.
- `cap sync android` no era necesario por no cambiar archivos native en R4; la configuración R3 ya sincronizada se conserva.
- Gradle físico continúa pendiente por ausencia de JDK/Android SDK en la estación, sin generar release.

## Seguridad

El scan confirma ausencia de escrituras de token a localStorage, ausencia de token en URLs/query y preservación de la protección de origin del Bearer. La eliminación de claves legacy reduce exposición de datos antiguos sin reintroducir autenticación basada en navegador.

