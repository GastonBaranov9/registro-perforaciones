# ETAPA RSP-07F-R16 — no publicar build native hasta Android Auth

Fecha: 2026-08-21
Rama: `feature/rsp-07-produccion`
HEAD inicial: `5218ddda6c1106a3a5a8d843305fb9a57955285a`

## 1. Causa del P1

R12 separó correctamente el routing web y native, pero el routing no constituye una estrategia de autenticación. Un bundle Capacitor carga assets desde un origin de WebView, como `capacitor://localhost` o `https://localhost`, mientras la API productiva autentica mediante sesión HttpOnly host-scoped, cookie `SameSite=Lax`, doble submit CSRF y validación estricta de Origin.

Apuntar las URLs del bundle a `https://backend.example/api` y `wss://backend.example/ws` deja requests cross-site: Origin HTTP/WS no coincide y el transporte de cookies/CSRF no satisface el contrato web. El resultado era un artifact que construía correctamente pero no podía completar login y sesión autenticada.

## 2. Decisión de arquitectura

RSP-07 publica exclusivamente producción web same-origin. Android productivo queda bloqueado hasta una etapa dedicada P2-10 Android Auth.

No se aceptaron origins de WebView, no se amplió CORS, no se desactivó CSRF, no se cambió `SameSite`, no se expusieron cookies HttpOnly y no se introdujeron Bearer tokens, localStorage ni endpoints móviles improvisados.

## 3. Elementos de R12 retirados

Se eliminaron:

- scripts npm `build:native` y `capacitor:sync`;
- variable/flujo `NATIVE_BACKEND_ORIGIN`;
- configuración Angular `native` y su file replacement;
- environment native generado y su regla `.gitignore`;
- `scripts/build-native.mjs`;
- `scripts/native-backend-config.mjs`;
- pruebas que presentaban el routing remoto como preparado;
- comando `test:build-targets`, sustituido por `test:production-build` exclusivamente web.

Al no quedar un comando native soportado, no se produce un APK/bundle productivo engañoso ni existe un fallback silencioso.

## 4. Producción web preservada

`build:production` continúa ejecutando:

```text
ng build --configuration production
```

El Dockerfile frontend y `BUILD_IMAGES=true` continúan usando ese comando. El environment productivo conserva:

- `serverURL: /api`;
- `apiURL: /api/`;
- WebSocket derivado de `globalThis.location.protocol` y `globalThis.location.host`, con path `/ws`.

El artifact Angular y la imagen Docker fueron inspeccionados: contienen `/api/` y `/ws`, sin `NATIVE_BACKEND_ORIGIN`, dominio remoto de fixture ni `capacitor://localhost`.

## 5. Estado real de Capacitor

Se conservan como base técnica futura:

- dependencias Capacitor/Ionic;
- `capacitor.config.ts`;
- `webDir: dist/front/browser`;
- estructura `front/android` y assets locales.

`capacitor.config.ts` sigue sin `server.url`. Esta base no implica soporte productivo Android y no se ofrece un comando de build/sync productivo hasta P2-10.

## 6. Seguridad web sin cambios

No se modificó ningún archivo de runtime backend. Permanecen:

- Origin HTTP mediante allowlist productiva;
- Origin WebSocket igual a `PUBLIC_ORIGIN`;
- CORS sin wildcard y con credenciales;
- CSRF cookie/header;
- sesión HttpOnly;
- `SameSite=Lax`;
- Secure en producción;
- logout/revocación y rate limits.

La suite API cubrió explícitamente cookies, CSRF, Origin HTTP/WS, CORS, login y limitadores.

## 7. P2-10 Android Auth

P2-10 es un bloqueante arquitectónico real, no una tarea de configurar URL. Debe definir conjuntamente:

- origin y trust boundary del WebView;
- transporte y almacenamiento seguro de sesión/credenciales;
- política CSRF equivalente para el cliente móvil;
- autenticación y Origin del WebSocket;
- logout, revocación, expiración y recuperación;
- integración con el ciclo de vida Android.

Hasta que ese diseño exista y se pruebe end-to-end, `Android production build/auth = NOT YET SUPPORTED`.

## 8. Documentación histórica

R12, R13 y R14 se mantienen como registros históricos. Recibieron notas explícitas que indican que las pruebas/routing native fueron superseded por R16 y que los comandos ya no están disponibles.

## 9. Validación

- `npm run test:config`: 3/3 contratos OK; no hay scripts/target/environment native y Capacitor permanece sólo como base.
- `npm run test:production-build`: build Angular productivo OK; artifact `/api` y `/ws` same-origin, sin fixture native.
- Frontend completo: 185/185 tests OK.
- API build TypeScript: OK.
- API completa: 256/256 tests OK, incluidos auth, Origin, CORS, CSRF, cookies, login limiter, R15 y etapas previas.
- Docker build API+frontend equivalente a `BUILD_IMAGES=true`: OK; frontend ejecutó exclusivamente `npm run build:production`.
- Artifact de imagen Docker: `WEB_ARTIFACT_OK`.
- Imágenes temporales de validación: eliminadas.
- Secret scan, `git diff --check` y estado final Git: registrados al cierre.

## 10. Hallazgo cerrado

RSP-07 ya no expone ni documenta como soportado un bundle native que no puede autenticarse. Producción web conserva íntegramente su modelo de seguridad; Android Auth queda explícita y correctamente diferida a P2-10.
