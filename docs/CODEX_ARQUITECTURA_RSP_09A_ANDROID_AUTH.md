# RSP-09A — Arquitectura de autenticación Mobile/Native (Android + iOS)

Fecha de cierre arquitectónico: 2026-08-24
Generalización RSP-09A-R1: 2026-08-26
Corrección RSP-09A-R2: 2026-08-26
Corrección RSP-09A-R3: 2026-08-26
Rama auditada: `feature/rsp-09-android-auth`
Base y HEAD inicial: `14df7c0a7fa300a76df9646405eddfa4d247c0b3`
HEAD inicial de RSP-09A-R1: `ad4b86acfc90d075733f13ee766be128fad1bc93`
HEAD inicial de RSP-09A-R2: `976e802d384e05338e0871e8ef7f7261f529c26c`
HEAD inicial de RSP-09A-R3: `7193a4cb14661617389899a069f82c0ea578e6ce`

## 1. Resumen y decisión

RSP-09A no cambia el runtime. Define dos canales de autenticación independientes que convergen, después de autenticar, en la autorización de negocio existente:

```text
WEB
https://dominio/ + /api/ + /ws
        |
        `-- cookie rsp_session HttpOnly + rsp_csrf + Origin web

MOBILE/NATIVE (un cliente y un backend compartidos)
        |
        |-- Android: assets en https://localhost
        |-- iOS:     assets en capacitor://localhost
        |
        `-- Authorization: Bearer <sesión opaca nativa común>
               |
               `-- identidad normalizada -> roles y ownership existentes
```

RSP-09A nació para resolver Android, pero su diseño final es **Mobile/Native** y cubre Android e iOS sin crear dos sistemas de autenticación. La arquitectura recomendada es una **sesión nativa opaca única, aleatoria, revocable y con expiración server-side**, no JWT y no pareja access/refresh en el piloto. La aplicación compartida conservará la credencial persistente en almacenamiento seguro respaldado por Android Keystore o iOS Keychain, la cargará en memoria sólo cuando sea necesaria y la enviará explícitamente en `Authorization`. Web continúa sin cambios con cookie HttpOnly, doble submit CSRF y same-origin.

Los handlers de pozos, propietarios, sitios, fotos, informes y catálogos no se duplicarán. Un resolver de autenticación futuro distinguirá explícitamente cookie web y Bearer nativo, y entregará a los guards actuales la misma identidad `sub`. Sólo login, estado de sesión, logout y ticket WebSocket tendrán namespace nativo.

Esta decisión cumple el objetivo de revocación inmediata usando PostgreSQL y `version_sesion`, evita credenciales ambientales y third-party cookies, funciona con `fetch`, multipart y binarios, y deja una base compatible con conectividad intermitente y futuros borradores offline.

## 2. Alcance y restricciones congeladas

En RSP-09A/R1/R2/R3 no se crean rutas, tokens, tablas ni builds mobile productivos. Tampoco se instala un plugin ni se genera el proyecto iOS. Quedan congelados:

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

La URL del backend incluida en un APK/IPA futuro será configuración pública, nunca un secreto. Contraseñas, tokens, pepper, claves de firma y credenciales de terceros no se incorporarán al bundle.

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

## 4. Entorno Capacitor Mobile real

### 4.1 Base compartida y Android actual

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

### 4.2 Estado iOS y requisitos de Capacitor 8

El estado del repositorio en RSP-09A-R1 es inequívoco:

- no existe `front/ios/`;
- `@capacitor/ios` no figura en `front/package.json`, `front/package-lock.json` ni `front/node_modules`;
- no se ejecutó `npx cap add ios`, no hay proyecto Xcode, workspace, scheme, provisioning profile ni build iOS;
- la ausencia es esperada: R1 sólo generaliza el contrato y no intenta generar la plataforma.

Capacitor 8 soporta iOS 15 o posterior y, según su documentación v8 vigente al 2026-08-26, requiere Node.js 22+, macOS, Xcode 26.0+ y Xcode Command Line Tools para crear, compilar y probar el target iOS. Swift Package Manager es el gestor recomendado; CocoaPods sigue siendo una alternativa cuando una dependencia lo exige. Windows puede desarrollar y probar el código Angular/TypeScript compartido, contratos HTTP/WS, schemas, fixtures, lógica offline y configuración pública, pero **no puede producir directamente un build iOS firmado/productivo ni sustituir pruebas en Xcode, simulador y iPhone**.

Una etapa posterior en macOS/Xcode deberá instalar una versión de `@capacitor/ios` alineada con core 8, ejecutar controladamente `cap add/sync ios`, fijar bundle ID y firma, integrar plugins, declarar permisos/privacy manifest, compilar y probar en iPhone. RSP-09E prepara ese trabajo; la creación y distribución iOS efectiva se cerrará sólo cuando exista el entorno Apple autorizado.

### 4.3 Origins nativos concretos

`capacitor.config.ts` no define `server.hostname`, `server.androidScheme`, `server.iosScheme` ni `server.url`. Los defaults documentados por Capacitor 8 son `hostname=localhost`, `androidScheme=https` e `iosScheme=capacitor`. Por tanto, con assets empaquetados y la configuración actual, la matriz prevista es:

| Plataforma | Scheme | Host | Origin enviado por WebView |
|---|---|---|---|
| Android | `https` | `localhost` | `https://localhost` |
| iOS | `capacitor` | `localhost` | `capacitor://localhost` |

La allowlist native futura debe contener sólo esos valores exactos para los targets que realmente se distribuyan. No se asumirá que ambos sistemas exponen el mismo scheme, no se aceptarán variantes como `http://localhost`, `ionic://localhost`, puertos arbitrarios ni wildcard, y cualquier override futuro exigirá actualizar configuración, contrato y tests juntos. RSP-09A-R1 no toca la allowlist productiva.

## 5. Por qué la cookie web no se reutiliza directamente

Supuestos analizados:

```text
assets Android: https://localhost
assets iOS:     capacitor://localhost
fetch:   https://backend.example/api/
ws:      wss://backend.example/ws
```

| Control | Resultado con el contrato actual |
|---|---|
| Origin HTTP | el WebView envía el origin de su plataforma (`https://localhost` o `capacitor://localhost`); producción no los permite hoy y la mutación se rechaza |
| Preflight | JSON, `X-CSRF-Token` o futuro `Authorization` disparan OPTIONS; el origin no está permitido y `Authorization` ni integra los headers actuales |
| CORS | `credentials: true` no concede acceso sin allowlist exacta; `*` sería inválido con credenciales y no se propone |
| Cookie host-only | pertenece a `backend.example`; no es cookie del origin local mobile |
| SameSite=Lax | localhost y backend son cross-site; una cookie Lax no acompaña un `fetch` cross-site subresource aunque se use `credentials: include` |
| Third-party cookies | su aceptación depende de WebView, OS y políticas del usuario; no es base estable para autenticación |
| HttpOnly | correctamente impide que JS extraiga `rsp_session`; por tanto no puede convertirla en header |
| Double-submit CSRF | JS del origin local mobile no puede leer la cookie `rsp_csrf` host-only de `backend.example`, así que no puede producir el header esperado |
| `withCredentials` | solicita cookies pero no supera SameSite, host scope, third-party policy, CORS ni Origin |
| WebSocket | el API browser no permite fijar libremente `Authorization`; el Origin sería el local de Android/iOS y el servidor sólo acepta `PUBLIC_ORIGIN` |

Ampliar la allowlist no arregla las cookies ni CSRF. Cambiar a `SameSite=None`, sincronizar cookies o desactivar CSRF debilitaría el contrato web y seguiría dependiendo de third-party cookies. Por eso no se hará un bypass.

## 6. Alternativas evaluadas

| Alternativa | Seguridad web | Revocación/operación | Offline y binarios | Resultado |
|---|---|---|---|---|
| A. cookies web cross-origin | obliga a rediseñar SameSite, CSRF, CORS y Origin; depende de cookies ambientales | posible, pero frágil en WebView | fetch binario funciona si las cookies funcionan | descartada |
| B. `server.url` con web remota | conserva same-origin si carga toda la app remota, pero transforma el build mobile en un contenedor de código remoto | sesión web actual | sin arranque útil offline; cada pantalla depende de red | descartada para producción |
| C. HTTP nativo + cookie bridge | duplica/sincroniza jars, dificulta preservar HttpOnly y double-submit | logout y cookies quedan repartidos | multipart/PDF necesitan caminos especiales; WS queda sin resolver | descartada |
| D. Bearer nativo | separa claramente el canal sin tocar cookies web | revocación inmediata server-side | fetch, multipart, Blob y futuros drafts son compatibles | **recomendada** |
| E. OAuth/OIDC con Authorization Code + PKCE | arquitectura estándar si existiera un IdP | buena revocación según proveedor | buena UX potencial | reservar si se incorpora identidad central; hoy añade IdP y complejidad sin necesidad |

### A. Cookies web cross-origin

No se recomienda aunque parezca requerir menos backend. Exige `SameSite=None; Secure` o una topología especial, cookies de terceros habilitadas, CORS con credenciales, un nuevo transporte CSRF y una rama WS. Hace depender la app de comportamiento variable de Android System WebView/WKWebView y amplía la superficie web.

### B. `server.url` / web remota

Capacitor documenta `server.url` para live reload y dice que no está pensado para producción. Elimina la ventaja de assets empaquetados, impide una evolución offline fiable, ata el arranque a red y permite que cambios de servidor alteren el código servido sin actualización del build mobile. No se usará como workaround.

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

Para tickets WS se recomienda una tabla separada ligada inequívocamente a la sesión padre:

```text
ticket_ws_nativo
- id_ticket_ws_nativo BIGSERIAL PRIMARY KEY
- id_sesion_nativa BIGINT NOT NULL REFERENCES sesion_nativa(id_sesion_nativa) ON DELETE CASCADE
- ticket_hash BYTEA NOT NULL UNIQUE             -- HMAC de 32 bytes
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- expires_at TIMESTAMPTZ NOT NULL               -- TTL corto, ~30 s configurable
- used_at TIMESTAMPTZ NULL
```

El cliente presenta un único ticket raw; el servidor calcula su HMAC según la decisión arquitectónica existente y busca **sólo** el `ticket_hash` resultante. Nunca persiste, selecciona ni registra el raw. La unicidad de `ticket_hash` garantiza que una redención devuelve como máximo una fila.

El consumo conceptual debe incluir, como mínimo:

```sql
UPDATE ticket_ws_nativo AS t
SET used_at = now()
FROM sesion_nativa AS s
JOIN usuario AS u ON u.id_usuario = s.id_usuario
WHERE t.ticket_hash = $HASH_PRESENTADO
  AND t.used_at IS NULL
  AND t.expires_at > now()
  AND s.id_sesion_nativa = t.id_sesion_nativa
  AND s.revoked_at IS NULL
  AND s.expires_at > now()
  AND u.activo = TRUE
  AND u.cuenta_acceso = TRUE
  AND s.version_sesion_emitida = u.version_sesion
RETURNING t.id_ticket_ws_nativo, s.id_sesion_nativa, u.id_usuario;
```

Es pseudocódigo arquitectónico: los nombres finales seguirán el schema real y la autorización/ownership existente. La invariante no cambia: `ticket_hash = $HASH_PRESENTADO`, single-use, expiración y validez de la sesión padre se evalúan en una operación atómica o en una transacción con locking equivalente sobre ticket/sesión/usuario. Queda prohibido `SELECT` y luego `UPDATE` si dos handshakes pueden observar el ticket sin usar. Dos redenciones simultáneas del mismo raw producen exactamente un éxito y un rechazo; dos tickets distintos no se consumen entre sí.

Cero filas significa ticket inexistente, usado, expirado o sesión padre inválida/revocada indirectamente y siempre rechaza el handshake; nunca se busca o consume otro ticket. Un job oportunista puede eliminar tickets expirados/consumidos, pero la seguridad no depende del borrado físico.

### 9.1 `installation_id` multiplataforma

Android e iOS usarán exactamente el mismo concepto: un UUID v4 aleatorio generado por la propia app al inicializar una instalación. No es secreto, factor de autenticación, identidad de persona ni prueba criptográfica del dispositivo. Se envía para asociar/reemplazar la sesión de esa instalación y para soporte/revocación, pero sólo el Bearer acredita la sesión.

Quedan prohibidos IMEI, Android ID como autenticación, serial, MAC, IDFA y cualquier identificador Apple de tracking. El UUID se guarda separado del token en almacenamiento privado local, excluido de backup y transferencia entre dispositivos. En una actualización in-place con el mismo appId/bundle ID permanece; tras borrar datos o uninstall/reinstall se genera uno nuevo. En iOS el Keychain puede sobrevivir al uninstall: si reaparece un token sin el `installation_id` correspondiente, el cliente debe borrar ese token residual y exigir login, nunca adoptar la sesión de la instalación anterior. Una restauración o migración que produzca token/UUID inconsistentes también falla cerrada y crea una instalación nueva.

El servidor no hace `installation_id` único global, no confía en su estabilidad y conserva historial. Un atacante que conozca o copie el UUID no puede autenticar sin el token/password.

## 10. Secure storage Mobile/Native

No se permite `localStorage`, `sessionStorage`, IndexedDB, Preferences sin cifrar ni archivo plano.

Candidato principal para el spike de RSP-09C: `@aparajita/capacitor-secure-storage` **8.0.0**, MIT. La versión publicada el 2026-02-10 declara soporte Capacitor 8 y el repositorio mantiene implementaciones, demo y verificación para Android e iOS mediante CocoaPods y Swift Package Manager. En Android cifra con AES-GCM usando una clave generada en Android Keystore y guarda ciphertext en SharedPreferences; en iOS usa el Keychain cifrado del sistema. No está instalado en RSP-09A-R1.

El candidato sigue siendo razonable para ambas plataformas, pero no se aprueba a ciegas:

- **Android:** Keystore protege la clave no exportable y uninstall elimina el almacenamiento de la app en condiciones normales. El manifest actual tiene `allowBackup=true` sin reglas; copiar ciphertext/SharedPreferences sin su clave puede causar restauración corrupta, y ninguna sesión ligada a una instalación debe transferirse. RSP-09C debe identificar el archivo exacto y excluir tanto token cifrado como `installation_id` de Auto Backup y device-to-device mediante `dataExtractionRules`/`fullBackupContent`, o justificar `allowBackup=false` para todo el producto;
- **iOS:** Keychain puede persistir después de desinstalar y su semántica cambia según accessibility, backup y `synchronizable`. El plugin permite sync iCloud y su default documentado de accessibility es `whenUnlocked`, que puede migrar con backups cifrados. Para este contrato, RSP-09C debe mantener `synchronizable=false` y probar una clase `ThisDeviceOnly`, inicialmente `whenUnlockedThisDeviceOnly`; `whenPasscodeSetThisDeviceOnly` es más restrictiva pero cambia disponibilidad y borra el ítem si se quita el passcode. La elección final debe probar foreground/resume/restart y no prometer background services;
- **binding:** el token no debe migrar a otro teléfono. Si Keychain/backup conserva una credencial pero el identificador local no coincide, el cliente la elimina y reautentica. El backend sigue validando fila, expiry, revocación y `version_sesion`; `installation_id` no se convierte en un segundo secreto;
- **mantenimiento/licencia:** la línea 8.0.0 es reciente, MIT y declara soporte explícito de Capacitor 8, pero es un plugin comunitario con concentración de mantenimiento. Antes de fijarlo deben revisarse source, dependencias transitivas, issues/releases, lockfile, builds reproducibles y dispositivos reales de ambos sistemas.

Alternativas evaluadas:

- `@capawesome-team/capacitor-secure-preferences` 0.2.x declara soporte activo para Capacitor >=8 y Keystore, pero requiere suscripción/registry privado; es válido si se acepta el costo y soporte comercial;
- `capacitor-secure-storage-plugin` mantiene una línea Capacitor 8 y usa Keystore/Keychain, pero el candidato principal presenta contrato de accessibility/sync y release 8 más claros;
- un plugin nativo mínimo propio, con Android Keystore e iOS Keychain, será preferible a almacenamiento inseguro si el candidato falla revisión, backup o pruebas; aumenta obligación de mantenimiento y no es primera opción;
- Identity Vault puede evaluarse si se compra soporte enterprise/biometría, pero no es necesario para el piloto.

Requisitos de aceptación antes de instalar:

- revisar implementación y dependencias fijadas, licencia y release notes;
- probar minSdk 23, iOS soportado por Capacitor 8, core 8.0.0 y dispositivos reales objetivo;
- confirmar Android AES-GCM/Keystore y iOS Keychain/accessibility/sync, además del manejo de corrupción;
- excluir explícitamente token e installation ID de backup/cloud/device-to-device en ambas plataformas;
- cambiar el manifest Android actual, que hoy tiene `allowBackup=true` sin exclusiones, antes del piloto;
- verificar que uninstall/clear data invalida almacenamiento local y genera un `installation_id` nuevo al reinstalar;
- verificar en iOS que un ítem Keychain sobreviviente al uninstall se descarta al faltar la identidad de instalación;
- verificar actualización in-place con el mismo appId/bundle ID y firma: debe conservar token; una incompatibilidad debe fallar cerrada y pedir login, nunca caer a storage plano;
- no habilitar implementación web del plugin: el servicio de auth debe comprobar plataforma nativa y fallar cerrado en browser/PWA.

Keystore/Keychain cifran en reposo, pero no se ha decidido exigir autenticación local por cada lectura. Screen lock/biometría será hardening futuro. Un dispositivo desbloqueado, rooteado, con jailbreak o un XSS dentro del proceso puede seguir usando la credencial.

## 11. Token accesible a JavaScript

Se elige inicialmente la opción A: el servicio native obtiene el token desde el plugin seguro sólo al preparar una operación autenticada, lo retiene en memoria el mínimo tiempo práctico y un interceptor exclusivo native agrega `Authorization`. No debe existir una copia permanente en un singleton durante toda la vida del proceso; en background/suspensión se limpian referencias cuando sea seguro y la fuente persistente sigue siendo secure storage. Nunca se copia a estado reactivo, logs, errores, URL, DOM, clipboard ni almacenamiento web.

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

Rutas externas compartidas por Android e iOS; Nginx seguirá retirando `/api/` al proxy. No existirán `/api/auth/android/*` y `/api/auth/ios/*`: plataforma, OS y versión pueden ser metadatos de soporte, nunca una razón para duplicar credenciales, tablas, rate limits, autorización o handlers.

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
- `installation_id` es UUID aleatorio local, no secreto, no auth y no IMEI/Android ID/serial/IDFA/Advertising ID;
- transacción: validar, revocar sesión anterior de esa instalación según política, insertar hash y devolver raw;
- no incluir password o token en errores, tracing o métricas.

### Estado y logout

- `GET /api/auth/native/session`: autentica Bearer, devuelve usuario/roles actuales, expiración y quizá server time; se usa al recuperar conectividad/resume.
- `POST /api/auth/native/logout`: asegura que la sesión identificada exactamente por el Bearer ya no pueda utilizarse y responde 204 de forma idempotente mediante el lookup especial definido abajo.
- `POST /api/auth/native/logout-all`: acción explícita y confirmada que **requiere sesión native activa mediante el resolver normal**; incrementa `version_sesion` y revoca web y todas las sesiones native. Debe documentar que también expulsa el navegador.
- `POST /api/auth/native/ws-ticket`: autentica el mismo Bearer y emite un ticket efímero single-use para el WebSocket común.
- no existe endpoint refresh en el MVP; al expirar se reautentica con password.

El contrato completo es multiplataforma: sesión opaca, Bearer, HMAC/token hash, `version_sesion`, `expires_at`, `revoked_at`, `installation_id`, logout de dispositivo, logout global, rate limit, autorización, branching de CORS/Origin/CSRF, tickets WS y logging/redaction son una única implementación backend. Los endpoints de negocio y sus guards también son únicos.

### `POST /api/auth/native/logout`: cierre idempotente de una sesión

La operación significa **“asegurar que esta credencial de sesión native ya es inutilizable”**, no “autenticar una sesión activa y luego revocarla”. Por eso es la única ruta que no pasa primero por el resolver Bearer normal que exige sesión activa. Su resolver especial tiene capacidad exclusiva de cierre y nunca crea una identidad autenticada reutilizable por handlers de negocio.

Flujo obligatorio, después de aplicar rate limit y la política native de CORS/Origin vigente:

1. exigir un único header `Authorization` con esquema `Bearer` y token no vacío que cumpla exactamente el formato/version/longitud permitidos (`rspn1_` y payload de 256 bits según el contrato final);
2. si falta el header, el esquema no es Bearer, el token está vacío/malformado/fuera de formato o además se recibió `rsp_session`, responder 401/error auth estándar por ausencia/formato/credenciales ambiguas; jamás probar cookie web;
3. calcular HMAC del raw según el dominio de tokens native y buscar **sólo** `sesion_nativa.token_hash = $HASH_PRESENTADO`, aun si la fila está revocada, expirada, emitida con versión antigua o pertenece a un usuario ahora inactivo;
4. asegurar la revocación mediante una mutación idempotente equivalente a:

```sql
UPDATE sesion_nativa
SET revoked_at = COALESCE(revoked_at, now())
WHERE token_hash = $HASH_PRESENTADO
RETURNING id_sesion_nativa, id_usuario;
```

5. confirmar la transacción DB antes de enviar la respuesta; la revocación durable es la fuente autoritativa;
6. si hubo fila, cerrar best-effort los sockets del `id_sesion_nativa` en el registry local. Los tickets pendientes ya fallan por sesión padre inválida y no necesitan borrado físico; fallar al encontrar/cerrar un socket nunca revierte `revoked_at` ni cambia el 204 porque el heartbeat autoritativo completará el cierre;
7. responder siempre 204 sin body para cualquier Bearer **bien formado**, tanto si el `UPDATE` devolvió una fila como si el hash era desconocido.

El lookup nunca usa `id_usuario`, email o `installation_id` aportados por el cliente y no puede afectar otra sesión. Un hash desconocido no crea filas ni modifica una sesión aproximada. Responder 204 uniforme evita que logout revele si el token existe, estaba activo/revocado/expirado, si la versión coincide o si el usuario está activo. Raw, hash y estado interno no aparecen en body o logs.

La operación sigue bajo el rate limiter global y límites razonables de API; la respuesta indulgente no permite spam ilimitado. Mantiene Bearer explícito, native Origin policy y exención CSRF propia del mecanismo no ambiental. Web logout permanece separado con cookie, CSRF, Origin y semántica actual.

Con requests concurrentes para el mismo token, `COALESCE`/locking normal de PostgreSQL produce una sola transición lógica `active → revoked`, pero todos pueden finalizar 204. No hay 409, reactivación ni estado intermedio. Si la primera transacción confirma y su 204 se pierde, cualquier retry con el mismo Bearer bien formado vuelve a obtener 204 sin volver a autenticar la sesión.

### Matriz de resolución native

La tabla asume que CORS/Origin y rate limit ya fueron aceptados. “401” representa el error auth uniforme futuro, sin detalle de estado:

| Estado del Bearer | `native/logout` | `native/logout-all` | negocio/`session`/`ws-ticket` |
|---|---:|---:|---:|
| sesión activa | 204, queda revocada | permitido | permitido |
| sesión ya revocada | 204 | 401 | 401 |
| sesión expirada conocida | 204 | 401 | 401 |
| `version_sesion` obsoleta | 204 | 401 | 401 |
| usuario inactivo/sin acceso | 204 | 401 | 401 |
| token bien formado desconocido | 204 | 401 | 401 |
| header ausente/esquema o token malformado | 401 | 401 | 401 |

`logout-all` no hereda esta semántica porque incrementa `version_sesion` y afecta web/otros dispositivos: requiere autenticación native activa y el resolver normal. `logout` tampoco hace fallback a cookie ante ninguna clase de Bearer.

## 13. Resolver de autenticación y scope de endpoints

Se reutilizarán todos los endpoints de negocio para Android e iOS. Sólo `/auth/native/*` es namespace mobile separado del web histórico. Salvo el lookup de cierre exclusivo de `POST /api/auth/native/logout`, el resolver normal permanece estricto y ejecutará antes de CSRF:

1. si existe cualquier header `Authorization`, sólo acepta exactamente un esquema `Bearer` bien formado;
2. si también existe `rsp_session`, rechaza la combinación como credenciales ambiguas; el cliente native debe usar `credentials: 'omit'`;
3. valida el token native, expiry, revocación, usuario activo y `version_sesion`;
4. un Bearer ausente/malformado/inválido **nunca** cae a cookie;
5. si no existe Authorization, usa exactamente el `authenticate` cookie actual;
6. normaliza identidad y mecanismo (`web-cookie` o `native-bearer`) en request para guards, CSRF, logging y métricas.

Esto evita downgrade y token substitution. Los guards de rol/ownership no deben ramificarse por plataforma. Una ruta marcada sólo-web o sólo-native deberá declararlo explícitamente; health y preflight permanecen públicos según contrato.

La excepción de logout-device no modifica estas reglas para ninguna otra ruta: una sesión inexistente, revocada, expirada, de usuario inactivo, con `version_sesion` obsoleta o binding inválido sigue sin autenticar negocio, `/auth/native/session`, `/auth/native/ws-ticket` y `/auth/native/logout-all`. El resolver especial sólo puede asegurar revocación y devolver 204; no produce `request.user`, roles ni fallback a cookie.

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

Configuración futura separada, por ejemplo `NATIVE_CORS_ORIGINS`, sin mezclarla en `CORS_ORIGINS`. Para la configuración actual los origins empaquetados esperados son exactamente `https://localhost` en Android y `capacitor://localhost` en iOS.

Política exacta propuesta:

| Campo | Native |
|---|---|
| allowed origins | lista exacta por target distribuido: `https://localhost`, `capacitor://localhost` |
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
- jamás se agregarán los origins locales mobile indiscriminadamente a la allowlist web o WS web.

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
        -> HMAC(raw) y consumo atómico sólo de ticket_hash presentado
        -> revalidación obligatoria de sesión padre + usuario
        -> conexión asociada a id_sesion_nativa + id_usuario + version_sesion
```

Reglas:

- ticket de 256 bits, raw sólo en respuesta y query, HMAC en DB; nunca buscar o registrar raw;
- TTL recomendado 30 s configurable, un único uso y consumo atómico acotado por `ticket_hash` antes de registrar el socket o enviar eventos;
- query, errores, proxy, Fastify, Logcat, Xcode console y crash reports deben redactarlo; Nginx actual usa `$uri`, pero la defensa no dependerá sólo de eso;
- Origin native exacto si el WebView lo envía; nunca autentica por sí solo;
- `/ws` cookie conserva `Origin === PUBLIC_ORIGIN` y auth web actual;
- handshake con ticket inválido/usado/expirado o sesión padre inválida falla sin fallback a cookie y sin registrar subscripciones;
- al reconectar se solicita ticket nuevo; nunca se reusa;
- logout de dispositivo cierra conexiones de esa sesión y vuelve inutilizables sus tickets pendientes sin necesidad de borrarlos; logout global/desactivación/version change cierra todas las del usuario e invalida tickets de versiones anteriores;
- el registry native indexa por `id_sesion_nativa` e `id_usuario`; los cierres dirigidos por eventos conocidos son best-effort y complementarios;
- el heartbeat existente de aproximadamente 30 s se conserva y **debe** revalidar la sesión padre de cada conexión native en cada ciclo, con intervalo final configurable y nunca mayor a ese ciclo recomendado;
- límites propuestos: máximo 30 tickets/min por sesión/IP, pocos tickets simultáneos y máximo 2 conexiones por sesión, configurables.

### Validación obligatoria al redimir

La emisión del ticket no congela el estado de autenticación. Dentro de la operación/transacción de redención y antes de autenticar o registrar el socket se comprueba obligatoriamente:

- ticket ligado por FK a una `sesion_nativa` concreta;
- sesión existente, `revoked_at IS NULL` y `expires_at > now()`;
- usuario existente, activo y con cuenta de acceso;
- `version_sesion_emitida === usuario.version_sesion`;
- roles/permisos actuales mediante el mismo mecanismo autoritativo usado por HTTP;
- coherencia del `installation_id`/binding almacenado en la sesión, sin tratarlo como secreto.

Si cualquiera falla, la conexión se rechaza/cierra antes de registrar subscripciones. Caso de carrera obligatorio:

```text
T0 emite ticket cuando la sesión es válida
T1 logout dispositivo/global, desactivación, cambio de versión o expiración
T2 intenta redimir ticket dentro de sus ~30 s
   -> RECHAZADO: se vuelve a evaluar la sesión padre en T2
```

Las escrituras que revocan sesión/cambian versión y la redención deben usar transacciones/locking coherentes para que una revocación confirmada antes de T2 no pueda intercalarse como estado antiguo. Si el consumo devuelve cero filas o falla cualquier comprobación posterior dentro de la transacción, no se autentica el socket.

### Validez continua del socket native

Un handshake válido no concede acceso indefinido. Cada conexión native conserva `id_sesion_nativa`, `id_usuario`, versión observada y hora de última validación. En cada ciclo del heartbeat existente —recomendado 30 s, configurable— el servidor consulta el estado autoritativo indexado y vuelve a exigir sesión existente/no revocada/no expirada, usuario activo/con acceso y versión coincidente. Al fallar, quita inmediatamente el socket del registry y lo cierra antes de entregarle más eventos.

La expiración natural no espera otra request HTTP: al llegar `sesion_nativa.expires_at`, la siguiente revalidación la detecta y cierra el socket. El intervalo limita la ventana residual a como máximo un ciclo configurado; si al despachar un evento la validación ya está vencida, se revalida antes de enviarlo. No se crea un segundo timer de alta frecuencia.

Logout de dispositivo, logout global, desactivación y cambios conocidos de `version_sesion` deben además localizar y cerrar inmediatamente, best-effort, los sockets del `id_sesion_nativa`/`id_usuario` local. Esto reduce latencia pero **no sustituye** la revalidación periódica: puede haber expiración natural, otra instancia, una escritura directa en DB o un evento local perdido.

Si DB/error interno impide conocer el estado durante una revalidación, la política es fail-closed: retirar/cerrar la conexión y no seguir entregando datos autenticados. El cliente podrá obtener un ticket nuevo y reconectar por el flujo normal cuando el backend se recupere.

El registry directo sólo conoce sockets de la instancia API local. La seguridad multi-instancia descansa en la revalidación contra PostgreSQL autoritativo, no exclusivamente en ese registry; RSP-09A-R2 no introduce Redis ni pub/sub. Para los pocos usuarios/conexiones previstos, una consulta indexada por heartbeat es aceptable. Las migraciones futuras deberán indexar `sesion_nativa.id_sesion_nativa`, `token_hash`, `id_usuario` y las FK/lookups de ticket; se medirá antes de cualquier cache que amplíe la ventana de revocación.

## 16. Revocación, `version_sesion` y autorización

Cada fila native guarda `version_sesion_emitida`. En cada autenticación activa —todas salvo el lookup no autenticante de logout-device— se consulta sesión y usuario en una query indexada y se exige:

- `revoked_at IS NULL`;
- `expires_at > now()`;
- usuario existente, activo y con cuenta de acceso;
- versión emitida igual a `usuario.version_sesion`;
- roles/ownership actuales en los guards existentes.

Esto da revocación inmediata para HTTP y sirve como condición autoritativa de redención/revalidación WS cuando el usuario se desactiva/elimina, password/rol incrementa versión o se ejecuta logout global. El costo de una query por request ya existe para web; para los pocos sockets previstos, la misma validación indexada cada ~30 s es aceptable. Se medirá e indexará antes de optimizar y no se cacheará un usuario activo durante minutos porque abriría una ventana de revocación.

Semántica UX:

- **Cerrar sesión en este dispositivo:** el hash del Bearer identifica sólo esa fila native; `revoked_at = COALESCE(revoked_at, now())` hace que primer intento, retries y requests concurrentes bien formados respondan 204. HTTP de negocio posterior falla, tickets pendientes de esa sesión no redimen y sus WS se cierran por evento local best-effort o, como máximo, en la siguiente revalidación obligatoria. No incrementa versión.
- **Cerrar todas las sesiones:** requiere sesión native activa mediante resolver normal, incrementa `version_sesion` y revoca web y todos los dispositivos. Tickets de versiones anteriores no redimen y WS native se cierran. Debe advertirse explícitamente.
- **Logout web actual:** sigue incrementando `version_sesion`, por tanto también revocará Android e iOS, incluidos tickets/WS native de la versión anterior. Se conserva por contrato.
- **Administración:** desactivar/eliminar/cambiar roles relevantes invalida HTTP/tickets y cierra WS native por evento conocido o heartbeat autoritativo.

Una sesión puede conservar metadatos de instalación para que el usuario/admin vea y revoque dispositivos, pero `installation_id` nunca concede acceso.

## 17. Rate limiting y logs

RSP-09B debe mantener el limitador global y evitar un bypass mediante rutas native:

- login web y native comparten como mínimo 10 intentos/min/IP;
- agregar límite por identificador de cuenta normalizado/hasheado cuando sea posible, sin enumeración;
- requests normales consumen límite por IP y, una vez autenticadas, límite por sesión/usuario;
- logout-device especial conserva el límite global/IP razonable aunque un token bien formado desconocido responda 204; no necesita heredar el límite agresivo de login;
- WS ticket consume API general más límite específico;
- upgrades/conexiones WS tienen cupo propio;
- si se escala a múltiples instancias, el limiter en memoria deberá sustituirse por estado compartido; no es necesario para el piloto de una instancia.

Redacción futura mínima:

- todos los casing/aliases de `Authorization`;
- `session_token`, `refresh_token` aunque no se use, `native_token`, `ws_ticket` y `ticket`;
- query de WS en serializers, reverse proxy, exceptions y métricas;
- body completo de ambos logins o como mínimo email/password;
- Android Logcat, iOS unified/Xcode logs, WebView console, crash reports y herramientas de red.

Los logs sólo necesitan request id, ruta parametrizada, mecanismo (`web-cookie`/`native-bearer`), id interno de sesión si es útil, status y duración. Logout-device especial se marca como cierre no autenticante (por ejemplo `native-logout-closure`), nunca como identidad activa, y no expone si el hash tuvo match. Nunca raw/hash parcial utilizable.

## 18. Fotos, uploads, PDF y Maps

Bearer se agrega a todos los transports de negocio, no sólo JSON:

- Angular `HttpClient`/fetch normal para JSON y multipart de foto (máximo binario actual 5 MB);
- `Authorization` acompaña `FormData` sin fijar manualmente el boundary;
- fotos protegidas se descargan como Blob con el mismo header;
- PDF se descarga como binario y se preservan `Content-Type`, `Content-Disposition`, timeouts y rate limit;
- los JSON con foto base64 existentes siguen bajo sus límites actuales;
- Maps continúa exclusivamente server-side; no se incorpora API key al bundle mobile;
- si se adopta `CapacitorHttp`/File Transfer para archivos grandes, debe aceptar el mismo Bearer desde el servicio de auth y demostrar cancelación, errores, TLS y redacción. No se crea cookie bridge.

La prueba end-to-end de RSP-09C debe cubrir CRUD de pozo, propietarios, sitios, upload/replace/delete/download de foto y PDF en dispositivo, no sólo `/session`.

## 19. Conectividad, lifecycle y operación mobile

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

#### Logout mobile y estado `logout pending`

```text
token en secure storage
  -> usuario pulsa cerrar sesión
  -> bloquear inmediatamente uso local para negocio y cerrar WS cliente
  -> POST /api/auth/native/logout

204
  -> borrar token/pending state de secure storage
  -> limpiar usuario/cache de sesión
  -> volver a login

timeout/error de red/sin conexión
  -> no asumir revocación server-side
  -> mantener en secure storage sólo lo necesario para reintentar
  -> estado local logout pending, sin usar Bearer para negocio
  -> al volver Internet, repetir logout
  -> 204 y limpieza definitiva
```

El token pendiente no habilita continuar trabajando autenticado. Puede usarse únicamente por el flujo encapsulado de retry de logout hasta recibir 204; diseño detallado de UX/colas queda para RSP-09C/RSP-09F. Si el primer `COMMIT` ocurrió pero la respuesta se perdió, el retry recibe 204 aunque la sesión ya esté revocada. Si la fila expiró, quedó con versión vieja, el usuario fue desactivado o un cleanup la eliminó, el mismo contrato 204 permite terminar la limpieza local.

### 19.2 Background, resume y reinicio

- Android debe cubrir background, process kill y reboot; iOS debe cubrir background/suspensión, process termination y device restart;
- al cold start/relanzamiento, no asumir memoria conservada: secure storage es la fuente persistente y se valida con `/auth/native/session` cuando haya red;
- cargar el token en memoria sólo cuando una operación autenticada lo requiera y liberar referencias no necesarias; no serializarlo para sobrevivir procesos;
- en resume tras horas/días, comprobar red y estado si pasó un umbral configurable o se acerca expiry;
- en background/suspensión no hacer refresh inexistente ni iniciar servicios; minimizar trabajo y limpiar referencias no necesarias sin borrar storage;
- en logout confirmado por 204, limpiar memoria y storage; si se pulsa logout offline, bloquear uso local y conservar de forma segura token + estado `logout pending` sólo hasta poder reintentar, sin copiar el raw a una marca/log/cola insegura;
- no colocar token en singleton de estado serializable, Redux/devtools, signals públicas ni service worker.

RSP-09A-R1 no implementa background services. iOS puede suspender o terminar el proceso sin aviso útil, y Android también puede matarlo; la corrección depende de persistencia segura + reconstrucción idempotente, no de mantener código activo en segundo plano.

### 19.3 Robo, root/jailbreak y biometría

Keystore/Keychain reducen extracción en reposo, no hacen imposible usar una sesión en un teléfono desbloqueado o comprometido. Mitigaciones: TTL 30 días, logout por dispositivo, logout global, revocación administrativa inmediata, TLS, no migración, CSP y no logs. No se implementará root/jailbreak detection invasivo.

Biometría queda fuera del MVP y no cambia la autenticación del servidor. Después puede proteger localmente la lectura con Android BiometricPrompt/device credential o iOS Face ID/Touch ID/passcode, con recuperación bien diseñada. No sustituye el Bearer ni autoriza endpoints por sí sola.

### 19.4 TLS y pinning

Producción sólo acepta `https://` y `wss://`, validado por el trust store de Android/iOS. Para el piloto no se recomienda certificate pinning: añade riesgo de inutilizar builds al renovar/cambiar certificado y exige pin backup/rotación coordinada. Queda como hardening futuro si el threat model operacional demuestra MITM con CA comprometida como riesgo superior al de disponibilidad.

### 19.5 Actualización y versión mínima

Una actualización firmada con la identidad estable de cada plataforma (misma clave/appId Android; mismo bundle ID/equipo/firma iOS según la vía autorizada) debe conservar secure storage y sesión. Un cambio de formato debe migrar atómicamente o pedir login. El servidor puede responder un error tipado (por ejemplo 426) si `app_version` está por debajo de `MIN_NATIVE_APP_VERSION`; la versión no autentica ni autoriza.

No se propone live update remoto en esta etapa. Una vulnerabilidad crítica se atiende revocando sesiones/version y exigiendo versión mobile mínima, sin depender de que el token sobreviva indefinidamente.

### 19.6 Distribución piloto

**Android piloto:** APK release privado, firmado con una clave controlada, instalado manualmente en los dispositivos autorizados. Las actualizaciones se entregan como APK posterior con el mismo application ID y la misma clave para permitir upgrade in-place. Play Store no es obligatoria inicialmente; firma, custodia, checksum, canal de entrega, rollback y versión mínima deben quedar operados explícitamente.

**iOS piloto:** requiere una estrategia permitida por Apple, identidad de firma y provisioning. RSP-09E deberá comparar Ad Hoc para dispositivos registrados y TestFlight para testers internos/externos según el grupo real; ninguna exige publicación pública en App Store, pero sí cumplir el flujo Apple aplicable. RSP-09A-R1 no decide definitivamente la distribución iOS ni genera un IPA. Costos, membresías, límites, revisiones y reglas concretas son temporales y deberán verificarse en fuentes Apple vigentes justo antes de distribuir.

### 19.7 GPS futuro en hardware real

RSP-09A-R1 no implementa GPS. RSP-09E debe comparar Android e iPhone en la **misma ubicación física**, en hardware real, registrando latitud, longitud, `accuracy` en metros y varias muestras; debe probar permisos de ubicación precisa y comportamiento con conectividad mala/intermitente. No se concluirá que una plataforma es más precisa sin esa prueba de campo controlada.

## 20. Entornos y reintroducción futura del build native

RSP-09C podrá reintroducir un target explícito sólo después del backend RSP-09B y tests end-to-end:

- `development`: backend local/LAN controlado; preferir HTTPS con CA de desarrollo instalada. Cualquier cleartext debe existir sólo en flavor debug y nunca ser fallback;
- `staging`: origin HTTPS específico y app/flavor inequívocamente staging;
- `production`: backend HTTPS exacto, application ID/bundle ID finales y firmas release controladas.

Variable pública conceptual: `NATIVE_BACKEND_ORIGIN`. El build deriva `/api/` y `/ws`; no acepta paths/credentials/query. Fail-fast productivo si:

- falta la variable;
- protocolo no es HTTPS;
- host es localhost, `.localhost`, IP/LAN o coincide con staging;
- `appId`/bundle ID sigue siendo `com.example.app`;
- existe cleartext/mixed content, `server.url` o debugging/logging productivo;
- backend no anuncia versión de contrato native compatible;
- el bundle contiene un origin distinto del único esperado.

Tests de artifact deben probar que web sigue `/api/` y `/ws` same-origin y que sólo el target native contiene el origin público no secreto correcto. No se reintroduce este flujo en RSP-09A.

## 21. Threat model

| Amenaza | Mitigación diseñada | Riesgo residual |
|---|---|---|
| brute force de password | error genérico, bcrypt actual, cuenta activa, mismo límite 10/min y límite por cuenta/IP | ataque distribuido; monitoreo y posible backoff futuro |
| robo de Bearer | Keystore/Keychain, memoria breve, TLS, no logs, TTL y revocación | dispositivo con root/jailbreak o XSS activo puede usarlo |
| robo de refresh | no existe refresh separado | el token de sesión sigue siendo credencial de 30 días |
| XSS en WebView | CSP local estricta, sin scripts remotos/eval, encapsular plugin, no storage web | JS autorizado comprometido puede pedir token o actuar como usuario |
| app maliciosa | sandbox + Keystore/Keychain, no deep-link con token, Bearer aleatorio | puede imitar Origin en HTTP nativo; no posee token/password salvo compromiso externo |
| jailbreak/root | almacenamiento seguro, mínima vida en memoria, revocación y versión mínima | no se promete protección absoluta si el atacante controla OS/proceso |
| exposición Keychain/Keystore | accessibility no migrable, sync apagado, backup excluido y fail-closed | dispositivo desbloqueado/comprometido puede autorizar uso aunque no exporte la clave |
| MITM | HTTPS/WSS y trust store de cada OS; nunca cleartext producción | CA/dispositivo comprometido; pinning diferido |
| replay de token | TLS, HMAC lookup, TTL, revocación, rotación en login | un token robado es replayable hasta revocación/expiry |
| dispositivo robado | secure storage, listado/revocación de sesión, 30 días, logout global | teléfono desbloqueado puede operar hasta revocación |
| secretos en logs | redacción proxy/Fastify/app/Logcat/iOS/crash, no query principal | SDK o log nuevo mal configurado requiere regresión continua |
| backup/migración | Android backup/D2D excluido; iOS `ThisDeviceOnly` + no sync; binding con installation ID | OEM/Apple y restores pueden variar; probar dispositivos y reinstalación |
| screenshots/clipboard | token nunca se muestra ni copia; pantallas sensibles minimizan PII y se revisan por OS | el MVP no promete bloquear toda captura; cámara externa/OS comprometido permanece |
| replay ticket WS | 256 bits, HMAC, lookup por hash exacto, 30 s, single-use atómico y parent session válida | atacante que lo roba antes del consumo puede ganar la única redención |
| WS native con sesión inválida | parent validada al redimir, revalidación DB obligatoria cada ciclo y cierre fail-closed | ventana residual acotada al intervalo configurable, recomendado máximo 30 s |
| confusión CORS | allowlists web/native separadas, exactas, sin wildcard | CORS no limita clientes native fuera de browser |
| confusión CSRF | branching por mecanismo autenticado; cookie conserva double-submit | bug de orden de hooks; cubrir matriz exhaustiva |
| session fixation | servidor genera token, no acepta valor cliente, rotación transaccional | malware con control de proceso puede sustituir estado local |
| token substitution | formato estricto, HMAC, relación a sesión/usuario/version, ambas credenciales rechazadas | compromiso backend/pepper |
| downgrade cookie/Bearer | Authorization presente nunca cae a cookie; mezcla rechazada | rutas que omitan resolver; inventario/test obligatorio |
| oracle/retry de logout | formato estricto, lookup exacto por HMAC y 204 vacío uniforme para Bearer bien formado conocido/desconocido/inutilizable | timing interno debe mantenerse bajo observación sin registrar raw/hash |
| usuario desactivado offline | no hay acceso server-side offline; al volver se valida antes de sync | datos ya cacheados siguen visibles según política local futura |
| rol removido | roles actuales y `version_sesion` en cada request | datos cacheados requieren política offline futura |
| request duplicado al reconectar | futuro idempotency key/cola; no reintentar mutaciones ciegamente | RSP-09A no implementa sync offline |
| build mobile obsoleto/vulnerable | versión mínima server-side, revocación y build fail-fast | distribución/actualización puede demorar según canal |
| Bearer en query WS | bearer principal nunca va en query; sólo ticket redactado y efímero | infraestructura externa debe auditarse también |

Riesgo aceptado para piloto: Android con root, iPhone con jailbreak, un dispositivo robado/desbloqueado, un proceso comprometido o XSS con acceso al bridge puede actuar como el usuario. La respuesta proporcionada es limitar exposición, detectar/revocar y actualizar; no se promete invulnerabilidad en un dispositivo comprometido.

## 22. Pruebas y roadmap ejecutable

### Evidencia/spike de RSP-09A

No se agregó un spike duplicado al runtime. La evidencia aislada existente ya demuestra:

1. `cookie-auth.integration.test.ts`: `onlyCookie` acepta cookie y rechaza Bearer; cookies y CSRF mantienen contrato;
2. `proxy-origin.test.ts`: mutaciones de origin no permitido y WS con origin distinto al canónico se rechazan; preflight sólo funciona con allowlist actual;
3. `production-contract.test.mjs` y `test-production-build.mjs`: web conserva `/api/` y `/ws`, no existe target/config native productivo;
4. fuente instalada y documentación de Capacitor 8: Android usa `https://localhost`, iOS proyectado usa `capacitor://localhost` y el HTTP patch está apagado;
5. API browser `WebSocket(url, protocols?)`: el frontend/librerías actuales no ofrecen header Authorization; el ticket funciona con query y el servidor `@fastify/websocket` actual puede inspeccionar request antes de registrar conexión.

Crear rutas/test doubles de tokens sin el resolver definitivo habría parecido una implementación parcial. Se optó por especificar contratos verificables para RSP-09B.

### Tests obligatorios RSP-09B

- migración fresh/upgrade/rerun y constraints/índices, incluidos lookup por token/session id e `id_usuario` usados por WS;
- token CSPRNG/formato, HMAC y ausencia raw en DB/log;
- login activo/inactivo/inexistente/password/rol con error no enumerable y rate limit compartido;
- no `Set-Cookie` ni CSRF en login native común;
- matriz cookie, Bearer, ambos, Bearer inválido y Authorization no Bearer sin fallback;
- expiry, revoked_at, usuario eliminado/inactivo, cambio `version_sesion` y roles actuales;
- logout dispositivo frente a logout-all y logout web;
- CORS preflight exacto para `https://localhost` y `capacitor://localhost`, evil origin, ausencia Origin native HTTP y web congelada;
- CSRF web intacto y Bearer explícitamente exento;
- redacción de todas las superficies;
- inventario automático: todo endpoint protegido usa el resolver común;
- multipart, foto, PDF y respuestas binarias autenticadas con Bearer.

Logout-device idempotente:

1. sesión activa: 204, `revoked_at` confirmado antes de responder y sin body;
2. retry con el mismo token: 204 y timestamp no reactivado/revertido;
3. dos logout concurrentes del mismo token: ambos 204 y una sola transición lógica;
4. token ya revocado: logout 204;
5. token conocido pero expirado: logout 204;
6. token de sesión con `version_sesion` antigua: logout 204 sin cambiar la versión actual;
7. token de usuario inactivo/sin acceso: logout 204;
8. token sintácticamente válido pero desconocido/eliminado: 204, ninguna fila fabricada/modificada y mismo body observable;
9. `Authorization` ausente: 401/error auth estándar;
10. esquema no Bearer, Bearer vacío o formato/longitud inválidos: 401/error auth estándar;
11. token revocado no accede a endpoints de negocio ni `/auth/native/session`;
12. token revocado no obtiene `/auth/native/ws-ticket`;
13. token revocado/expirado/desconocido no ejecuta `/auth/native/logout-all`;
14. logout-all con sesión activa conserva su requisito de autenticación y efectos globales;
15. simular `COMMIT` de logout seguido de pérdida del 204: retry con el mismo raw devuelve 204;
16. logout-device de una sesión no revoca, consume ticket ni cierra WS de otra sesión.

Las pruebas 2, 3, 8 y 15 deben comprobar uniformidad de status/body y concurrencia coordinada; ningún caso permite fallback a cookie. También deben verificar rate limit, Origin native y redacción sin debilitar web logout/CSRF.

### Tests obligatorios RSP-09D

Ticket/redemption:

1. ticket correcto y sesión padre válida: consume exactamente una fila y registra un socket;
2. ticket incorrecto: rechazo y ningún otro ticket consumido;
3. ticket expirado: rechazo;
4. ticket ya usado: rechazo;
5. dos handshakes concurrentes con el mismo ticket: sólo uno gana y el otro se rechaza;
6. dos tickets distintos concurrentes: ambos se aíslan y uno nunca consume al otro;
7. ticket de sesión revocada: rechazo;
8. ticket cuya `version_sesion_emitida` quedó vieja: rechazo;
9. ticket cuyo usuario está inactivo/sin acceso: rechazo.

Socket establecido:

10. expiración natural de la sesión: siguiente revalidación cierra y desregistra el socket;
11. logout de dispositivo: negocio/`session`/`ws-ticket` posteriores fallan, retry de logout devuelve 204, ticket pendiente no redime y WS de esa sesión cierra;
12. logout global: sockets/tickets native de versiones anteriores quedan inválidos, además del contrato web vigente;
13. usuario desactivado: socket cierra;
14. cambio de `version_sesion`: socket cierra;
15. error transitorio de DB/revalidación: fail-closed, no entrega eventos y el cliente reconecta por flujo normal;
16. revocar/fallar una sesión o usuario no consume tickets ni cierra sockets de otra sesión/usuario.

Los tests de concurrencia deben usar barreras reales o transacciones coordinadas, no una secuencia que simule carreras. También deben demostrar que el cierre directo del registry es sólo una optimización y que la revalidación autoritativa funciona aunque el evento local no se entregue.

### Roadmap

1. **RSP-09B — backend auth native común + DB + tests:** una migración y una implementación HMAC/pepper, login/session/logout/logout-all, resolver dual estricto más lookup exclusivo de logout-device, branching CSRF/CORS/Origin por mecanismo, rate limits, redaction y tests; sirve a Android+iOS y no incluye cliente productivo.
2. **RSP-09C — cliente Capacitor compartido + secure storage Android/iOS + transport:** auditar/instalar el plugin, integrar Keystore/Keychain, transport Bearer, CSP local, políticas backup/migración, lifecycle, configuración por entorno y pruebas de JSON/multipart/blob/PDF. Recién entonces se reintroduce build native controlado.
3. **RSP-09D — WebSocket native + lifecycle + revocación:** tabla/endpoint común de tickets, consumo atómico por hash exacto, validación/revalidación obligatoria de sesión padre, origins Android/iOS, cierre fail-closed, heartbeat/reconnect y tests de replay/carreras; también cierra/revalida la ventana WS web ya abierta tras logout.
4. **RSP-09E — build piloto Android + preparación iOS + pruebas reales GPS:** appId/firma y APK privado Android; preparación macOS/Xcode/bundle ID/distribución Apple; hardware real Android+iPhone en misma ubicación, cámara/GPS/red, permisos, instalación/upgrade/uninstall y fail-fast. No genera el proyecto iOS desde Windows.
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
- no IMEI, Android ID como auth, serial, IDFA ni identificadores de tracking;
- no pinning, biometría o root detection como bloqueo inicial;
- no API de negocio duplicada en `/api/native`;
- no build/APK/IPA productivo ni generación de `ios/` en RSP-09A/R1/R2/R3.

### Riesgos/decisiones pendientes antes del piloto

- revisión de código y prueba física Android+iOS del plugin secure storage 8.0.0;
- accessibility/synchronizable de Keychain y exclusiones Android backup/D2D;
- appId/bundle ID, firmas y mecanismos de distribución finales;
- dominio real de staging/producción y CA de desarrollo;
- defaults operativos finales de TTL, cupos y versión mínima;
- contenido offline permitido y protección de drafts;
- comportamiento de logout offline y UX de reautenticación;
- inventario de cualquier infraestructura externa que pueda registrar query WS;
- ventana actual de una conexión WS web ya abierta después de logout/version change, a cerrar o revalidar con pruebas en RSP-09D;
- observabilidad/alertas para revocaciones y brute force sin PII.

## Fuentes externas consultadas

- Capacitor v8 configuration: https://capacitorjs.com/docs/config
- Capacitor v8 environment/iOS: https://capacitorjs.com/docs/getting-started/environment-setup y https://capacitorjs.com/docs/ios
- Capacitor v8 HTTP API: https://capacitorjs.com/docs/apis/http
- Capacitor security guidance: https://capacitorjs.com/docs/guides/security
- Android backup security: https://developer.android.com/privacy-and-security/risks/backup-best-practices
- candidato secure storage: https://github.com/aparajita/capacitor-secure-storage
- Apple Keychain accessibility: https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
- Apple beta distribution: https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases
- alternativa Capawesome: https://capawesome.io/docs/plugins/secure-preferences/

Las fuentes externas sólo apoyan comportamiento de plataforma/plugins y deberán revisarse de nuevo al distribuir. La decisión se basa además en el código, locks, proyecto Android, ausencia comprobada de proyecto iOS y tests de este repositorio auditados en los HEAD indicados.
