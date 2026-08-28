# CODEX PROGRESS — ETAPA RSP-09C

Fecha de cierre: 2026-08-27
Rama: `feature/rsp-09c-mobile-client`
Base auditada: `3b48231fc0583493bd1e81799625b34063236b5d`

## 1. Alcance completado

Se implementó el cliente compartido Angular/Ionic/Capacitor para autenticación native Android/iOS contra el contrato real de RSP-09B. La autenticación web continúa con cookie HttpOnly, CSRF double-submit, `withCredentials`, API `/api/` same-origin y WebSocket web. No se implementó WebSocket native, GPS, distribución ni release.

No se modificaron `api/`, las migraciones ni la seguridad web/backend.

## 2. Runtime y metadata

- `RuntimePlatformService` usa exclusivamente `Capacitor.getPlatform()` e `isNativePlatform()` y clasifica `web`, `android`, `ios` o `unknown`. No usa User-Agent, viewport ni heurísticas de pantalla.
- `NativeMetadataService` obtiene `version` y `build` del binario actual mediante `App.getInfo()`.
- Normaliza platform a `android|ios`, exige build decimal canónico, entero positivo y dentro del rango de Android (`<= 2147483647`), y exige versión humana no vacía.
- Metadata inválida falla cerrado: no se inventa build y no se habilitan requests autenticados de negocio.
- Los headers enviados coinciden con RSP-09B: `X-Native-Platform`, `X-Native-App-Build` y `X-Native-App-Version`.
- El build actual se vuelve a obtener del binario instalado al iniciar el proceso. No se usa `app_build_at_login`; un token emitido en build 100 puede restaurarse tras actualizar a build 120.

## 3. Plugins y versiones

Versiones directas instaladas y fijadas:

- `@capacitor/core@8.5.0`
- `@capacitor/android@8.5.0`
- `@capacitor/cli@8.5.0`
- `@capacitor/app@8.0.0`
- `@capacitor/preferences@8.0.0`
- `@aparajita/capacitor-secure-storage@8.0.0`

Todos declaran licencia MIT. El plugin seguro 8.0.0 declara soporte Capacitor 8, Android e iOS. Su implementación Android usa claves no exportables de Android Keystore y AES/GCM para el valor persistido; la implementación iOS usa Keychain. Aunque el plugin incluye una implementación web basada en localStorage, el wrapper propio la rechaza antes de invocarla.

`npm install` informó 50 vulnerabilidades en el árbol completo (1 low, 15 moderate, 33 high y 1 critical). No se ejecutó `npm audit fix` ni se alteraron dependencias fuera del alcance de manera automática.

## 4. Backend origin y builds

La web conserva exactamente:

- development y production: `serverURL=/api`, `apiURL=/api/`, WebSocket same-origin;
- no requiere `NATIVE_BACKEND_ORIGIN`;
- no contiene un origin native productivo.

Native usa un target separado (`build:native:development` o `build:native:production`) que requiere `NATIVE_BACKEND_ORIGIN`. La validación exige un origin HTTPS exacto, sin path, query, fragment, credenciales ni slash final. Production rechaza localhost, IP literals y hostnames marcados dev/stage/staging/test. Además, el target production falla mientras `appId` siga siendo `com.example.app`; el identificador definitivo se resolverá en RSP-09E.

El script genera temporalmente environment e index native, incorpora CSP limitada al origin configurado, compila assets locales y elimina los temporales en `finally`. Esos archivos también están ignorados. `capacitor.config.ts` conserva exclusivamente `webDir`; no hay `server.url`, `allowNavigation` ni carga remota de la aplicación.

No se habilitó HTTP cleartext ni network security general en development; las pruebas LAN/HTTP quedan diferidas a RSP-09E si fueran necesarias.

## 5. Transporte e interceptor

Se conservó Angular `HttpClient` desde el WebView. No hay bridge HTTP de cookies, sincronización de cookies ni `withCredentials=true` en native.

El interceptor central:

- en web mantiene CSRF y cookies sólo para la API same-origin existente;
- en native convierte los servicios existentes a la URL absoluta generada;
- usa `URL` y compara origin exacto y path `/api`/`/api/...`;
- agrega Bearer sólo a la API propia y nunca al login;
- agrega metadata a requests native que la requieren;
- envía logout-device con Bearer pero sin metadata, conforme al contrato real;
- deja intactos body, `responseType`, query params y headers de contenido.

Por lo tanto no filtra credenciales a Google Maps, imágenes externas, telemetry, origins con otro puerto, subdominios, `backend.example.evil.com`, `blob:` ni `data:`. Multipart conserva el boundary generado por el browser y PDF/blob no se transforma. Maps continúa consumiéndose a través del endpoint backend protegido.

## 6. Secure storage e installation_id

`NativeSecureSessionStorage` es la única capa que conoce el plugin. Persiste un solo registro atómico `{token, installationId}` bajo `native_session_v1`, con prefix `rsp_native_`, `synchronizable=false` y `KeychainAccess.whenUnlockedThisDeviceOnly`. No existe fallback a localStorage, sessionStorage, IndexedDB, Preferences ni archivo plano.

El token se carga una vez al bootstrap, queda en un campo privado en memoria y el interceptor consulta esa referencia. No se copia al usuario, signals serializables, templates o logs. Login, clear y logout actualizan memoria y storage; no se lee el plugin en cada request.

`NativeInstallationStorage` genera `crypto.randomUUID()` v4 y lo persiste en Capacitor Preferences, grupo `RspNativeClient`. No usa IMEI, Android ID, IDFA, serial ni hardware ID. Preferences debe guardar el UUID antes del login; si falla, no se crea una sesión remota.

El binding del registro seguro con el installation ID detecta token Keychain residual tras reinstall. Si falta el UUID actual o no coincide, se elimina el token, se crea/reutiliza la instalación actual y se exige login. Una escritura segura parcial o una respuesta de login inconsistente no produce sesión usable.

## 7. Login dual

La misma pantalla despacha según runtime:

- web: `POST /api/login` y `GET /api/login`, sin cambios de DTO o cookie;
- native: `POST /api/auth/native/login` con `{email,password,installation_id}` y metadata actual.

La respuesta real se valida como `{token_type:'Bearer',session_token,expires_at,user}`. El service extrae el token; el resto de la UI recibe sólo usuario, roles y expiración. Un token anterior nunca contamina login. No se persiste password y el formulario lo limpia después del intento. Se evita double-submit.

Si el servidor crea la sesión pero secure storage falla, el cliente no navega ni autentica: usa el token sólo en memoria para un logout-device compensatorio best-effort, lo descarta y muestra un error seguro. Lo mismo aplica si una respuesta porta un token válido pero el resto del shape es inválido.

## 8. Bootstrap, restore y estados

El bootstrap registrado con `provideAppInitializer` es idempotente y single-flight. Esto bloquea la carrera de requests de negocio antes de reconstruir la sesión.

Estados explícitos:

- `initializing`
- `unauthenticated`
- `authenticated`
- `offline-unverified`
- `logout-pending`
- `upgrade-required`
- `client-error`

Restore native carga installation ID, token/binding y pending. Sin token queda unauthenticated. Con token llama `GET /api/auth/native/session` usando metadata actual. Un 200 restaura usuario; 401 limpia; 426 conserva token y bloquea en upgrade; red, DNS, timeout o 5xx conservan token pero dejan `offline-unverified`, nunca authenticated.

Los guards esperan el bootstrap en native y traducen cada estado a login, upgrade o sesión no disponible sin loops. La web mantiene la lógica previa basada en MainStore/cookie.

## 9. 401 y 426

Un 401 de una request native normal dispara una invalidación local single-flight: borra referencia, registro seguro, usuario y pending, y navega una sola vez a login. Login y logout-device quedan fuera del tratamiento indiscriminado.

Un 426 con code real `NATIVE_APP_UPGRADE_REQUIRED` conserva el token, limpia el usuario visible, marca `upgrade-required`, bloquea negocio y muestra: “Debes actualizar la aplicación para continuar.” No se inventó URL de descarga. Al instalar un build aceptado, restore usa el mismo token y metadata del nuevo binario.

## 10. Logout y pending

Logout-device bloquea negocio inmediatamente, persiste primero el flag no secreto `logout_pending_v1` y llama `POST /api/auth/native/logout` con Bearer sin metadata. Tras 204 elimina token/binding, pending, memoria y usuario.

Ante red/timeout conserva el token exclusivamente en secure storage/memoria para revocación, mantiene `logout-pending` y no permite requests de negocio. El flag sobrevive process kill. En el siguiente bootstrap se reintenta logout antes de session; cualquier 204 permite limpiar sin distinguir revocado, expirado o desconocido.

El service expone `logoutAll()` contra `/api/auth/native/logout-all`, con Bearer y metadata actual. No se agregó un botón prominente porque la UX existente sólo ofrece logout normal.

## 11. Lifecycle

Se registra `App.addListener('appStateChange')`. Tras al menos cinco minutos en background, resume serializa una revalidación; sesiones expiradas reciben 401, builds obsoletos 426 y fallos transitorios quedan offline-unverified. Si hay logout pending, resume prioriza su retry. Eventos breves y concurrentes no crean loops ni restores duplicados.

WebSocket web continúa igual. En native el componente raíz no conecta el WebSocket existente; ticket, redemption, handshake y heartbeat native quedan para RSP-09D.

## 12. Backup y plataformas

Android conserva backups generales de la aplicación, pero excluye de cloud backup y device transfer únicamente:

- `WSSecureStorageSharedPreferences.xml` (ciphertext del plugin seguro);
- `RspNativeClient.xml` (installation ID y pending).

Se agregaron tanto `fullBackupContent` como `dataExtractionRules`; no se excluyeron fotos, drafts ni otros datos.

Capacitor sync Android finalizó y registró secure-storage, App, Camera, Geolocation y Preferences. No hay Java, `JAVA_HOME`, Android Studio/JBR ni variables SDK en esta máquina, por lo que `gradlew projects --no-daemon` se detuvo antes de Gradle con “JAVA_HOME is not set and no 'java' command could be found”. No se generó APK/AAB.

`front/ios/` sigue sin existir y no se creó desde Windows. El código compartido cubre `Capacitor.getPlatform()==='ios'` y configura Keychain `synchronizable=false` / `whenUnlockedThisDeviceOnly`. Xcode, entitlements, backup real, reinstall y hardware Apple requieren validación en RSP-09E; no se afirma un build iOS.

## 13. Pruebas y validación

Resultados de cierre:

- tests focalizados runtime/metadata/config/storage/interceptor/auth/guards: 48 casos (incluidos en la suite completa);
- suite Angular completa: `237 SUCCESS`;
- tests Node de configuración: `8 PASS`;
- build Angular web normal: PASS;
- build/test production web: PASS, backend `/api/` y WS `/ws` same-origin;
- build native-development con `https://native-backend.example.invalid`: PASS;
- build native-production: bloqueo esperado por `com.example.app`;
- Capacitor sync Android: PASS, cinco plugins detectados;
- tests API focalizados metadata/CORS/CSRF/origin/redaction: `11 PASS`;
- UTF-8 interfaz: PASS;
- `git diff --check`: PASS.

Las pruebas cubren web/android/iOS/unknown, build inválido, origin exacto, external origins, multipart/blob, secure storage, UUID, fallo parcial, reinstall/binding, login dual, restore 200/401/426/red/5xx, single-flight, 401 concurrente, upgrade in-place, logout 204/pending/restart, lifecycle y WebSocket web preservado.

## 14. Seguridad y riesgo residual

- No hay secretos reales, token hardcodeado, fallback inseguro, cookie mobile, fake CSRF, cleartext general ni server remoto de assets.
- Token/password no se imprimen ni se incluyen en mensajes UI. El interceptor no serializa requests con Authorization.
- CSP native restringe conexiones al origin configurado; el parser exacto sigue siendo la barrera primaria contra exfiltración accidental.
- El raw token sigue expuesto al JavaScript autorizado que invoca el wrapper secure-storage, porque la arquitectura aprobada usa HttpClient Bearer desde el WebView. Secure storage protege persistencia, no una ejecución JS/XSS ya comprometida. CSP y la reducción de XSS continúan siendo defensas esenciales.

## 15. Pendientes posteriores

### Addendum RSP-09C-R1

El review R1 quedó corregido: `logout_pending_v1` sólo se limpia tras 204 de logout-device o después de persistir y activar un token de reemplazo válido; un login fallido no puede reactivar la sesión anterior y bootstrap reintenta logout antes de session. Mapa aéreo y fotos protegidas se cargan native mediante `HttpClient`/Blob/object URL con cancelación y revoke; web, PDF, multipart y Maps backend se preservan. Un runtime `unknown` ahora termina en `client-error` y no usa autenticación web ni envía credenciales.

### Addendum RSP-09C-R2

R2 corrige los cuatro hallazgos del review sin cambios en `api/`. El floor Android canÃ³nico quedÃ³ en `minSdkVersion = 24`, requerido por los mÃ³dulos Capacitor 8 instalados (core/android 8.5.0, App/Preferences 8.0.0 y secure-storage 8.0.0); se agregÃ³ un contrato para detectar regresiones.

El transporte native captura un snapshot `{token,generation}` antes de cada request. Un 401 sÃ³lo invalida si la generaciÃ³n sigue vigente, por lo que una respuesta tardÃ­a de A no puede destruir la sesiÃ³n B. Se conserva la invalidaciÃ³n single-flight para la generaciÃ³n actual.

DespuÃ©s de un logout-device 204, la revocaciÃ³n remota es autoritativa: la limpieza local queda `unauthenticated` aun si falla `pendingStorage.clear()`. Un marker huÃ©rfano sin token se limpia best-effort sin `native/session` ni `client-error`; `pending + token` continÃºa reintentando logout. Antes de cada login native se ejecuta el probe tÃ©cnico Preferences SET/GET/REMOVE `native_storage_probe_v1`; cualquier fallo bloquea el POST de login y no deja residuos.

RSP-09E debe repetir la validaciÃ³n Gradle fÃ­sica cuando exista JDK/SDK; el cambio estÃ¡tico elimina la incompatibilidad conocida de minSdk.

### Addendum RSP-09C-R5

R5 corrige los tres hallazgos del review sin cambios en `api/`. Un login native ahora se serializa y revoca explícitamente cualquier token anterior con logout-device 204 antes de crear otra sesión, incluso al cambiar de usuario o desde `logout-pending`; fallos de red/storage no sobrescriben el token anterior. El interceptor reconoce 426 en respuestas Blob de imágenes/PDF del origin API autorizado y conserva el token mientras marca `upgrade-required`. El perfil web mantiene su DTO completo y el perfil native reducido oculta email, activo y fecha de registro cuando no forman parte del contrato.

### Addendum RSP-09C-R6

R6 preserva el estado previo bloqueado cuando falla la preparación de un login native: `offline-unverified` y `upgrade-required` nunca se convierten en `authenticated` por un error de Preferences/storage. Las lecturas web y native de sesión tienen timeout RxJS de 10 segundos con cancelación de la suscripción; native conserva el token y queda `offline-unverified`, mientras web puede renderizar su flujo no autenticado. En resume, una revalidación actual que queda no disponible navega inmediatamente a `/session-unavailable?reason=offline`, desmontando la vista protegida; respuestas stale siguen descartándose antes de cambiar estado o navegar.

### Addendum RSP-09C-R7

R7 centraliza las mutaciones de autenticacion native en una cola/mutex compartida. Login, logout-device, retry de `logout-pending`, logout-all e invalidacion 401 quedan mutuamente excluyentes; la generacion de sesion se verifica tambien dentro del lock. Asi, una finalizacion tardia de A nunca puede borrar, sobrescribir o degradar B, y un rejection no rompe la cola ni produce deadlocks. La suite Angular queda en 279/279, sin cambios en `api/` ni en Android.

### Addendum RSP-09C-R8

R8 refuerza el cierre durable: un logout nuevo debe persistir `logout_pending_v1` antes de ocultar la sesión; si Preferences falla, se conserva intacta y no se llama al backend. Con marker durable, red fallida mantiene el token sólo para retry y un 204 autoritativo permite cleanup local best-effort. Las mutaciones auth locked marcan sus requests con un `HttpContextToken` para impedir reentrancia del handler global; `logout-all` resuelve su propio 401/426 sin deadlock. El retry pending queda cancelado a los 10 segundos, liberando bootstrap sin restaurar negocio. Un fallo de `App.addListener()` conserva el token, retira `MainStore`, establece `client-error` y desmonta la ruta protegida mediante navegación a session-unavailable. La suite Angular queda en 286/286, sin cambios en `api/` ni Android.

### Addendum RSP-09C-R4

R4 corrige dos regresiones sin cambios en `api/`: el mapa aéreo conserva el fallback para errores DOM de `<img>` en web además de `protectedResourceError` native, y `MainStore.init()` elimina las claves legacy `localStorage.token`/`localStorage.user` sin leerlas ni migrarlas. La suite Angular queda en 267/267; los builds web y native-development siguen pasando.

### Addendum RSP-09C-R3

R3 alineÃ³ el proyecto Android al template requerido por Capacitor 8.5: Gradle 8.13, AGP 8.13.0, compile/target SDK 36 y minSdk 24. Las revalidaciones native/session capturan `{token,generation}` y descartan cualquier respuesta posterior a un cambio de generaciÃ³n, incluyendo 200, 401, 426 y errores transitorios; el inicio de logout tambiÃ©n invalida inmediatamente la generaciÃ³n anterior. `cap sync android` conserva la configuraciÃ³n. Gradle fÃ­sico sigue pendiente por falta de JDK/SDK.

RSP-09D:

- ticket HTTP y conexión WebSocket native, redemption, registry, fan-out y heartbeat.

RSP-09E/macOS y piloto:

- definir appId definitivo y backend production definitivo;
- Xcode/proyecto iOS, entitlements, build y pruebas físicas Keychain/reinstall;
- instalar JDK/Android SDK y ejecutar validación Gradle/debug sin release;
- validar Android Keystore y reglas de backup en hardware/emulador;
- decidir distribución/URL de update;
- decidir si las pruebas LAN necesitan opt-in HTTP development limitado;
- pruebas reales GPS, permisos y conectividad.

RSP-09F:

- resiliencia y operación offline real; `offline-unverified` de RSP-09C sólo informa y bloquea negocio online.
