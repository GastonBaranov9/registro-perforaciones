# Portal de clientes: preparacion APP/API

Infraestructura confirmada: `www.raulsilvaperforaciones.com` pertenece a HubSpot,
el dominio esta registrado en Squarespace y DNS/edge se administra en Cloudflare.
Este cambio solo prepara el repositorio; no modifica servicios externos ni despliega.

## Contrato y compatibilidad

`PUBLIC_HOST` y `PUBLIC_ORIGIN` conservan su significado: host y origin HTTPS
canonicos de la **web**, usados por Origin, CORS, WebSocket web y smoke operativo.
Siguen siendo obligatorios. `APP_HOST` y `API_HOST` son opcionales y, vacios o
ausentes, toman `PUBLIC_HOST`. Asi, el entorno existente de host unico conserva
Angular, `/api/`, `/ws`, redirects y health sin cambiar su archivo de entorno.

`APP_HOST`, si se indica, debe coincidir con `PUBLIC_HOST`. `API_HOST` acepta
solamente un hostname DNS concreto, en minusculas, sin puerto ni ruta. El inicio
de API, proxy y maintenance rechaza configuraciones inconsistentes; maintenance
usa la misma validacion aun sin API. `docker compose config` resuelve defaults y
exige PUBLIC_*, pero por si solo no verifica la coherencia entre sus valores.

Para activar la separacion en un despliegue futuro, cambiar juntos:

```dotenv
PUBLIC_HOST=app.raulsilvaperforaciones.com
PUBLIC_ORIGIN=https://app.raulsilvaperforaciones.com
APP_HOST=app.raulsilvaperforaciones.com
API_HOST=api.raulsilvaperforaciones.com
```

No cambiar el entorno real ahora. No basta con agregar APP_HOST manteniendo
PUBLIC_HOST=api: esa contradiccion se rechaza. No omitir API_HOST durante la
migracion, porque su default pasaria a APP. `API_ORIGIN` es una variable **interna**
derivada por el proxy para redirects, no una nueva opcion de configuracion:
HTTPS + API_HOST + el mismo puerto publico que PUBLIC_ORIGIN. El puerto externo
publico normal es 443 implicito; `HTTPS_PORT=8443` es el listener local del tunel
y no debe agregarse a PUBLIC_ORIGIN. Los laboratorios pueden usar un puerto
publico alternativo comun a ambos hosts, como antes.

| Ruta | APP | API (separado) |
| --- | --- | --- |
| `/`, `/pozos-list`, assets y fallback SPA | Angular existente | 404 |
| `/api` | 308 a `/api/` | 308 a `/api/` |
| `/api/*` | API, quitando prefijo | Igual, compatible con APK |
| `/api/health`, `/api/ready` | Health/readiness existentes | Iguales |
| `/ws` | WebSocket | WebSocket, incluidos tickets native |

HTTP redirige al HTTPS del mismo host. Hosts desconocidos reciben 421 tanto
en HTTP como en HTTPS, tambien durante maintenance. Maintenance devuelve 503
con Retry-After en ambos hosts, salvo `/maintenance-health` (200); nunca publica
Angular ni alcanza upstreams. `/api/ready` permanece en 503 durante mantenimiento.

La web usa `/api/` y `/ws` same-origin. Cookies host-only, HttpOnly/Secure,
SameSite, CSRF y CSP se conservan. No se agrega API_HOST automaticamente a
CORS_ORIGINS ni a los origins WebSocket web. CORS_ORIGINS vacio autoriza solo
PUBLIC_ORIGIN; si existen integraciones HTTPS explicitas se conserva la lista
y debe revisarse antes de la migracion. WebSocket web exige PUBLIC_ORIGIN;
native mantiene su validacion de ticket y origins locales exactos. La APK
conserva `https://api.raulsilvaperforaciones.com`, `/api/auth/native/*`, bearer
y `/ws`; no se modifica su backend ni requiere recompilacion por este cambio.

## Pasos externos posteriores

1. Planificar despliegue y cambio conjunto de las cuatro variables, validando
   primero ambos hosts contra el listener local. Certificado/SNI y HTTP Host
   que cloudflared entrega al origen deben ser compatibles con ambos nombres.
   Un HTTP Host fijo en API haria que APP no reciba Angular; verificar el override
   existente. No desactivar verificacion TLS como solucion.
2. En Cloudflare, agregar `app.raulsilvaperforaciones.com` como otra Published
   Application del tunel existente **rps-pilot**, servicio **https://localhost:8443**.
   Conservar `api.raulsilvaperforaciones.com` y el catch-all 404. No crear otro tunel.
3. Verificar desde ambos hosts web login/CSRF, health/readiness y WebSocket;
   comprobar login y operaciones de la APK actual. Las pruebas del repo no
   certifican la configuracion TLS/Host efectiva del tunel real.
4. En HubSpot, agregar el boton **Ver mis pozos** hacia
   **https://app.raulsilvaperforaciones.com/pozos-list**. Su codigo no esta en el repo.

Al cambiar de host web, las cookies existentes no se transfieren: los usuarios
deberan iniciar sesion en APP. Coordinar el corte del portal que antes respondia
en API. Las pruebas aisladas no sustituyen el smoke del futuro despliegue ni
verifican upgrades desde la produccion 97e5604cf08a3; el HEAD inicial fue a1d84f3.

## Verificacion acotada

```powershell
node --test --experimental-strip-types api/test/runtime-config.test.ts api/test/proxy-origin.test.ts api/test/production-runtime-files.test.ts
node --test scripts/portal-proxy-config.test.mjs
node --test front/scripts/production-contract.test.mjs
& ./scripts/test-rsp07f-r14-timeouts.ps1
git diff --check
```

La prueba del proxy usa solamente la imagen Nginx fijada en Compose, TLS efimero,
upstreams simulados y puertos loopback aleatorios. No inicia PostgreSQL, no lee
secretos reales, no ejecuta scripts de deploy ni construye Angular/Android.
