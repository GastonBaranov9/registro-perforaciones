# Móvil 03 — base iOS universal y simulador sin firma

Actualización 04A: el run `41048734153` completó la compilación sobre `8c2bafd2e3d27bb2e62c32cb46924a0edd299e3c`. Se recuperaron y versionaron localmente el proyecto real y su lock Swift; ver [evidencia, inventario y límites de la recuperación](MOVIL_04_PROYECTO_XCODE.md). Los estados de generación/compilación pendientes descritos abajo corresponden al cierre histórico 03D, anterior a ese resultado. No se lanzó otra ejecución durante 04A.

Estado: corrección local 03D sobre `b5bc884d4688a3b3f4edd305313a596aaf4a4a00`, rama `feature/rsp-mobile-multiplataforma`. La primera ejecución remota autorizada por el propietario falló por incompatibilidad SDK/runtime (detalle abajo). En esta corrección no se ejecutó Actions ni Xcode, no se instaló ninguna aplicación ni se realizó login real. Producción 027 permanece intacta. Android físico sigue pendiente por el cable USB.

## Inventario inicial de la etapa 03

Modificados (3): `.gitignore`, `front/package.json`, `front/package-lock.json`.

Nuevos (10):

- `.github/workflows/ios-simulator.yml`
- `docs/MOVIL_03_IOS.md`
- `front/native/ios/permissions.json`
- `front/native/ios/PrivacyInfo.xcprivacy`
- `front/scripts/ios-contract.mjs`
- `front/scripts/ios-simulator-contract.mjs`
- `front/scripts/prepare-ios.mjs`
- `front/scripts/verify-ios.mjs`
- `front/scripts/build-ios-simulator.mjs`
- `front/scripts/native-ios.test.mjs`

Inventario respecto del commit base; la publicación requiere autorización separada. El SHA del único commit local de cierre se registra en el informe de entrega. La APK Android previa conserva SHA-256 `958676df4f0088e0ed3b5629e714ed2a9eb3f811e359789a2bb42a37cb1166e6`. No se incorporaron credenciales ni artefactos generados al inventario.

## Alcance y configuración

Se agregó la dependencia directa exacta `@capacitor/ios@8.5.0`. Core, CLI y Android permanecen en 8.5.0. El lockfile ya contenía iOS como dependencia resuelta: sólo cambia su declaración directa, sin actualizar otros paquetes.

La configuración compartida existente continúa seleccionando la identidad. No se modifica Capacitor Android, Gradle, firma ni la APK anterior.

| Variante | Identidad | Destino |
| --- | --- | --- |
| Producción autorizada para iOS | `uy.com.raulsilva.perforaciones` | `https://api.raulsilvaperforaciones.com` |
| Laboratorio futuro | `uy.com.raulsilva.perforaciones.pruebas` | Archivo privado con allowlist HTTPS; no habilitado ahora |

Nombre productivo: **Raul Silva Perforaciones**. WebSocket: `wss://api.raulsilvaperforaciones.com`. El selector iOS exige variante y backend explícitos; no acepta HTTP, otros orígenes, parámetros mezclados ni desactivación de TLS. El workflow de esta etapa sólo acepta producción. La selección de laboratorio se conserva para una autorización futura.

El proyecto se configura con `TARGETED_DEVICE_FAMILY = 1,2`, mínimo iOS/iPadOS 15.0 y orientaciones vertical/horizontal. Es una aplicación universal. Se conserva `viewport-fit=cover`, los estilos estructurales de Ionic, formularios y geometría existentes. Teclado, áreas seguras, rotación y multitarea de iPad requieren validación real; no se agregaron plugins de teclado ni cambios visuales especulativos.

## Plugins y Swift Package Manager

Se inspeccionaron los `Package.swift` y las clases nativas instaladas. Todos los plugins actuales ofrecen SPM:

| Paquete instalado | Producto / clase iOS | Observación |
| --- | --- | --- |
| `@capacitor/app@8.0.0` | CapacitorApp / AppPlugin | Ciclo de vida, sin promesa de tareas en background |
| `@capacitor/camera@8.0.0` | CapacitorCamera / CAPCameraPlugin | Cámara y selección de galería |
| `@capacitor/filesystem@8.0.0` | CapacitorFilesystem / FilesystemPlugin | Depende además de ion-ios-filesystem |
| `@capacitor/geolocation@8.0.0` | CapacitorGeolocation / GeolocationPlugin | Depende además de ion-ios-geolocation |
| `@capacitor/preferences@8.0.0` | CapacitorPreferences / PreferencesPlugin | UserDefaults |
| `@capacitor/share@8.0.0` | CapacitorShare / SharePlugin | El código iOS prepara popover centrado para iPad |
| `@aparajita/capacitor-secure-storage@8.0.0` | AparajitaCapacitorSecureStorage / SecureStorage | KeychainSwift |

No se detectó incompatibilidad declarada con Capacitor 8. La primera ejecución resolvió dependencias Swift, pero no completó la compilación; no acredita que todos los plugins compilen correctamente. No se introdujo CocoaPods ni se cambiaron plugins. Las declaraciones SPM tienen rangos transitivos: **se debe obtener, revisar y versionar `Package.resolved` tras un build satisfactorio**. El procedimiento conserva ese archivo en la evidencia; los builds posteriores con lock existente exigen sus versiones y rechazan su modificación. Capacitor queda fijado a 8.5.0 exacto. No se afirma reproducibilidad binaria absoluta de la primera resolución remota.

## Permisos y privacidad

`front/native/ios/permissions.json` contiene las descripciones en español. El configurador las aplica a `Info.plist` de manera idempotente:

- Cámara: tomar una fotografía por decisión del usuario.
- Biblioteca de fotografías: seleccionar una imagen para adjuntarla.
- Ubicación durante el uso: completar coordenadas.
- `NSLocationAlwaysAndWhenInUseUsageDescription`: descripción requerida por la biblioteca enlazada del plugin Geolocation; usa el mismo texto de ubicación durante el uso. **No habilita una solicitud de ubicación permanente, background location ni UIBackgroundModes.** Esta particularidad está documentada por [Capacitor Geolocation](https://capacitorjs.com/docs/apis/geolocation).

No se incorpora `NSPhotoLibraryAddUsageDescription`: la aplicación usa `saveToGallery: false` y no guarda fotografías en la biblioteca. Si se agrega ese comportamiento deberá revisarse el permiso. Tampoco se declaran micrófono, contactos, tracking, grupos Keychain ni iCloud.

`PrivacyInfo.xcprivacy` se registra como recurso real de la aplicación, no sólo como archivo en una carpeta. Declara:

- UserDefaults, razón **CA92.1**: preferencias propias, instalación y estado de cierre de sesión. El grupo `RspNativeClient` es un prefijo del almacenamiento, no un App Group compartido. [Referencia de Preferences](https://capacitorjs.com/docs/apis/preferences).
- FileTimestamp, razón **C617.1**: metadatos de archivos del contenedor y caché propios; Filesystem expone ctime/mtime y la limpieza de PDFs consulta esos metadatos. [Referencia de Filesystem](https://capacitorjs.com/docs/apis/filesystem).

Se declara ausencia de tracking. No se inventa una declaración de «ningún dato recogido»: la ficha de privacidad de distribución y `NSPrivacyCollectedDataTypes` requieren revisión del flujo real de cuenta, fotografías, ubicación y datos empresariales antes de TestFlight/App Store. También se deben revisar los manifests y APIs de las dependencias Swift efectivamente resueltas y el reporte agregado de privacidad de Xcode. Esto no impide preparar un build de simulador sin distribución.

## Autenticación y datos locales existentes

La WKWebView utiliza el origen predeterminado `capacitor://localhost`. No se agrega `server.url`, navegación remota ni excepciones ATS. La configuración de API en código contempla ese origen nativo; su aceptación efectiva en producción debe comprobarse en una prueba de consulta autorizada, sin cambiar ahora variables productivas.

El flujo nativo compartido usa Bearer; el interceptor sólo lo adjunta a la API autorizada. El servicio de sesión conserva token e identidad de instalación en SecureStorage/Keychain con `whenUnlockedThisDeviceOnly` y `setSynchronize(false)`. No se agrega almacenamiento plano de tokens, sincronización iCloud ni access groups. Logout/revocación y tickets WebSocket siguen utilizando los contratos existentes. Los tests ejercitan esas decisiones con mocks, no con sesiones empresariales. Keychain puede sobrevivir a una reinstalación: no usar desinstalar/borrar datos como reparación automática.

La cola offline conserva namespace por origen/usuario, identificadores de operación, payload e idempotencia. Fotografías pendientes usan Filesystem y el contenedor de la app. La sincronización existente se reanuda con conectividad en primer plano; **no se promete sincronización mientras iOS suspende la aplicación**. Edición offline general de pozos existentes y generación completa de PDF offline no forman parte del alcance comprobado.

El PDF se solicita al backend, se comprueba, se guarda en caché y se comparte con el plugin Share. No se genera un PDF completo offline. El GPS actual usa `navigator.geolocation`; los permisos WKWebView y la precisión del iPad (según modelo) siguen pendientes de pruebas físicas. No se reemplaza la implementación empresarial por una suposición sobre el dispositivo.

## Generación real del proyecto y verificación

`front/ios` sigue ausente en Windows. Los tests extraen la plantilla oficial **solamente a directorios temporales**, usan el generador SPM oficial y prueban el parche PBX/Info.plist. Esos fixtures no son un proyecto compilado ni un artefacto instalable.

Con autorización posterior, en el runner macOS arm64 evaluado con Xcode 26.2 y runtime iOS 26.2 disponible:

```bash
# Desde front, después del checkout del SHA completo autorizado.
export DEVELOPER_DIR=/Applications/Xcode_26.2.app/Contents/Developer
export RSP_MOBILE_VARIANT=production
export NATIVE_BACKEND_ORIGIN=https://api.raulsilvaperforaciones.com
unset NATIVE_LAB_CONFIG
# IOS_APPROVED_SHA debe ser el SHA real aprobado, no el SHA base con archivos locales.
npm ci --no-audit --no-fund
npm run build:native:production
npm run prepare:ios
npm run verify:ios
npm run build:ios:simulator
```

`prepare:ios` rechaza Windows. Si el proyecto no existe ejecuta `cap add ios --packagemanager SPM`, luego `cap sync ios`; aplica permisos, identidad universal y privacy manifest de manera determinista. Si existe, exige una estructura SPM reconocible. No sobrescribe un proyecto CocoaPods/incompleto. El verificador exige las clases y productos de los siete plugins, rutas a los paquetes instalados, política de red, manifest en Resources y hashes de assets iguales al build Angular.

`build:ios:simulator` exige SHA aprobado, código versionado sin modificaciones, Xcode **26.2 (17C52)**, SDK **iphonesimulator26.2** y runtime **iOS 26.2** disponibles. El preflight se detalla abajo. Verifica settings efectivos y ejecuta `xcodebuild` con `CODE_SIGNING_ALLOWED=NO`, `CODE_SIGNING_REQUIRED=NO`, identidad de firma y equipo vacíos. Rechaza entitlements de firma y artefactos con firma/provisioning inesperados. No inicia un simulador, no abre la app y no llama a producción. El mínimo de la aplicación continúa en **iOS 15.0**.

Después verifica Info.plist del `.app`, familia `[1,2]`, bundle ID, nombre, mínimo iOS 15.0, permisos, privacidad y copia de assets. También exige `IPHONEOS_DEPLOYMENT_TARGET=15.0` en los settings efectivos: un override no puede pasar sólo porque el PBX original indique 15.0. Emite `IOS_SIMULATOR_BUILD_OK` sólo tras completar esas comprobaciones.

Evidencias en `front/dist/ios-evidence/`:

- `build.json`: SHA, Xcode, SDK efectivo y ruta, arquitectura, identidad/versión/build del runtime, Capacitor, identidad, API/WSS, resultado y hash de resolución Swift.
- `Package.resolved`: revisarlo y conservarlo para futuros builds.
- `ios-project-review.tgz`: proyecto nativo para revisión, sin assets web ni configuración copiada local.
- `simulator-app.tgz`: aplicación de simulador **sin firma**, no IPA ni aplicación instalable en un iPhone.

Tras la primera ejecución autorizada, descargar y revisar el proyecto; en una etapa separada incorporar a Git `front/ios` con AppDelegate/SceneDelegate, assets/storyboards, Info.plist, PrivacyInfo, proyecto PBX y configuración SPM/Package.resolved. Mantener excluidos public, capacitor.config.json, DerivedData, xcuserdata y material de firma. El workflow nunca realiza ese commit automáticamente.

## GitHub Actions sin Mac local

`.github/workflows/ios-simulator.yml` usa sintaxis JSON válida como YAML, para permitir su validación estructural local sin agregar un parser. Sólo tiene `workflow_dispatch`, no push/PR/schedule. Requiere un SHA completo igual al SHA de la rama seleccionada; hace checkout de ese mismo SHA. Las acciones oficiales se fijan por SHA, los permisos son `contents: read` y no se conservan credenciales Git ni se usan secretos Apple/productivos.

Runner `macos-26`, Node 24.18.0 y Xcode estable seleccionado por ruta, sin `macos-latest` ni selección automática. El [inventario de la imagen arm64 realmente utilizada](https://github.com/actions/runner-images/blob/macos-26-arm64/20261021.0445/images/macos/macos-26-arm64-Readme.md) incluye Xcode 26.2 (17C52), SDK y runtime de simulador 26.2. Si GitHub cambia la combinación, el control falla y exige revisión; no cambia silenciosamente de compilador. [Apple documenta Xcode 26.2 con SDK iOS 26.2 y soporte de iOS 15](https://developer.apple.com/xcode/system-requirements).

Los contratos del job excluyen el probe Gradle, pues el runner iOS no requiere Android SDK. Después de compilar, los artefactos se conservan siete días. No hay distribución, login, despliegue ni escrituras empresariales. Los minutos macOS pueden generar costos; no se lanzó ni reintentó el workflow durante la corrección 03D.

**Registro manual ya disponible:** el workflow existe en `main` tras el PR #19, verificado mediante lectura de GitHub. GitHub permite seleccionar otra rama al ejecutar manualmente un workflow registrado en la rama predeterminada. [Documentación oficial](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). Para el siguiente intento, primero autorizar el push del nuevo commit 03D y, por separado, una nueva ejecución seleccionando `feature/rsp-mobile-multiplataforma` con su **nuevo SHA completo**. Esa selección utiliza el workflow revisado de la rama móvil; no reutilizar `b5bc884` ni pulsar Re-run sobre el intento fallido. No ejecutar sobre `main`, que no contiene los scripts móviles. No se modifica `main` ni se agregan triggers automáticos en 03D.

## Pruebas locales y límites

Evidencias históricas del cierre 03 (anteriores al parche 03D):

- Resolución npm: dependencia iOS directa 8.5.0; plugins y Core/CLI sin cambios de versión.
- Contratos nativos: **131/131**, incluidos **41 casos iOS**. Cubren SPM, identidad del artefacto, modos mezclados, patrones de secretos y mínimo iOS efectivo.
- Angular con ChromeHeadless: 140/140 para runtime, configuración nativa, Keychain simulado, offline, interceptor, autenticación y WebSocket.
- Total: **271 casos únicos** (131 + 140). Los 41 iOS están incluidos en 131; no se suman nuevamente. Las dos reproducciones negativas previas a la corrección tampoco se contabilizan como casos adicionales.
- Build Angular nativo productivo: correcto. Advertencia `empty-glob` de Stencil; sin error de compilación.
- Assets reales del build: `IOS_WEB_ASSETS_VERIFIED`, con HTTPS/WSS, CSP, hashes e inspección de patrones de secretos. Ese marcador no certifica un binario iOS.
- Sintaxis de scripts, workflow manual estático y `git diff --check`: correctos.
- YAML: análisis adicional con el parser ya instalado en las dependencias API, sin cambiar dependencias; documento válido y equivalente al JSON original, sin claves duplicadas.
- HTTPS real: consulta GET sin autenticación a `/api/ready`, HTTP 200 y verificación TLS satisfactoria. No se consultaron datos empresariales ni se crearon sesiones.

Los primeros intentos dentro del sandbox fallaron por acceso a archivos/identidad de Windows; las mismas verificaciones se ejecutaron con acceso local autorizado. Las pruebas de la plantilla detectaron un supuesto incorrecto de la biblioteca PBX sobre el grupo Resources; se corrigió el registro real del recurso, sin relajar su verificación. No se cambiaron tests empresariales ni se modificó Android.

En el cierre se reprodujo una omisión del verificador: aceptaba un `.app` o settings efectivos con mínimo iOS distinto/ausente, aunque el PBX declarara 15.0. Dos pruebas negativas fallaron antes del parche y pasaron después de exigir 15.0 en ambos niveles. La corrección sólo afecta los verificadores y sus tests; no cambia código empresarial, permisos ni el destino del build.

No se validó todavía: compilación Xcode completa y plugins Swift en conjunto, revisión del lock resuelto, agregado final de privacidad por Xcode, renderizado en simulador, permisos/cámara/Keychain reales, suspensión/reanudación, teclado, share sheet de iPad, GPS ni persistencia tras cierre físico. Una compilación exitosa tampoco certificará esas pruebas.

## Incidente y corrección 03D — SDK y runtime

Se revisó el log completo del [run 40982213300, job 123824739601](https://github.com/GastonBaranov9/registro-perforaciones/actions/runs/40982213300), ejecutado sobre `b5bc884d4688a3b3f4edd305313a596aaf4a4a00`. Imagen `macos-26-arm64`, versión `20261021.0445.8`, macOS 26.6.2. Las pruebas nativas, instalación, build Angular y generación oficial iOS finalizaron; el primer error nativo fue en `CompileAssetCatalogVariant`, a las 00:53:51 UTC del 30/10/2026:

```text
No simulator runtime version from ["23C54", "23E254a", "23F77"] available to use with iphonesimulator SDK version 23A339
```

Xcode seleccionado: 26.0.1 (17A400), SDK `iphonesimulator26.0`. Los runtimes observados por actool eran posteriores; el inventario de esa imagen documenta iOS 26.2, 26.4.1 y 26.5, no 26.0. No aparecen errores nativos independientes antes de ese fallo. El exit code de Node es consecuencia del `xcodebuild` fallido, no la causa. Esto no demuestra un defecto Angular ni de los plugins y tampoco acredita su compilación completa.

El parche modifica solamente cinco archivos: workflow, `ios-simulator-contract.mjs`, `build-ios-simulator.mjs`, `native-ios.test.mjs` y este documento. No cambia dependencias, privacidad, identidad, backend, Android ni mínimo iOS.

Antes de consultar settings o invocar `xcodebuild build`, el preflight:

1. Exige Xcode 26.2/17C52 y `DEVELOPER_DIR` exacto; consulta `xcodebuild -version` y `-showsdks` con coincidencia completa de SDK.
2. Comprueba versión y ruta efectiva del SDK mediante `xcrun --sdk ... --show-sdk-version/--show-sdk-path`, rechazando instalaciones mezcladas.
3. Exige host y Node arm64 nativos, coherentes con la imagen evaluada. Intel/Rosetta quedan bloqueados hasta evaluación explícita; no se infiere compatibilidad universal de herramientas.
4. Analiza JSON de `xcrun simctl list runtimes -j`. Exige un único runtime con identificador `com.apple.CoreSimulator.SimRuntime.iOS-26-2`, versión 26.2, `isAvailable=true`, sin error de disponibilidad y con identidad de build. La presencia del SDK sola no basta.
5. Exige arquitectura arm64 incluida y no excluida en los settings efectivos; conserva comprobaciones de SDK, mínimo 15.0, familia universal y firma deshabilitada.

Emite `IOS_SIMULATOR_PREFLIGHT_OK` con evidencia técnica y añade esa evidencia a `build.json` únicamente si el build completo termina correctamente. Un runtime ausente/no disponible, JSON inválido o cualquier contradicción bloquea la compilación; no descarga componentes, inicia simuladores, cambia de Xcode ni reintenta automáticamente. La consulta simctl es evidencia de disponibilidad local, no una prueba de ejecución física de la app.

Regresiones locales 03D: **156/156 contratos nativos, incluidos 66 casos iOS**, y **140/140 Angular** (autenticación, almacenamiento seguro simulado, offline e interceptor/WebSocket). Total **296 casos únicos**; la ejecución focalizada de los 66 iOS no se vuelve a sumar. Los casos nuevos cubren runtime ausente, posterior, ambiguo, contradictorio o no disponible, JSON inválido, error de simctl, SDK/Xcode equivocados, mezcla de rutas, arquitecturas, SHA no aprobado y firma. Se conservan las pruebas de mínimo iOS 15.0.

Build Angular nativo y `IOS_WEB_ASSETS_VERIFIED` satisfactorios, incluidos CSP/HTTPS/WSS e inventario de hashes. El primer build local falló por acceso denegado del sandbox; el mismo comando con acceso autorizado pasó, sin corregir código empresarial. Permanece la advertencia no bloqueante `empty-glob` de Stencil. Sintaxis Node, YAML/JSON y `git diff --check` revisados. La APK previa conserva su SHA-256; no se generaron artefactos Android. Estas verificaciones no sustituyen la próxima compilación macOS ni las pruebas físicas.

## Pasos siguientes separados por autorización

1. Revisar el commit local de cierre y autorizar su publicación por separado.
2. Autorizar por separado una nueva ejecución manual del workflow ya registrado, seleccionando la rama móvil publicada y el nuevo SHA definitivo 03D. Obtener el primer build completo sin firma y revisar resolución Swift, proyecto y manifests transitivos.
3. Revisar y versionar el proyecto generado/lock. Ejecutar regresión de simulador con ese estado reproducible.
4. Para iPhone/iPad físicos: definir identidad registrada, equipo Apple, firma y aprovisionamiento. El simulador no necesita Apple Developer; TestFlight/Ad Hoc requiere la membresía correspondiente, certificados/perfiles y eventualmente App Store Connect. Nada de ello se solicitó ni configuró aquí. [Opciones oficiales de Apple](https://developer.apple.com/support/compare-memberships/).
5. Con autorización específica de instalación: probar primero apertura, login del propietario, consultas, perfil/PDF y orientación vertical/horizontal, sin crear registros, subir fotos ni sincronizar escrituras. Esta app comparte funcionalidades empresariales; **no es una variante técnicamente de sólo lectura**. El límite de consulta es operativo, no una promesa de bloqueo de todos los botones de escritura.
6. Autorizar por separado pruebas offline con datos/control de numeración adecuados. No confundir Safari con almacenamiento nativo ni borrar colas locales para recuperar una prueba.

Pendiente independiente: **perfil constructivo en blanco y negro siguiendo la fotografía de referencia del propietario**, sin modificar geometría, profundidades, intervalos ni grosores aprobados 0.13. No se implementa en esta etapa.
