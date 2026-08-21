# ETAPA RSP-07F-R12 - backend especifico para Capacitor

> **Superseded por RSP-07F-R16 para producción Android.** R12 demostró separación de routing, pero no resolvió el transporte de sesión entre un WebView local y el backend remoto. `build:native`, `capacitor:sync`, `NATIVE_BACKEND_ORIGIN` y el target Angular native fueron retirados. No existe un build Android productivo soportado hasta diseñar P2-10 Android Auth; los comandos descritos abajo son evidencia histórica y ya no están disponibles.

## Causa del hallazgo

El build web productivo usa correctamente `/api` y deriva `/ws` desde el origin de la pagina. `capacitor.config.ts` empaqueta ese mismo `dist/front/browser` como assets locales, pero el origin de esos assets dentro de Android pertenece al WebView. Por eso una ruta relativa o un WebSocket derivado de `window.location` apuntaban al host local del WebView y no al backend remoto.

## Separacion web y native

El environment web de `src/environments/environment.ts` conserva:

- `serverURL: /api`;
- `apiURL: /api/`;
- WebSocket obtenido exclusivamente del protocol y host del browser actual, con path `/ws`.

No contiene dominio native ni fallback localhost. El build habitual `npm run build` sigue seleccionando la configuracion `production` y mantiene la arquitectura same-origin de Nginx.

Angular incorpora una configuracion adicional `native` que reemplaza el environment web por `environment.native.generated.ts`. Ese archivo no se versiona: `npm run build:native` lo genera temporalmente desde `NATIVE_BACKEND_ORIGIN`, ejecuta `production,native` para conservar optimizacion, budgets y service worker productivos, y lo elimina incluso si Angular falla.

Para un origin `https://app.empresa.example`, el environment native queda conceptualmente configurado como:

- API root: `https://app.empresa.example/api`;
- API base: `https://app.empresa.example/api/`;
- WebSocket: `wss://app.empresa.example/ws`.

Los servicios HTTP existentes ya centralizaban sus 48 usos en `environment.apiURL`; el servicio R9 abre el socket exclusivamente con `environment.wsUrl`. No fue necesario cambiar su ciclo de heartbeat/retry ni introducir concatenaciones adicionales.

## Build y sincronizacion Capacitor

POSIX:

```sh
NATIVE_BACKEND_ORIGIN=https://app.empresa.example npm run build:native
NATIVE_BACKEND_ORIGIN=https://app.empresa.example npm run capacitor:sync
```

PowerShell:

```powershell
$env:NATIVE_BACKEND_ORIGIN = 'https://app.empresa.example'
npm run build:native
npm run capacitor:sync
```

`capacitor:sync` encadena el build native y `cap sync`, por lo que no copia assets si la configuracion o el build fallan. Capacitor conserva `webDir: dist/front/browser` y no incorpora `server.url`: la aplicacion sigue usando assets locales y solo API/WS son remotos.

## Fail-fast y validacion

Si `NATIVE_BACKEND_ORIGIN` falta, `build:native` termina con codigo 2 antes de invocar Angular. La URL debe ser un origin absoluto `https://`, con host explicito y sin path, query, fragment, credenciales ni espacios externos. Se rechazan HTTP, rutas relativas, `localhost`, subdominios `.localhost`, IPv4 loopback, `0.0.0.0`, `::` y `::1`. Se admite un puerto HTTPS remoto explicito. El WebSocket siempre se deriva como WSS.

El archivo generado se limpia antes y despues del build para que una interrupcion previa no pueda reutilizar configuracion obsoleta. La URL publica no es un secreto y no se incorpora ninguna credencial.

## Pruebas de configuracion y artifacts

La suite Node valida environment web, Capacitor local, URLs validas, puerto, ausencia de configuracion, HTTP, relativas, credenciales, path/query/fragment y hosts locales/loopback.

`npm run test:build-targets` realiza dos builds reales. Primero construye native con el fixture no contactado `https://native-backend.example` y comprueba en el artifact:

- `https://native-backend.example/api/`;
- `wss://native-backend.example/ws`;
- ausencia de URLs localhost y `capacitor://localhost`;
- eliminacion del environment temporal.

Luego construye web production sobre el mismo directorio y comprueba `/api`, `/ws` y ausencia del dominio fixture. De este modo el artifact que queda al finalizar vuelve a ser web y no conserva una configuracion native de prueba.

La suite Angular completa conserva 185 tests verdes, incluidos socket unico, backoff 1/2/5/10/10, retry lento de 30 s y cancelacion por logout, revocacion y destroy.

## Seguridad web intacta y limite pendiente

R12 no modifica API, proxy, CORS, CSRF, validacion Origin HTTP/WebSocket, cookies HttpOnly, SameSite, sesiones, login rate limit ni almacenamiento de tokens. No se agregaron `capacitor://localhost`, `http://localhost`, Bearer tokens ni excepciones mobile.

Estado explicito:

- Native backend routing: preparado.
- Android authentication: pendiente (P2-10).

Por tanto el bundle native ya conoce API y WSS remotos, pero el backend puede rechazar hoy requests nativas por Origin, CORS, cookies o CSRF. Eso es esperado y no significa que Android completo este productivamente resuelto.
