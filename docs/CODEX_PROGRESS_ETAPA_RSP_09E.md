# RSP-09E — Android production/release readiness

Fecha de auditoría: 2026-09-09
Rama: `feature/rsp-09e-readiness`
Base auditada: `af2d789` (`main` = `origin/main` al comenzar)
Alcance: preparación técnica local; no firma, publicación, identidad comercial ni producción real.

## Estado actual

### READY

- Build Angular web production y build native development optimizado.
- `cap sync android` y verificación SHA-256 de los 211 assets del build.
- APK debug compilado e instalable; APK release técnico compilado, deliberadamente sin firma.
- Manifest source y merged auditados para debug y release.
- HTTPS obligatorio y cleartext deshabilitado también en el manifest Android.
- CSP native estricta, sin `unsafe-inline` en `script-src`, con origins HTTPS/WSS exactos.
- CSS Ionic cargado como stylesheet normal; `inlineCritical=false` sigue vigente en ambos targets native.
- Service Worker disponible en web production y deshabilitado en native.
- Auth native pública bajo `/api/auth/native/*`; proxy elimina `/api`; Fastify conserva `/auth/native/*`.
- Bearer opaco, Secure Storage, installation UUID, revocación PostgreSQL y ticket WebSocket corto sin JWT native.
- Backup/restore excluye el archivo de Secure Storage y el grupo de Preferences tanto de cloud backup como de device transfer.
- Release no habilita WebView debugging ni logging de Capacitor; ambos siguen el flag `debuggable` por defecto.
- Android lint sin errores de Security, Manifest, Permissions, Exported ni API level.
- Dependencias runtime frontend y API con `npm audit --omit=dev`: cero vulnerabilidades conocidas.
- Suites Angular, Node/API, contratos native, Gradle lint y Gradle test verdes.
- Keystores, propiedades locales de signing, APK y AAB protegidos por `.gitignore`.

### BLOCKED

- El build `native-production` se bloquea correctamente mientras `appId` sea `com.example.app`.
- No existe `signingConfig.release`; `assembleRelease` produce sólo `app-release-unsigned.apk`.
- No se eligió ni confirmó un `NATIVE_BACKEND_ORIGIN` productivo definitivo.
- No existe un artefacto de release firmado, AAB publicable ni validación de instalación release.
- No hay dispositivo físico conectado para validar hardware y lifecycle real.

### HUMAN_DECISION_REQUIRED

- `applicationId`/package/namespace definitivo.
- Nombre comercial definitivo; hoy `appName` y recursos Android dicen `front`.
- `versionCode` y `versionName` de la primera release; hoy continúan en `1` y `1.0`.
- Dominio/origin HTTPS productivo definitivo.
- Icono, icono monocromo/adaptive y splash definitivos.
- Keystore privado, alias y mecanismo seguro de suministro de passwords.
- APK o AAB como formato operativo de entrega/publicación.

### FUTURE

- Evaluar R8 y `shrinkResources` sólo con una release firmada y pruebas reales; hoy ambos están deshabilitados.
- Alinear `@capacitor/camera` 7 con el resto de Capacitor 8 cuando haya una razón funcional y pruebas de cámara. Su peer actual acepta Core 8 y no hay incompatibilidad demostrada.
- Actualizar AppCompat, CoordinatorLayout y Core Splashscreen en una etapa de mantenimiento independiente.
- Resolver warnings cosméticos de recursos plantilla al reemplazar branding, no antes.
- Revaluar las cuatro alertas dev-only de npm cuando Vite/Capacitor publiquen una solución compatible.
- RSP-09F/offline permanece fuera de esta rama.

## Checklist de release

- [x] Manifest source y merged auditados.
- [x] Cleartext deshabilitado.
- [x] Permisos de geolocalización declarados y permisos de storage/background/notifications ausentes.
- [x] Backup excluye sesión, installation ID y `logout_pending`.
- [x] FileProvider limitado a `external-files/Pictures` y cache app-scoped.
- [x] WebView debugging deshabilitado automáticamente en release.
- [x] Auth, CORS, Origin, proxy y WebSocket ticket verificados; la confianza de headers forwarded cubre exactamente un peer TCP inmediato y depende del aislamiento de red productivo.
- [x] CSP, CSS Ionic y Service Worker verificados en build real.
- [x] Assets de Capacitor comparados por SHA-256.
- [x] APK debug generado.
- [x] Release Gradle sin firma compila hasta el punto técnicamente posible.
- [x] Git ignora material de firma y binarios de distribución.
- [ ] appId definitivo.
- [ ] appName definitivo.
- [ ] versionCode definitivo.
- [ ] versionName definitivo.
- [ ] icon definitivo, incluido monochrome/adaptive.
- [ ] splash definitivo y densidades revisadas.
- [ ] backend production origin definitivo.
- [ ] signing keystore privado.
- [ ] signing alias.
- [ ] signing passwords suministrados sólo por mecanismo seguro.
- [ ] signingConfig release sin valores hardcodeados.
- [ ] release APK/AAB firmado y verificado.
- [ ] validación en dispositivo físico.

## Inventario Android

| Elemento | Estado auditado |
|---|---|
| applicationId | `com.example.app` — placeholder deliberado |
| namespace | `com.example.app` |
| Java package/MainActivity | `com.example.app.MainActivity` |
| appName / Android label | `front` |
| versionCode | `1` |
| versionName | `1.0` |
| minSdk | 24 |
| targetSdk | 36 |
| compileSdk | 36 |
| Java source/target | 21 |
| JDK ejecutado | Eclipse Adoptium 21.0.12.1 LTS |
| Gradle wrapper | 8.13 |
| Android Gradle Plugin | 8.13.0 |
| Angular framework/build/CLI | 20.3.30 |
| Ionic Angular/Core | 8.7.8, una sola copia de Core |
| Capacitor Core/Android/CLI | 8.5.0 coherentes |
| Plugins sincronizados | Secure Storage 8.0.0, App 8.0.0, Camera 7.0.2, Geolocation 8.0.0, Preferences 8.0.0 |
| buildTypes | debug estándar; release sin firma, sin minify y sin shrink |
| ProGuard | default `proguard-android.txt` + `proguard-rules.pro` vacío |
| ABI filters | ninguno; APK universal |
| server.url / allowNavigation | ausentes; carga assets locales |
| networkSecurityConfig | ausente; no se requieren excepciones |
| usesCleartextTraffic | `false` explícito |
| backup | habilitado sólo para datos no excluidos; reglas sensibles explícitas |

`NativeMetadataService` obtiene `version` y `build` mediante `@capacitor/app`:

- `build` debe ser un entero positivo y se envía como `X-Native-App-Build`;
- `version` se recorta y se envía como `X-Native-App-Version`;
- el backend aplica `MIN_NATIVE_ANDROID_BUILD` al build numérico;
- la versión textual es metadata informativa y no reemplaza al control por build.

Los valores efectivos se cambian en `front/android/app/build.gradle`. No se centralizaron porque elegir o derivar una versión comercial requiere una política humana; agregar otra fuente de verdad ahora aumentaría el riesgo de duplicación.

## Manifest y permisos

El manifest merged release contiene:

- `INTERNET`: requerido por API/WebSocket.
- `ACCESS_NETWORK_STATE`: generado por Capacitor.
- `ACCESS_COARSE_LOCATION` y `ACCESS_FINE_LOCATION`: requeridos por los formularios que usan geolocalización del WebView.
- permiso signature `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`: generado por AndroidX.
- query `android.media.action.IMAGE_CAPTURE`: generada por Camera/Capacitor para el selector.

No contiene `CAMERA`, storage legacy, `MANAGE_EXTERNAL_STORAGE`, background location ni `POST_NOTIFICATIONS`. La app usa actualmente `<input type=file>`/picker para fotos: no necesita tomar control directo de la cámara ni declarar `CAMERA`. No se agregó ningún permiso anticipatorio.

Componentes merged:

- `MainActivity`: exported sólo porque es launcher, `singleTask`.
- `FileProvider`: no exportado; concede URIs temporales.
- `GoogleApiActivity`: no exportada.
- `InitializationProvider`: no exportado.
- `ProfileInstallReceiver`: exportado por AndroidX pero protegido por `android.permission.DUMP`.
- no hay services ni foreground services propios.

Debug incluye `android:debuggable=true`. Release no declara `debuggable`; AGP lo deja falso. Capacitor deriva `webContentsDebuggingEnabled` y `loggingBehavior=debug` del flag de aplicación, por lo que ambos están disponibles en debug y apagados en release. El gate inspecciona únicamente `android.buildTypes.release`: la configuración específica de `debug` no altera el resultado, mientras que `debuggable true`, duplicados u otras formas ambiguas en release bloquean. No existe override manual en `MainActivity` ni configuración que los fuerce en producción.

## Backup, restore y storage

| Material | Almacenamiento | Reinicio mismo dispositivo | Restore/otro dispositivo |
|---|---|---:|---:|
| Bearer opaco + installation ID asociado | Secure Storage, prefijo `rsp_native_`, no sync, `whenUnlockedThisDeviceOnly` | sí | no; SharedPreferences del plugin excluido |
| installation ID operativo | Capacitor Preferences, grupo `RspNativeClient` | sí | no; grupo excluido |
| `logout_pending` | mismo grupo Preferences | sí | no; grupo excluido |
| probe de escritura | temporal en mismo grupo | no, se elimina | no |

La exclusión existe en `backup_rules.xml` para Android legacy y en `data_extraction_rules.xml` tanto para `cloud-backup` como para `device-transfer`. Restaurar otros datos no sensibles sigue permitido. Un dispositivo restaurado genera una instalación nueva y no revive una credencial ligada al Keystore anterior.

## Network, auth y CSP

Contrato preservado:

```text
Angular/Capacitor público  /api/auth/native/*
             proxy Nginx  elimina /api
             Fastify API  /auth/native/*
```

- `NativeBackendConfigService` sólo construye endpoints públicos `/api/auth/native/*`.
- `proxy/https.conf.template` usa `proxy_pass http://api:3000/`, conservando el strip.
- `front/proxy.conf.json` aplica el mismo rewrite en desarrollo.
- CORS native limita origins y headers exactos y nunca anuncia credentials.
- Origin web/CSRF y Origin native están separados.
- El interceptor agrega Bearer sólo a rutas native permitidas.
- WebSocket pide un ticket por HTTP autenticado y abre WSS con ese ticket; nunca lleva el Bearer.
- Logs del API redactan authorization, cookies, passwords, tokens y tickets incluso anidados/query.

`NATIVE_BACKEND_ORIGIN` acepta exclusivamente un origin HTTPS exacto, sin slash final, path, query, fragment, credenciales ni whitespace. Production rechaza localhost, IP literal, marcadores dev/stage/staging/test, los namespaces reservados `.invalid`, `.example`, `.test` y `.localhost`, y los dominios documentales `example.com`, `example.net` y `example.org` con sus subdominios. Development conserva su comportamiento para fixtures locales. El build deriva un único origin WSS con mismo host/puerto.

El artifact native development fue inspeccionado:

- stylesheet global sin `media="print"` ni `onload` inline;
- `script-src 'self'` intacto, sin `unsafe-inline`;
- `style-src 'self' 'unsafe-inline'`, requerido por Ionic;
- `connect-src` contiene sólo self, el HTTPS exacto y su WSS derivado;
- sin localhost accidental ni wildcard;
- sin `ngsw-worker.js` ni registro de Service Worker;
- `.ion-page` y `.ion-page-hidden` presentes en CSS.

## Ionic layout y lifecycle

- Hay un único `ion-app` y un único `ion-router-outlet` raíz.
- El outlet conserva su región flex dedicada debajo del header y no está dentro de un `ion-content` global.
- No se encontraron `100vh`, `calc(100vh - header)`, offsets fijos ni transforms estructurales en páginas routed.
- Las páginas routed tienen `ion-content`; el único nesting aceptado está detrás de límites de overlay modal/popover.
- Se eliminó un segundo `provideIonicAngular({})` redundante.
- `AuthService` registra una sola escucha `appStateChange`, revalida al volver a foreground y controla generaciones para evitar carreras.
- WebSocket cancela listeners/timers, usa epochs y backoff, revalida sesión y evita reconnect durante logout.
- La cobertura existente ejercita restore, logout pending, force/reconnect, sesión revocada y tickets native.

## Logging y secretos

No se encontraron tokens Bearer, passwords, contenido de Secure Storage ni tickets WebSocket impresos. Se retiraron trazas de depuración que emitían objetos completos de sitio, intervalos, aportes y el modelo completo de un PDF. Se conservaron mensajes de error ya sanitizados y logs operativos sin credenciales.

La búsqueda de claves privadas, passwords de signing y keystores versionados no encontró material real. `.env.example` contiene nombres vacíos; scripts de tests generan fixtures efímeros. No se registran APK, AAB, JKS, keystores ni archivos locales de signing.

## Dependencias y vulnerabilidades

Frontend:

- Angular framework/build/CLI/compiler alineados exactamente en 20.3.30.
- `zone.js` 0.15.1 quedó declarado como dependencia dev: la suite lo listaba en `angular.json`, pero un install limpio dependía accidentalmente de un módulo extraneous.
- `@capacitor/cli` y Angular Toolkit quedaron sólo en devDependencies; se eliminaron duplicados y `@fastify/multipart` sin uso del frontend.
- `npm audit --omit=dev`: 0.
- Audit total: cuatro alertas sólo de tooling. Una es esbuild anidado por Vite sin patch compatible en su rango; tres provienen de `xcode -> uuid` dentro de Capacitor CLI y no participan del target Android. `npm audit --force` propone bajar Capacitor y fue rechazado por incoherente.

API:

- Fastify 5.12.3.
- `@fastify/jwt` 10.2.2 / `fast-jwt` 6.3.3.
- `@fastify/websocket` 11.3.0 / `ws` 8.21.3.
- `@fastify/static` 10.1.3 y Swagger UI 6.1.1.
- `ajv`, `fast-uri`, `find-my-way`, glob/minimatch y YAML quedaron en versiones corregidas.
- `adm-zip` vulnerable fue retirado porque no tenía ninguna importación ni uso.
- `npm audit --omit=dev`: 0.

Fastify 5.12 dejó de aceptar `trustProxy: 1`. Se reemplazó por una función explícita que conserva la semántica histórica de un solo salto: `hop === 0` confía en el peer TCP inmediato, cualquiera sea su dirección. Esto no identifica exclusiva ni criptográficamente a Nginx.

La garantía productiva surge de varias condiciones comprobadas en conjunto:

- `api` usa sólo `expose: 3000` y no publica el puerto al host mediante `ports`;
- el ingreso público HTTP/HTTPS se publica mediante el servicio `proxy`;
- Nginx reemplaza, tanto para `/api/` como para `/ws`, `X-Forwarded-For` con `$remote_addr`, fija `X-Forwarded-Proto https` y fija `Host`/`X-Forwarded-Host` con `$host`;
- Fastify sólo avanza un salto dentro de una cadena forwarded y utiliza el valor derecho aportado por ese peer;
- los tests cubren peer IPv4/IPv6, cadenas múltiples, `request.ip`, host/protocolo forwarded y el efecto sobre rate limiting.

Supuesto de seguridad residual: si otro peer interno puede conectarse directamente a Fastify, `trustProxy` no lo autentica como Nginx y ese peer puede aportar su propio `X-Forwarded-*`. Por eso todo acceso directo a `api:3000` queda fuera del contrato público y debe continuar limitado por la topología/controles de red. No se agregó una allowlist por IP o CIDR porque Docker reasigna direcciones y el repositorio no posee una identidad estable del ingress que Fastify pueda verificar sin rediseñar infraestructura.

## Signing readiness

Estado comprobado por `signingReport`:

- debug usa el keystore debug local estándar;
- release: Config/Store/Alias nulos;
- el APK release generado no está firmado y no es publicable.

Procedimiento futuro, después de decisiones humanas:

1. Crear/conservar el keystore privado fuera del repositorio y respaldarlo mediante un canal seguro.
2. Elegir alias y passwords; no escribirlos en Gradle, Git, documentación ni shell history compartido.
3. Definir un mecanismo local/CI seguro para entregar path, alias y passwords a Gradle mediante `providers.environmentVariable(...).get()`, `providers.gradleProperty(...).get()` o `System.getenv(...)`.
4. Agregar `signingConfig.release` que falle si falta cualquiera de esos valores; nunca usar debug signing en release.
5. Generar APK/AAB, verificar firma con `apksigner` y probar upgrade/instalación en dispositivo físico antes de publicar.

El preflight no acepta accesos indirectos como `keystoreProperties[...]`, `signingProperties[...]` o `localProperties[...]`, aunque existan nombres habituales en `.gitignore`: el nombre de la variable y las reglas de ignore no prueban de qué archivo o literal se cargó. Soportar esos patrones requeriría demostrar su procedencia sin interpretar Groovy de forma frágil.

Antes de evaluar Gradle se eliminan comentarios de línea y bloque mediante un scanner que conserva strings y escapes. El gate exige una estructura deliberadamente canónica: un único bloque `android`, un único `defaultConfig`, las asignaciones de identidad/versión dentro de esos bloques y la configuración de firma dentro de `signingConfigs.release`, enlazada desde `buildTypes.release`. Cada valor debe tener exactamente una asignación efectiva. Cero asignaciones bloquea por ausencia; duplicados, mutaciones externas o sintaxis cuyo valor no pueda demostrarse bloquean por ambigüedad. Para preservar una identidad empaquetada exacta, `buildTypes.release` no puede introducir `applicationIdSuffix` y los `productFlavors` no pueden mutarla mediante `applicationId` ni `applicationIdSuffix`; un suffix exclusivo de `buildTypes.debug` no afecta el release. Los accessors no canónicos de `productFlavors` (`getByName`, `named`, `findByName`, `maybeCreate`, `create`, `register` o `getAt`) también bloquean porque el gate no interpreta sus efectos dinámicos. El preflight no intenta interpretar Gradle/Groovy arbitrario ni reproducir su precedencia.

## Identidad: lugares a cambiar juntos

Cuando exista `applicationId` definitivo deben actualizarse de forma atómica:

- `front/capacitor.config.ts`: `appId`.
- `front/android/app/build.gradle`: `namespace` y `applicationId`.
- el `MainActivity.java` o `MainActivity.kt` descubierto bajo `front/android/app/src/main/java`: package y ubicación de directorio coherentes con el nuevo appId.
- `front/android/app/src/main/res/values/strings.xml`: `package_name` y `custom_url_scheme` si ese scheme sigue siendo deseado.
- contratos de identidad: no requieren editarse para una identidad válida; descubren MainActivity y comparan Capacitor, Gradle, namespace, `package_name`, package Java/Kotlin y ruta.
- documentación que describe el placeholder.

No debe quitarse el bloqueo production antes de que todos esos lugares sean coherentes.

## Builds reproducibles

Flujo técnico debug demostrado en PowerShell:

```powershell
cd front
$env:NATIVE_BACKEND_ORIGIN = 'https://api.example.test'
npm run build:native:development
node node_modules/@capacitor/cli/bin/capacitor sync android
npm run verify:native-assets
cd android
$env:GRADLE_USER_HOME = 'C:\Users\Raul Silva\.gradle'
.\gradlew.bat assembleDebug lint test
```

`npx cap sync android` falló en esta sesión antes de entrar a Capacitor por `uv_os_get_passwd ENOMEM` del entorno restringido. La invocación directa de la misma CLI funcionó fuera del sandbox. No es un error de proyecto ni del sync.

Un `npm ci` adicional no pudo borrar un binario temporal de esbuild porque había un `ng serve` preexistente del usuario manteniéndolo abierto. No se detuvo ese proceso ajeno. `npm install` restauró el árbol, `npm ls` volvió a quedar válido y todas las pruebas/builds posteriores pasaron; queda recomendable repetir `npm ci` cuando ese servidor esté detenido.

Artefactos locales demostrados, ambos ignorados por Git:

- `front/android/app/build/outputs/apk/debug/app-debug.apk` — 10.582.996 bytes, firmado con debug.
- `front/android/app/build/outputs/apk/release/app-release-unsigned.apk` — 8.801.973 bytes, sin firma.

Para producción, después de resolver los blockers, el primer paso debe ser `npm run check:native-release-readiness`. El preflight deriva el resultado del estado efectivo y distingue:

- `TECHNICAL_BLOCKER`: configuración ausente, inválida, incoherente o insegura;
- `HUMAN_DECISION`: un placeholder detectable continúa activo;
- `MANUAL_CHECK`: validación que no puede automatizarse de forma robusta, como confirmar visualmente branding; no fuerza por sí sola un fallo;
- `READY`: condición técnica satisfecha.

Con el estado actual termina con código 2 por appId/nombre placeholder y signing release ausente; origin ausente o inválido agrega otro blocker. `versionCode=1` y `versionName=1.0` son técnicamente válidos y ya no se bloquean por una confirmación externa. Un origin productivo válido tampoco genera un segundo bloqueo incondicional. Los tests construyen un estado futuro con identidad coherente, versión válida y referencias de signing explícitamente externalizadas que alcanza `READY`/exit 0; el branding queda como `MANUAL_CHECK` hasta su inspección humana.

Para signing, `READY` significa únicamente que `signingConfigs.release` está enlazado una sola vez desde `buildTypes.release`, declara una sola vez cada uno de los cuatro campos efectivos, no presenta overrides dirigidos al release fuera de esos bloques canónicos y cada expresión tiene una forma externa admitida sin literal, fallback ni valor nullable. Incluso un override externo que use otro provider seguro queda bloqueado: el gate no decide precedencias. Accessors dinámicos de release como `getByName("release")`, `named("release")` y `findByName("release")` no se interpretan y bloquean por configuración no canónica; accessors dirigidos explícitamente a otro nombre no se consideran overrides del release. El preflight no inspecciona ni imprime secretos, tampoco afirma que las variables estén presentes, que el keystore exista o que las credenciales sean válidas. Gradle y sus tareas de signing/release son la autoridad para esas comprobaciones en el entorno real. Luego corresponde `build:native:production`, sync, verificación de assets y recién entonces Gradle release/signing.

## Pruebas y resultados

| Comando | Resultado |
|---|---|
| `node --version` / `npm --version` | PASS — 24.18.0 / 11.16.0 |
| `npm ls` frontend | PASS — sin invalid/peer errors críticos |
| `npm ci` frontend | BLOCKED por lock de esbuild de un `ng serve` preexistente; no se detuvo el proceso ajeno |
| `npm audit --omit=dev` frontend | PASS — 0 vulnerabilidades |
| `npm test -- --watch=false --browsers=ChromeHeadless --progress=false` | PASS — 306/306 |
| `npm run test:config` | PASS — 36 contratos después de corregir los P2 de readiness |
| `npm run test:native-config` | PASS — 27 contratos después de corregir los P2 de readiness |
| `npm run test:production-build` | PASS |
| `npm run check:utf8` | PASS |
| `npm run build` | PASS |
| native development con origin HTTPS fixture | PASS |
| native sin origin | EXPECTED BLOCK — exit 1, sin temporales |
| native production con appId placeholder | EXPECTED BLOCK — exit 1, sin temporales |
| `cap sync android` directo | PASS — cinco plugins |
| `npm run verify:native-assets` | PASS — 211 hashes idénticos |
| Gradle 8.13 / JDK 21 | PASS |
| `assembleDebug` | PASS |
| `assembleRelease` sin firma | PASS técnico; artefacto unsigned |
| Gradle `lint` | PASS — 0 errores, 16 warnings no críticos |
| Gradle `test` | PASS |
| ADB device discovery | BLOCKED — lista vacía |
| `npm run build` API | PASS |
| `npm test` API | PASS — 304/304 |
| tests específicos native auth/origin/ws | PASS — 47/47 antes de suite completa |
| `npm audit --omit=dev` API | PASS — 0 vulnerabilidades |

Warnings Android clasificados:

- future compatibility: Gradle emite además el resumen genérico de features deprecadas que serán incompatibles con Gradle 9; no bloquea el wrapper 8.13 actual y no se intentó resolver anticipadamente sin un finding funcional concreto;
- future compatibility: sintaxis Groovy space assignment prevista para retiro en Gradle 10; también aparece dentro de Camera 7;
- third-party/build model: `flatDir` sin metadata;
- future maintenance: AppCompat/CoordinatorLayout/Splashscreen disponibles en versiones nuevas;
- cosmetic/branding: recursos plantilla, icono monocromo ausente, densidades splash inconsistentes;
- harmless ahora: recursos Capacitor/template detectados como no usados.

No se cambió ninguna dependencia Android sólo por existir una versión nueva.

## Dispositivo físico pendiente

Un emulador o un build exitoso no sustituye estas pruebas:

- precisión GPS, permisos coarse/fine, proveedor deshabilitado y timeout;
- cámara/picker con fotos JPEG/PNG reales, cancelación, tamaño y rotación EXIF;
- rotación de pantalla y recreación de Activity;
- suspensión, background prolongado, force stop y restauración de sesión;
- red móvil, cambio Wi-Fi/móvil, mala señal, pérdida y recuperación;
- reconexión WebSocket sin storm y revocación/logout durante background;
- consumo de batería, memoria, performance del perfil/PDF y WebView;
- almacenamiento lleno, picker sin proveedor y permisos restringidos por fabricante;
- upgrade de una versión firmada anterior con el mismo signing key.

## RSP-09F / offline: observaciones, sin implementación

- El installation ID no se restaura a otro dispositivo; una futura cola offline no debe usarlo como único ID durable de operación.
- Drafts y fotos pendientes necesitan una política separada de backup/cifrado; no deben compartir Secure Storage ni el grupo excluido de credenciales por accidente.
- Cada mutación en cola necesitará clave de idempotencia estable, estado de retry y clasificación de errores permanentes/transitorios.
- Conflictos requieren versión/ETag o contrato server-side explícito; no inferir last-write-wins.
- Uploads de fotos necesitan staging app-scoped, checksum, límites y cleanup reconciliable.
- Logout y revocación deben impedir que una cola de otra sesión se reenvíe con credenciales nuevas.

Nada de esto fue implementado en RSP-09E.
