# RSP-09A — Arquitectura de autenticación Android/Capacitor

Fecha de cierre arquitectónico: 2026-08-24
Rama auditada: `feature/rsp-09-android-auth`
Base y HEAD inicial: `14df7c0a7fa300a76df9646405eddfa4d247c0b3`

## 1. Resumen y decisión

RSP-09A no cambia el runtime. Define dos canales de autenticación independientes que convergen, después de autenticar, en la autorización de negocio existente:

```text
WEB
https://dominio/ + /api/ + /ws
        |
        `-- cookie rsp_session HttpOnly + rsp_csrf + Origin web

ANDROID (assets empaquetados en https://localhost)
        |
        `-- Authorization: Bearer <sesión opaca nativa>
               |
               `-- identidad normalizada -> roles y ownership existentes
```

La arquitectura recomendada es una **sesión nativa opaca única, aleatoria, revocable y con expiración server-side**, no JWT y no pareja access/refresh en el piloto. La aplicación conservará la credencial persistente en almacenamiento cifrado respaldado por Android Keystore, la cargará en memoria sólo mientras sea necesaria y la enviará explícitamente en `Authorization`. Web continúa sin cambios con cookie HttpOnly, doble submit CSRF y same-origin.

Los handlers de pozos, propietarios, sitios, fotos, informes y catálogos no se duplicarán. Un resolver de autenticación futuro distinguirá explícitamente cookie web y Bearer nativo, y entregará a los guards actuales la misma identidad `sub`. Sólo login, estado de sesión, logout y ticket WebSocket tendrán namespace nativo.

Esta decisión cumple el objetivo de revocación inmediata usando PostgreSQL y `version_sesion`, evita credenciales ambientales y third-party cookies, funciona con `fetch`, multipart y binarios, y deja una base compatible con conectividad intermitente y futuros borradores offline.

## 2. Alcance y restricciones congeladas

En RSP-09A no se crean rutas, tokens, tablas ni builds Android productivos. Tampoco se instala un plugin. Quedan congelados:

- login web y su respuesta;
- `rsp_session` HttpOnly;
- `rsp_csrf` legible por Angular;
- `Secure` en producción, `SameSite=Lax`, `Path=/` y cookies host-only;
- expiración web de 10 horas;
- CSRF web;
- CORS y validación Origin web;
- autenticación y Origin del WebSocket web;
- topología productiva `https://dominio/`, `https://dominio/api/`, `wss://dominio/ws`;
- ausencia de target/build native productivo introducida por RSP-07F-R16.

La URL del backend incluida en un APK futuro será configuración pública, nunca un secreto. Contraseñas, tokens, pepper, claves de firma y credenciales de Google no se incorporarán al bundle.

## 3. Auditoría del contrato web actual

### 3.1 Login, cookies y sesión

`POST /login` interno, expuesto como `POST /api/login`, recibe el schema actual `{ email, password }`. `logUser` selecciona sólo cuentas activas, con `cuenta_acceso=TRUE` y password presente, y valida el mismo bcrypt actual. Cuenta inexistente, inactiva o password incorrecto terminan en el error genérico de credenciales.

Después del login se emite un JWT firmado de sesión web con `sub`, roles y `version_sesion`, con `expiresIn: 10h`. La respuesta de negocio es únicamente `{ authenticated: true }` y fija:

| Propiedad | `rsp_session` | `rsp_csrf` |
|---|---:|---:|
| Uso | autenticación JWT | double-submit CSRF |
| HttpOnly | sí | no, Angular debe leerla |
| Secure | sí si `NODE_ENV=production` | igual |
| SameSite | `Lax` | `Lax` |
| Path | `/` | `/` |
| Domain | ausente: host-only | ausente: host-only |
| Max-Age | 36.000 s (10 h) | 36.000 s (10 h) |

El token CSRF contiene 32 bytes aleatorios codificados en hexadecimal. El interceptor Angular sólo actúa sobre la API configurada, lee `rsp_csrf` desde `document.cookie`, agrega `X-CSRF-Token` a métodos no seguros y usa `withCredentials: true`.

El hook CSRF exime `GET`, `HEAD`, `OPTIONS` y `POST /login`. En las demás mutaciones, si hay cookie de sesión, exige cookie y header CSRF no vacíos, de igual longitud y comparados con `timingSafeEqual`.

### 3.2 Autenticación, autorización y revocación

`authenticate` ejecuta `jwtVerify({ onlyCookie: true })`: hoy un Bearer es rechazado deliberadamente. Luego normaliza `sub` y `version_sesion`, consulta PostgreSQL en cada request y exige simultáneamente:

- usuario existente;
- usuario activo;
- `usuario.version_sesion === token.version_sesion`.

Los guards consultan roles actuales y ownership en la base; no confían únicamente en los roles embebidos. Desactivación, cambio relevante de cuenta/password y cambios de rol incrementan `version_sesion` según los servicios correspondientes y revocan sesiones anteriores.

`POST /logout` requiere cookie válida y CSRF por el hook global. Incrementa `version_sesion` y elimina ambas cookies. Por tanto, el logout web actual es global para todas las sesiones web de ese usuario y también deberá invalidar sesiones native que conserven la versión anterior. No se modifica esta semántica en RSP-09A.

### 3.3 CORS y Origin HTTP

En producción, `PUBLIC_ORIGIN` HTTPS canónico se incluye en la allowlist `CORS_ORIGINS`; no se admite `*`, HTTP ni localhost. El plugin actual permite exactamente los origins configurados, los métodos `GET, POST, PUT, PATCH, DELETE, OPTIONS`, sólo `Content-Type` y `X-CSRF-Token`, y anuncia `credentials: true`.

La validación Origin es adicional a CORS. En producción:

- una mutación requiere Origin presente e incluido en la allowlist HTTP;
- un método seguro puede no tener Origin;
- un upgrade WebSocket exige Origin exactamente igual a `PUBLIC_ORIGIN`, no cualquier origin CORS;
- un Origin inválido produce el error de CSRF/403.

### 3.4 WebSocket, rate limits, proxy y logging

`GET /ws` usa la misma cookie web y `authenticate`. El navegador abre `new WebSocket()` contra el host actual; la cookie acompaña el handshake same-origin. El servidor conserva heartbeat ping/pong cada 30 segundos y reconexión escalonada en el cliente.

La autenticación web actual ocurre sólo durante el upgrade. La conexión registrada conserva `id_usuario` e `isAdmin`, pero el heartbeat no vuelve a consultar `activo`/`version_sesion` y logout no busca/cierra sockets existentes. Como los mensajes son exclusivamente servidor→cliente y no aceptan IDs enviados por el navegador, la superficie está acotada, pero una conexión ya abierta puede seguir recibiendo notificaciones hasta cerrarse. RSP-09A no cambia ese comportamiento congelado; RSP-09D deberá incorporar cierre/revalidación para native y cubrir expresamente esta ventana web sin degradar compatibilidad.

Los límites por defecto son 600 requests API/min/IP y 10 intentos de login/min/IP. Maps, PDF y uploads tienen límites especializados. `/ws` está excluido del limitador API general; cualquier canal native futuro necesita límite propio de tickets y conexiones.

Nginx termina TLS 1.2/1.3, redirige HTTP, enruta `/api/` y `/ws`, propaga exactamente un salto confiable y registra `$uri`, no query string ni headers. Fastify deshabilita el request log automático y su logger redacta `authorization`, cookie, `x-csrf-token`, `set-cookie`, password, base64 y parámetros denominados token. Las rutas de error también sanitizan query strings sensibles. Este contrato debe ampliarse, no reemplazarse.

## 4. Entorno Capacitor/Android real

Versiones efectivamente resueltas por `front/package-lock.json` y `npm ls`:

| Componente | Versión instalada |
|---|---:|
| `@capacitor/core` | 8.0.0 |
| `@capacitor/android` | 8.0.0 |
| `@capacitor/cli` | 8.0.0 |
| `@capacitor/camera` | 7.0.2 |
| `@capacitor/geolocation` | 8.0.0 |
| Angular core | 20.3.9 |
| Angular CLI | 20.3.8 |
| Ionic Angular | 8.7.8 |
| Ionic Angular Toolkit | 12.3.0 |

`capacitor.config.ts` define `appId: com.example.app`, `appName: front` y `webDir: dist/front/browser`. No define `server`, `hostname`, `androidScheme`, `server.url`, cleartext ni plugins HTTP. El proyecto Android está presente y usa:

- min SDK 23, target/compile SDK 35;
- Android Gradle Plugin 8.7.2, Gradle 8.11.1 y Java 21;
- permiso `android.permission.INTERNET` solamente en el manifest propio;
- `android:allowBackup="true"`, sin reglas de exclusión;
- Camera y Geolocation como únicos plugins externos sincronizados;
- `CapacitorHttp` incluido en core pero con patch de `fetch`/XHR deshabilitado por defecto.

Capacitor 8 implementa en el código Android instalado `hostname="localhost"` y `androidScheme="https"` por defecto. Como el proyecto no los sobreescribe, el origin real esperado para los assets empaquetados es:

```text
https://localhost
```

No es una inferencia basada en una versión anterior: coincide el código `CapConfig.java` instalado con la referencia v8. `server.url` está ausente y la documentación de Capacitor lo declara para live reload, no para producción. El `appId` actual es además un placeholder que deberá bloquear un build piloto/productivo hasta ser reemplazado por uno controlado.

## 5. Por qué la cookie web no se reutiliza directamente

Supuesto analizado:

```text
assets:  https://localhost
fetch:   https://backend.example/api/
ws:      wss://backend.example/ws
```

| Control | Resultado con el contrato actual |
|---|---|
| Origin HTTP | el navegador envía `Origin: https://localhost`; producción no permite localhost y la mutación se rechaza |
| Preflight | JSON, `X-CSRF-Token` o futuro `Authorization` disparan OPTIONS; el origin no está permitido y `Authorization` ni integra los headers actuales |
| CORS | `credentials: true` no concede acceso sin allowlist exacta; `*` sería inválido con credenciales y no se propone |
| Cookie host-only | pertenece a `backend.example`; no es cookie de `localhost` |
| SameSite=Lax | localhost y backend son cross-site; una cookie Lax no acompaña un `fetch` cross-site subresource aunque se use `credentials: include` |
| Third-party cookies | su aceptación depende de WebView/Android y políticas del usuario; no es base estable para autenticación |
| HttpOnly | correctamente impide que JS extraiga `rsp_session`; por tanto no puede convertirla en header |
| Double-submit CSRF | JS de `https://localhost` no puede leer la cookie `rsp_csrf` host-only de `backend.example`, así que no puede producir el header esperado |
| `withCredentials` | solicita cookies pero no supera SameSite, host scope, third-party policy, CORS ni Origin |
| WebSocket | el API browser no permite fijar libremente `Authorization`; el Origin sería `https://localhost` y el servidor sólo acepta `PUBLIC_ORIGIN` |

Ampliar la allowlist no arregla las cookies ni CSRF. Cambiar a `SameSite=None`, sincronizar cookies o desactivar CSRF debilitaría el contrato web y seguiría dependiendo de third-party cookies. Por eso no se hará un bypass.

## 6. Alternativas evaluadas

| Alternativa | Seguridad web | Revocación/operación | Offline y binarios | Resultado |
|---|---|---|---|---|
| A. cookies web cross-origin | obliga a rediseñar SameSite, CSRF, CORS y Origin; depende de cookies ambientales | posible, pero frágil en WebView | fetch binario funciona si las cookies funcionan | descartada |
| B. `server.url` con web remota | conserva same-origin si carga toda la app remota, pero transforma el APK en un contenedor de código remoto | sesión web actual | sin arranque útil offline; cada pantalla depende de red | descartada para producción |
| C. HTTP nativo + cookie bridge | duplica/sincroniza jars, dificulta preservar HttpOnly y double-submit | logout y cookies quedan repartidos | multipart/PDF necesitan caminos especiales; WS queda sin resolver | descartada |
| D. Bearer nativo | separa claramente el canal sin tocar cookies web | revocación inmediata server-side | fetch, multipart, Blob y futuros drafts son compatibles | **recomendada** |
| E. OAuth/OIDC con Authorization Code + PKCE | arquitectura estándar si existiera un IdP | buena revocación según proveedor | buena UX potencial | reservar si se incorpora identidad central; hoy añade IdP y complejidad sin necesidad |

### A. Cookies web cross-origin

No se recomienda aunque parezca requerir menos backend. Exige `SameSite=None; Secure` o una topología especial, cookies de terceros habilitadas, CORS con credenciales, un nuevo transporte CSRF y una rama WS. Hace depender la app de comportamiento variable de Android System WebView y amplía la superficie web.

### B. `server.url` / web remota

Capacitor documenta `server.url` para live reload y dice que no está pensado para producción. Elimina la ventaja de assets empaquetados, impide una evolución offline fiable, ata el arranque a red y permite que cambios de servidor alteren el código servido sin actualización de APK. No se usará como workaround.

### C. HTTP nativo y cookie bridge

`CapacitorHttp` puede ejecutar requests con librerías nativas y ofrece helpers; su patch de fetch está apagado actualmente. Sin embargo, una solución basada en cookie requiere coordinar cookie manager nativo/WebView, CSRF, expiración y logout. Los helpers directos tienen restricciones para `FormData`, `Blob` y `ArrayBuffer`; grandes archivos tienen recomendaciones de transporte específicas. WebSocket seguiría requiriendo otro mecanismo. Se conserva como posible transporte puntual de archivos, no como modelo de auth.

### D. Bearer opaco nativo

La app añade deliberadamente una credencial no ambiental. CORS protege la lectura desde un WebView no autorizado, pero no se trata como autenticación. CSRF browser tradicional deja de aplicar al canal Bearer porque el navegador no adjunta automáticamente el header. PostgreSQL permite lookup, expiry, auditoría y revocación inmediata. Es la opción proporcional al sistema.

### E. OAuth/OIDC

Sería preferible si el proyecto adoptara un proveedor de identidad mantenido. En ese caso se deberá usar navegador del sistema y PKCE, no password dentro de un WebView. Hoy no existe IdP, sólo habrá 1–2 perforadores y el backend ya posee bcrypt, roles y revocación. Introducirlo en este punto no simplifica el riesgo.

## 7. Token opaco frente a JWT

Se elige token opaco.

Un JWT native permitiría verificar firma sin DB, pero el sistema de todos modos debe consultar usuario activo, roles actuales y `version_sesion` para revocación fuerte. Agregar denylist o tabla de refresh elimina su ventaja y aumenta el número de secretos, claims y rutas de rotación. No hay decenas de microservicios ni necesidad de validación distribuida.

El token opaco no revela usuario, rol ni fechas, se revoca con una fila, y usa la base PostgreSQL existente como fuente de verdad. Una consulta indexada por hash más join de usuario es suficiente para la escala prevista.

## 8. Sesión nativa elegida

### 8.1 Formato y entropía

- generar 32 bytes (256 bits) con CSPRNG del servidor;
- formato versionado sugerido `rspn1_<base64url-sin-padding>`;
- el prefijo permite reconocer formato y redactarlo, no es secreto;
- devolver el raw sólo una vez al cliente;
- nunca guardar raw, fragmentos ni suffixes en DB o logs.

### 8.2 Hash server-side

SHA-256 sin salt es criptográficamente suficiente contra fuerza bruta para un token uniforme de 256 bits; bcrypt no aporta valor y encarece cada request. Se recomienda **HMAC-SHA-256** con un pepper exclusivo `NATIVE_TOKEN_PEPPER` de al menos 32 bytes, separado de `FASTIFY_SECRET`, porque además evita aprovechar un dump aislado de DB para probar tokens obtenidos por otra vía.

La DB guarda los 32 bytes binarios del HMAC con índice único. La comparación de aplicación, si ocurre fuera de la igualdad indexada de PostgreSQL, será constante. Comprometer simultáneamente DB, runtime y pepper sigue permitiendo impersonación: ése es el riesgo residual normal de un backend comprometido.

### 8.3 TTL, renovación y rotación

Decisión de modelo: **una sesión nativa única**, sin access token corto y refresh token largo.

Valores iniciales recomendados, todos configurables y a confirmar con operación real:

| Valor | Recomendación | Naturaleza |
|---|---:|---|
| entropía | 256 bits | decisión mínima, no reducible |
| TTL absoluto | 30 días | default configurable futuro |
| actualización de `last_used_at` | como máximo una vez cada 15 min | optimización configurable |
| tickets WS | 30 s | default configurable, máximo corto |
| sesiones activas por usuario | 5 | límite operativo configurable |

No habrá refresh separado en el piloto: dos secretos persistentes aumentan superficie, código y estados de error, y el refresh largo sería en la práctica la verdadera sesión. La expiración absoluta exige reingresar password aproximadamente una vez al mes. No se extiende por estar offline ni por mero uso.

Rotación:

- un login nuevo emite un token nuevo y puede revocar la sesión activa anterior de la misma instalación dentro de la misma transacción;
- cambio de password, desactivación, cambio de rol con incremento de versión o logout global invalidan todas mediante `version_sesion`;
- logout de este dispositivo sólo marca su fila `revoked_at`;
- no se hará rotación automática por respuesta en cada request, porque una respuesta perdida en conectividad rural podría dejar cliente y servidor con tokens diferentes;
- si más adelante se requiere renovación silenciosa, deberá diseñarse como rotación transaccional idempotente con ventana acotada, no añadirse informalmente.

### 8.4 Por qué no access + refresh

Access corto reduce el tiempo de exposición en memoria, pero obliga a persistir un refresh más poderoso, agrega rotación, replay family, carreras de requests y recuperación ante respuesta perdida. Con DB consultada en cada request, un access JWT no reduce consultas. Para este sistema pequeño, el token único revocable con 30 días y carga breve en memoria ofrece mejor relación riesgo/complejidad. Esta decisión puede revisarse si aparecen clientes múltiples, IdP u obligaciones regulatorias.

## 9. Persistencia DB futura

Migración conceptual para RSP-09B; los nombres finales deben seguir el estilo SQL vigente:

```text
sesion_nativa
- id_sesion_nativa BIGSERIAL PRIMARY KEY
- id_usuario BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE
- token_hash BYTEA NOT NULL UNIQUE              -- exactamente 32 bytes
- installation_id UUID NOT NULL
- version_sesion_emitida INTEGER NOT NULL       -- > 0
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- expires_at TIMESTAMPTZ NOT NULL               -- > created_at
- last_used_at TIMESTAMPTZ NULL
- revoked_at TIMESTAMPTZ NULL
- revocation_reason TEXT NULL                   -- catálogo acotado, sin PII
- app_version TEXT NULL                         -- dato de soporte, no autenticación
```

Índices/constraints futuros:

- `UNIQUE(token_hash)` para lookup;
- índice parcial por `id_usuario` donde `revoked_at IS NULL` para listar/revocar;
- índice por `expires_at` para limpieza;
- índice `(id_usuario, installation_id)` para historial de instalación;
- checks de longitud hash, versión positiva y orden temporal;
- no hacer único global `installation_id`: no es secreto ni identidad fuerte y se conserva historial.

`last_used_at` es auditoría/soporte, no sliding expiry en el modelo inicial. Se actualiza con throttling para no escribir en cada request.

Para tickets WS se recomienda tabla separada `ticket_ws_nativo` con hash HMAC, `id_sesion_nativa`, `created_at`, `expires_at` y `used_at`; consumo atómico mediante `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING`. Evita depender de memoria de un único proceso y permite múltiples instancias futuras. Un job oportunista elimina expirados/consumidos.

## 10. Almacenamiento Android

No se permite `localStorage`, `sessionStorage`, IndexedDB, Preferences sin cifrar ni archivo plano.

Candidato principal para el spike de RSP-09C: `@aparajita/capacitor-secure-storage` **8.0.0**, MIT. La versión publicada el 2026-02-10 declara soporte Capacitor 8; en Android cifra con AES-GCM usando una clave generada en Android Keystore y guarda ciphertext en SharedPreferences. La documentación indica que uninstall elimina esos datos. No está instalado en RSP-09A.

Alternativas evaluadas:

- `@capawesome-team/capacitor-secure-preferences` 0.2.x declara soporte activo para Capacitor >=8 y Keystore, pero requiere suscripción/registry privado; es válido si se acepta el costo y soporte comercial;
- `capacitor-secure-storage-plugin` mantiene una línea Capacitor 8 y usa Keystore/SharedPreferences, pero el candidato principal presenta contrato y release 8 más claros;
- un plugin Android pequeño propio será preferible a almacenamiento inseguro si el candidato principal falla revisión, backup o pruebas en dispositivos; aumenta obligación de mantenimiento y no es primera opción;
- Identity Vault puede evaluarse si se compra soporte enterprise/biometría, pero no es necesario para el piloto.

Requisitos de aceptación antes de instalar:

- revisar implementación y dependencias fijadas, licencia y release notes;
- probar minSdk 23, Capacitor 8.0.0 y dispositivos reales objetivo;
- confirmar AES-GCM, alias/clave Keystore no exportable y manejo de corrupción;
- excluir explícitamente el archivo cifrado de cloud backup y device-to-device transfer con `fullBackupContent` y `dataExtractionRules` para APIs correspondientes;
- cambiar el manifest actual, que hoy tiene `allowBackup=true` sin exclusiones, antes del piloto;
- verificar que uninstall/clear data invalida almacenamiento local y genera un `installation_id` nuevo al reinstalar;
- verificar actualización in-place con el mismo appId y firma: debe conservar token; una incompatibilidad debe fallar cerrada y pedir login, nunca caer a storage plano;
- no habilitar implementación web del plugin: el servicio de auth debe comprobar plataforma nativa y fallar cerrado en browser/PWA.

El Keystore del candidato cifra en reposo, pero no se ha decidido exigir autenticación de usuario por cada lectura. Screen lock/biometría será hardening futuro. Un dispositivo desbloqueado, rooteado o un XSS dentro del proceso puede seguir usando la credencial.

## 11. Token accesible a JavaScript

Se elige inicialmente la opción A: el servicio native obtiene el token desde el plugin seguro al arrancar/reanudar, lo mantiene en un campo privado en memoria y un interceptor exclusivo native agrega `Authorization`. Nunca lo copia a estado reactivo, logs, errores, URL, DOM ni almacenamiento web.

La opción B —plugin nativo que retiene token y ejecuta toda request sin entregarlo a JS— reduce la extracción directa por XSS, pero no evita que un XSS invoque el plugin para realizar requests autorizadas y exfiltre respuestas. Además obliga a recrear interceptores, cancelación, multipart, blobs, PDF, progreso y errores, y no resuelve el WebSocket browser por sí sola. Para 1–2 usuarios el costo no es proporcional.

Mitigaciones obligatorias de la opción A en RSP-09C:

- CSP para los **assets locales** con `script-src 'self'` sin scripts remotos/eval y `connect-src` limitado al backend HTTPS/WSS configurado;
- recordar que la CSP de Nginx actual no protege el `index.html` empaquetado: habrá que agregar una meta CSP native o configuración equivalente;
- no cargar analytics, WebViews externas ni contenido HTML no confiable;
- acceso al plugin encapsulado y disponible sólo en runtime native;
- limpiar memoria en logout y no conservar múltiples copias;
- revisar todos los `console.*` y deshabilitar logging de producción Capacitor;
- tratar una vulnerabilidad XSS native como compromiso de sesión y permitir revocación inmediata.

## 12. Contrato API nativo propuesto

Rutas externas; Nginx seguirá retirando `/api/` al proxy:

### `POST /api/auth/native/login`

Request propuesto:

```json
{
  "email": "usuario@example.test",
  "password": "valor-no-registrado",
  "installation_id": "uuid-aleatorio-de-la-instalacion",
  "app_version": "valor-publico-opcional"
}
```

Respuesta 200 propuesta, con `Cache-Control: private, no-store`:

```json
{
  "token_type": "Bearer",
  "session_token": "raw-solo-en-esta-respuesta",
  "expires_at": "fecha-UTC",
  "user": { "dto_publico_actual": true }
}
```

Reglas:

- HTTPS obligatorio; producción rechaza cualquier origen backend HTTP por configuración/build;
- reutilizar `logUser`, bcrypt, cuenta activa y roles actuales;
- mismo mensaje/status genérico para email inexistente, inactivo o password inválido;
- usar el mismo pool de rate limit de login web, 10/min/IP como mínimo, y considerar segunda clave normalizada por email sin registrarlo en claro;
- no emitir `Set-Cookie`, CSRF ni JWT web;
- no aceptar token aportado por cliente ni permitir session fixation;
- `installation_id` es UUID aleatorio local, no secreto, no auth y no IMEI/serial/Advertising ID;
- transacción: validar, revocar sesión anterior de esa instalación según política, insertar hash y devolver raw;
- no incluir password o token en errores, tracing o métricas.

### Estado y logout

- `GET /api/auth/native/session`: autentica Bearer, devuelve usuario/roles actuales, expiración y quizá server time; se usa al recuperar conectividad/resume.
- `POST /api/auth/native/logout`: revoca sólo `id_sesion_nativa` actual, responde 204 de forma idempotente; el cliente borra secure storage después de respuesta o conserva una marca local de logout pendiente si no hay red.
- `POST /api/auth/native/logout-all`: acción explícita y confirmada; incrementa `version_sesion` y revoca web y todas las sesiones native. Debe documentar que también expulsa el navegador.
- no existe endpoint refresh en el MVP; al expirar se reautentica con password.

## 13. Resolver de autenticación y scope de endpoints

Se reutilizarán todos los endpoints de negocio. Sólo `/auth/native/*` es namespace separado. El futuro resolver ejecutará antes de CSRF:

1. si existe cualquier header `Authorization`, sólo acepta exactamente un esquema `Bearer` bien formado;
2. si también existe `rsp_session`, rechaza la combinación como credenciales ambiguas; el cliente native debe usar `credentials: 'omit'`;
3. valida el token native, expiry, revocación, usuario activo y `version_sesion`;
4. un Bearer ausente/malformado/inválido **nunca** cae a cookie;
5. si no existe Authorization, usa exactamente el `authenticate` cookie actual;
6. normaliza identidad y mecanismo (`web-cookie` o `native-bearer`) en request para guards, CSRF, logging y métricas.

Esto evita downgrade y token substitution. Los guards de rol/ownership no deben ramificarse por plataforma. Una ruta marcada sólo-web o sólo-native deberá declararlo explícitamente; health y preflight permanecen públicos según contrato.

CSRF debe consultar el mecanismo autenticado, no inferir únicamente presencia de cookie. El orden actual de hooks tendrá que refactorizarse con tests en RSP-09B, preservando bit a bit el comportamiento cookie observable.

## 14. CORS, Origin y CSRF

### 14.1 Web cookie

No cambia:

- same-origin productivo;
- credenciales permitidas para origins web explícitos;
- header `X-CSRF-Token`;
- mutaciones exigen Origin web allowlisted y double-submit CSRF;
- WS exige exactamente `PUBLIC_ORIGIN`.

### 14.2 WebView native con Bearer

Configuración futura separada, por ejemplo `NATIVE_CORS_ORIGINS`, sin mezclarla en `CORS_ORIGINS`. Para la configuración actual el único origin empaquetado esperado es `https://localhost`.

Política exacta propuesta:

| Campo | Native |
|---|---|
| allowed origins | lista exacta; producción inicialmente `https://localhost` |
| methods | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| allowed headers | `Authorization, Content-Type` y sólo headers funcionales auditados |
| exposed headers | `Content-Disposition, X-Request-Id` si el frontend los necesita |
| credentials | `false`; omitir `Access-Control-Allow-Credentials` |
| wildcard | nunca |
| preflight | público, validado por origin/ruta/headers, con `Vary` correcto |

Bearer no se envía automáticamente por el navegador, así que el CSRF tradicional que fuerza una request con credencial ambiental no aplica igual. Las mutaciones autenticadas como `native-bearer` no exigirán cookie/header CSRF. Esto **no elimina CSRF globalmente**: la rama cookie conserva el control actual.

Origin es defensa adicional, no autenticación:

- fetch del WebView debe traer exactamente el origin native permitido;
- un Origin presente pero distinto se rechaza incluso con Bearer;
- Capacitor/native HTTP puede omitir Origin; se permite su ausencia sólo en el canal native correctamente autenticado o en login native sujeto a rate limit, porque clientes no-browser no pueden demostrar identidad con Origin;
- una app maliciosa puede falsificar/omitir Origin en HTTP nativo, por lo cual el Bearer sigue siendo el único factor de sesión;
- jamás se agregará `https://localhost` indiscriminadamente a la allowlist web o WS web.

El login native desde WebView requiere preflight/origin native aunque todavía no tenga Bearer. Un cliente HTTP nativo sin Origin puede llamar al login, pero sólo con password válido, TLS y rate limit; no hay credencial ambiental que habilite CSRF.

## 15. WebSocket nativo

El browser API `WebSocket` no permite agregar libremente `Authorization`. Nunca se pondrá la sesión Bearer de 30 días en query string.

### Alternativas

| Mecanismo | Ventaja | Riesgo/costo | Decisión |
|---|---|---|---|
| ticket efímero en query | simple con API/browser y librerías actuales | query puede aparecer en capas no auditadas | elegido con ticket de un uso, 30 s y redacción |
| `Sec-WebSocket-Protocol` | evita query visible | mezcla credencial con negociación, puede registrarse/eco, sintaxis limitada | no elegido inicialmente |
| primer frame autenticado | no usa query | socket no autenticado, timeout/DoS/estado extra | reserva, no elegido |

### Flujo elegido

```text
POST /api/auth/native/ws-ticket
Authorization: Bearer <sesion>
        -> { ticket: <256 bits>, expires_at: +30 s }

new WebSocket("wss://backend.example/ws?ticket=<efimero>")
        -> consumo atomico single-use
        -> conexión asociada a usuario + id_sesion_nativa + version_sesion
```

Reglas:

- ticket de 256 bits, raw sólo en respuesta y query, HMAC en DB;
- TTL recomendado 30 s, un único uso y consumo atómico antes de enviar eventos;
- query, errores, proxy, Fastify y Android logs deben redactarlo; Nginx actual usa `$uri`, pero la defensa no dependerá sólo de eso;
- Origin native exacto si el WebView lo envía; nunca autentica por sí solo;
- `/ws` cookie conserva `Origin === PUBLIC_ORIGIN` y auth web actual;
- handshake con ticket inválido/usado/expirado falla sin fallback a cookie;
- al reconectar se solicita ticket nuevo; nunca se reusa;
- logout de dispositivo cierra conexiones de esa sesión; logout global/desactivación/version change cierra todas las del usuario;
- heartbeat de 30 s se conserva y puede revalidar revocación/version, además de cierre dirigido por eventos locales;
- límites propuestos: máximo 30 tickets/min por sesión/IP, pocos tickets simultáneos y máximo 2 conexiones por sesión, configurables.

## 16. Revocación, `version_sesion` y autorización

Cada fila native guarda `version_sesion_emitida`. En cada autenticación se consulta sesión y usuario en una query indexada y se exige:

- `revoked_at IS NULL`;
- `expires_at > now()`;
- usuario existente, activo y con cuenta de acceso;
- versión emitida igual a `usuario.version_sesion`;
- roles/ownership actuales en los guards existentes.

Esto da revocación inmediata para usuario desactivado/eliminado, password/rol que incremente versión y logout global. El costo de una query por request ya existe para web y es aceptable; se medirá e indexará antes de optimizar. No se cacheará un usuario activo durante minutos porque abriría una ventana de revocación.

Semántica UX:

- **Cerrar sesión en este dispositivo:** revoca sólo la fila native actual. No incrementa versión.
- **Cerrar todas las sesiones:** incrementa `version_sesion`; revoca web y todos los dispositivos. Debe advertirse explícitamente.
- **Logout web actual:** sigue incrementando `version_sesion`, por tanto también revocará Android. Se conserva por contrato.
- **Administración:** desactivar/eliminar/cambiar roles relevantes invalida en el siguiente request y cierra WS al detectarse.

Una sesión puede conservar metadatos de instalación para que el usuario/admin vea y revoque dispositivos, pero `installation_id` nunca concede acceso.

## 17. Rate limiting y logs

RSP-09B debe mantener el limitador global y evitar un bypass mediante rutas native:

- login web y native comparten como mínimo 10 intentos/min/IP;
- agregar límite por identificador de cuenta normalizado/hasheado cuando sea posible, sin enumeración;
- requests normales consumen límite por IP y, una vez autenticadas, límite por sesión/usuario;
- WS ticket consume API general más límite específico;
- upgrades/conexiones WS tienen cupo propio;
- si se escala a múltiples instancias, el limiter en memoria deberá sustituirse por estado compartido; no es necesario para el piloto de una instancia.

Redacción futura mínima:

- todos los casing/aliases de `Authorization`;
- `session_token`, `refresh_token` aunque no se use, `native_token`, `ws_ticket` y `ticket`;
- query de WS en serializers, reverse proxy, exceptions y métricas;
- body completo de ambos logins o como mínimo email/password;
- Android Logcat, WebView console, crash reports y herramientas de red.

Los logs sólo necesitan request id, ruta parametrizada, mecanismo (`web-cookie`/`native-bearer`), id interno de sesión si es útil, status y duración. Nunca raw/hash parcial utilizable.

## 18. Fotos, uploads, PDF y Maps

Bearer se agrega a todos los transports de negocio, no sólo JSON:

- Angular `HttpClient`/fetch normal para JSON y multipart de foto (máximo binario actual 5 MB);
- `Authorization` acompaña `FormData` sin fijar manualmente el boundary;
- fotos protegidas se descargan como Blob con el mismo header;
- PDF se descarga como binario y se preservan `Content-Type`, `Content-Disposition`, timeouts y rate limit;
- los JSON con foto base64 existentes siguen bajo sus límites actuales;
- Maps continúa exclusivamente server-side; no se incorpora API key al APK;
- si se adopta `CapacitorHttp`/File Transfer para archivos grandes, debe aceptar el mismo Bearer desde el servicio de auth y demostrar cancelación, errores, TLS y redacción. No se crea cookie bridge.

La prueba end-to-end de RSP-09C debe cubrir CRUD de pozo, propietarios, sitios, upload/replace/delete/download de foto y PDF en dispositivo, no sólo `/session`.

## 19. Conectividad, lifecycle y APK

### 19.1 Offline y reconexión

```text
sin red
  -> conservar secure storage y usuario cacheado marcado "sin conexión"
  -> no interpretar timeout/DNS como token inválido
  -> conservar borradores/operaciones pendientes

vuelve red
  -> GET /auth/native/session
  -> reanudar cola sólo si sesión válida

401 definitivo por expirada/revocada/version
  -> detener sync, conservar borradores locales no sensibles
  -> borrar token y pedir login
```

Un request a mitad puede haber sido aplicado aunque el cliente no reciba respuesta; autenticación no resuelve duplicados. Las mutaciones offline futuras necesitarán claves de idempotencia y reconciliación en RSP-09F.

El cliente conoce `expires_at`, pero no borra la credencial por reloj local o falta de red. Al recuperar conexión, el servidor decide. Si el token expiró offline, la UI pide login antes de enviar la cola y nunca elimina borradores.

### 19.2 Background, resume y reboot

- al cold start/reboot/process kill, leer una vez desde secure storage, cargar en memoria y validar cuando haya red;
- en resume tras horas/días, comprobar red y estado si pasó un umbral configurable o se acerca expiry;
- en background no hacer refresh inexistente; minimizar trabajo y limpiar referencias no necesarias sin borrar storage;
- en logout confirmado, limpiar memoria y storage; si se pulsa logout offline, bloquear uso local, registrar una revocación pendiente no secreta y enviar al volver la red antes de borrar definitivamente el raw necesario para revocar;
- no colocar token en singleton de estado serializable, Redux/devtools, signals públicas ni service worker.

### 19.3 Robo, root y biometría

Keystore reduce extracción en reposo, no hace imposible usar una sesión en un teléfono desbloqueado o comprometido. Mitigaciones: TTL 30 días, logout por dispositivo, logout global, revocación administrativa inmediata, TLS, no backup, CSP y no logs. No se implementará root detection invasivo.

Screen lock/biometría puede añadirse para desbloquear localmente la lectura después del piloto, con fallback a device credential y recuperación bien diseñada. No bloquea MVP porque el plugin elegido no necesita prometer user-auth-bound keys en esta fase.

### 19.4 TLS y pinning

Producción sólo acepta `https://` y `wss://`, validado por Android con su trust store. Para el piloto no se recomienda certificate pinning: añade riesgo de inutilizar APKs al renovar/cambiar certificado y exige pin backup/rotación coordinada. Queda como hardening futuro si el threat model operacional demuestra MITM con CA comprometida como riesgo superior al de disponibilidad.

### 19.5 Actualización y versión mínima

Una actualización firmada con la misma clave/appId debe conservar secure storage y sesión. Un cambio de formato debe migrar atómicamente o pedir login. El servidor puede responder un error tipado (por ejemplo 426) si `app_version` está por debajo de `MIN_NATIVE_APP_VERSION`; la versión no autentica ni autoriza.

No se propone live update remoto en esta etapa. Una vulnerabilidad crítica se atiende revocando sesiones/version y exigiendo APK mínimo, sin depender de que el token sobreviva indefinidamente.

## 20. Entornos y reintroducción futura del build native

RSP-09C podrá reintroducir un target explícito sólo después del backend RSP-09B y tests end-to-end:

- `development`: backend local/LAN controlado; preferir HTTPS con CA de desarrollo instalada. Cualquier cleartext debe existir sólo en flavor debug y nunca ser fallback;
- `staging`: origin HTTPS específico y app/flavor inequívocamente staging;
- `production`: origin HTTPS exacto, appId final y firma release controlada.

Variable pública conceptual: `NATIVE_BACKEND_ORIGIN`. El build deriva `/api/` y `/ws`; no acepta paths/credentials/query. Fail-fast productivo si:

- falta la variable;
- protocolo no es HTTPS;
- host es localhost, `.localhost`, IP/LAN o coincide con staging;
- `appId` sigue siendo `com.example.app`;
- existe cleartext/mixed content, `server.url` o debugging/logging productivo;
- backend no anuncia versión de contrato native compatible;
- el bundle contiene un origin distinto del único esperado.

Tests de artifact deben probar que web sigue `/api/` y `/ws` same-origin y que sólo el target native contiene el origin público no secreto correcto. No se reintroduce este flujo en RSP-09A.

## 21. Threat model

| Amenaza | Mitigación diseñada | Riesgo residual |
|---|---|---|
| brute force de password | error genérico, bcrypt actual, cuenta activa, mismo límite 10/min y límite por cuenta/IP | ataque distribuido; monitoreo y posible backoff futuro |
| robo de Bearer | Keystore/AES-GCM, memoria breve, TLS, no logs, TTL y revocación | dispositivo/root/XSS activo puede usarlo |
| robo de refresh | no existe refresh separado | el token de sesión sigue siendo credencial de 30 días |
| XSS en WebView | CSP local estricta, sin scripts remotos/eval, encapsular plugin, no storage web | JS autorizado comprometido puede pedir token o actuar como usuario |
| app maliciosa | sandbox/Keystore, no deep-link con token, Bearer aleatorio | puede imitar Origin en HTTP nativo; no posee token/password salvo compromiso externo |
| MITM | HTTPS/WSS y validación Android; nunca cleartext producción | CA/dispositivo comprometido; pinning diferido |
| replay de token | TLS, HMAC lookup, TTL, revocación, rotación en login | un token robado es replayable hasta revocación/expiry |
| dispositivo robado | secure storage, listado/revocación de sesión, 30 días, logout global | teléfono desbloqueado puede operar hasta revocación |
| secretos en logs | redacción proxy/Fastify/app/Android, no query principal | crash SDK o log nuevo mal configurado requiere regresión continua |
| backup/migración | excluir storage cifrado e installation id de backup/D2D | OEM puede variar; probar dispositivos/API 23/31+ |
| replay ticket WS | 256 bits, HMAC, 30 s, single-use atómico | atacante que lo roba antes del consumo puede ganar la carrera |
| confusión CORS | allowlists web/native separadas, exactas, sin wildcard | CORS no limita clientes native fuera de browser |
| confusión CSRF | branching por mecanismo autenticado; cookie conserva double-submit | bug de orden de hooks; cubrir matriz exhaustiva |
| session fixation | servidor genera token, no acepta valor cliente, rotación transaccional | malware con control de proceso puede sustituir estado local |
| token substitution | formato estricto, HMAC, relación a sesión/usuario/version, ambas credenciales rechazadas | compromiso backend/pepper |
| downgrade cookie/Bearer | Authorization presente nunca cae a cookie; mezcla rechazada | rutas que omitan resolver; inventario/test obligatorio |
| usuario desactivado offline | no hay acceso server-side offline; al volver se valida antes de sync | datos ya cacheados siguen visibles según política local futura |
| rol removido | roles actuales y `version_sesion` en cada request | datos cacheados requieren política offline futura |
| request duplicado al reconectar | futuro idempotency key/cola; no reintentar mutaciones ciegamente | RSP-09A no implementa sync offline |
| APK obsoleto/vulnerable | versión mínima server-side, revocación y build fail-fast | distribución/actualización manual puede demorar |
| Bearer en query WS | bearer principal nunca va en query; sólo ticket redactado y efímero | infraestructura externa debe auditarse también |

Riesgo aceptado para piloto: un Android rooteado, un proceso comprometido o XSS con acceso al bridge puede actuar como el usuario. La respuesta proporcionada es limitar exposición, detectar/revocar y actualizar, no prometer invulnerabilidad.

## 22. Pruebas y roadmap ejecutable

### Evidencia/spike de RSP-09A

No se agregó un spike duplicado al runtime. La evidencia aislada existente ya demuestra:

1. `cookie-auth.integration.test.ts`: `onlyCookie` acepta cookie y rechaza Bearer; cookies y CSRF mantienen contrato;
2. `proxy-origin.test.ts`: mutaciones de origin no permitido y WS con origin distinto al canónico se rechazan; preflight sólo funciona con allowlist actual;
3. `production-contract.test.mjs` y `test-production-build.mjs`: web conserva `/api/` y `/ws`, no existe target/config native productivo;
4. fuente instalada de Capacitor 8: origin por defecto `https://localhost` y HTTP patch apagado;
5. API browser `WebSocket(url, protocols?)`: el frontend/librerías actuales no ofrecen header Authorization; el ticket funciona con query y el servidor `@fastify/websocket` actual puede inspeccionar request antes de registrar conexión.

Crear rutas/test doubles de tokens sin el resolver definitivo habría parecido una implementación parcial. Se optó por especificar contratos verificables para RSP-09B.

### Tests obligatorios RSP-09B

- migración fresh/upgrade/rerun y constraints/índices;
- token CSPRNG/formato, HMAC y ausencia raw en DB/log;
- login activo/inactivo/inexistente/password/rol con error no enumerable y rate limit compartido;
- no `Set-Cookie` ni CSRF en login native;
- matriz cookie, Bearer, ambos, Bearer inválido y Authorization no Bearer sin fallback;
- expiry, revoked_at, usuario eliminado/inactivo, cambio `version_sesion` y roles actuales;
- logout dispositivo frente a logout-all y logout web;
- CORS preflight native exacto, evil origin, ausencia Origin native HTTP y web congelada;
- CSRF web intacto y Bearer explícitamente exento;
- redacción de todas las superficies;
- inventario automático: todo endpoint protegido usa el resolver común;
- multipart, foto, PDF y respuestas binarias autenticadas con Bearer.

### Roadmap

1. **RSP-09B — backend native auth:** migración, HMAC/pepper, login/session/logout/logout-all, resolver dual, branching CSRF/CORS/Origin, rate limits, redaction y tests; sin cliente productivo.
2. **RSP-09C — cliente Capacitor:** auditar/instalar secure storage, transport Bearer, CSP local, backup rules, lifecycle, configuración por entorno y pruebas de JSON/multipart/blob/PDF. Recién entonces reintroducir build native controlado.
3. **RSP-09D — WebSocket native:** tabla/endpoint de tickets, consumo single-use, origin branch, cierre por revocación, heartbeat/reconnect y tests de replay/carreras.
4. **RSP-09E — APK piloto:** appId/firma, dispositivo real API 23 y moderno, cámara/GPS/red, instalación/upgrade/uninstall, staging y production fail-fast; sin Google real en CI.
5. **RSP-09F — resiliencia offline:** drafts cifrados si contienen datos sensibles, cola/idempotencia, conflictos, reintentos y UX rural.

### Decisiones descartadas explícitamente

- no cookies web cross-origin ni `SameSite=None`;
- no `server.url` productivo;
- no cookie bridge;
- no JWT native;
- no access+refresh en el piloto;
- no bearer principal en query/subprotocol/primer frame WS;
- no wildcard CORS ni Origin como autenticación;
- no CSRF deshabilitado para cookie web;
- no localStorage/Preferences plano;
- no IMEI, serial o advertising ID;
- no pinning, biometría o root detection como bloqueo inicial;
- no API de negocio duplicada en `/api/native`;
- no build/APK productivo en RSP-09A.

### Riesgos/decisiones pendientes antes del piloto

- revisión de código y prueba física del plugin secure storage 8.0.0;
- appId, firma y mecanismo de distribución finales;
- dominio real de staging/producción y CA de desarrollo;
- defaults operativos finales de TTL, cupos y versión mínima;
- contenido offline permitido y protección de drafts;
- comportamiento de logout offline y UX de reautenticación;
- inventario de cualquier infraestructura externa que pueda registrar query WS;
- ventana actual de una conexión WS web ya abierta después de logout/version change, a cerrar o revalidar con pruebas en RSP-09D;
- observabilidad/alertas para revocaciones y brute force sin PII.

## Fuentes externas consultadas

- Capacitor v8 configuration: https://capacitorjs.com/docs/config
- Capacitor v8 HTTP API: https://capacitorjs.com/docs/apis/http
- Capacitor security guidance: https://capacitorjs.com/docs/guides/security
- Android backup security: https://developer.android.com/privacy-and-security/risks/backup-best-practices
- candidato secure storage: https://github.com/aparajita/capacitor-secure-storage
- alternativa Capawesome: https://capawesome.io/docs/plugins/secure-preferences/

Las fuentes externas sólo apoyan comportamiento de plataforma/plugins. La decisión se basa además en el código, locks, proyecto Android y tests de este repositorio auditados en el HEAD indicado.
