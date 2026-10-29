# Móvil 03 — base iOS universal y simulador sin firma

Estado: base iOS revisada para cierre mediante un único commit local. Base `c4b90d1a404e545496af34526b7359ee73d2ac95`, rama `feature/rsp-mobile-multiplataforma`. No se ejecutó GitHub Actions, Xcode, una instalación ni un login real. No se intervino producción 027. Android físico sigue pendiente por el cable USB.

## Inventario local

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

No se detectó incompatibilidad declarada con Capacitor 8. La resolución y compilación Swift real quedan pendientes del runner. No se introdujo CocoaPods ni se cambiaron plugins. Las declaraciones SPM de los plugins tienen rangos para dependencias transitivas; **el primer build todavía debe obtener y revisar `Package.resolved`**. El procedimiento conserva ese archivo en la evidencia; los builds posteriores con lock existente exigen sus versiones y rechazan su modificación. Capacitor queda fijado a 8.5.0 exacto. No se afirma reproducibilidad binaria absoluta de la primera resolución remota.

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

Con autorización posterior, en un macOS con Xcode 26.0.1:

```bash
# Desde front, después del checkout del SHA completo autorizado.
export DEVELOPER_DIR=/Applications/Xcode_26.0.1.app/Contents/Developer
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

`build:ios:simulator` exige SHA aprobado, código versionado sin modificaciones, Xcode **26.0.1 (17A400)** y SDK **iphonesimulator26.0** realmente disponibles. Verifica settings efectivos y ejecuta `xcodebuild` con `CODE_SIGNING_ALLOWED=NO`, `CODE_SIGNING_REQUIRED=NO`, identidad de firma y equipo vacíos. Rechaza entitlements de firma y artefactos con firma/provisioning inesperados. No inicia un simulador, no abre la app y no llama a producción.

Después verifica Info.plist del `.app`, familia `[1,2]`, bundle ID, nombre, mínimo iOS 15.0, permisos, privacidad y copia de assets. También exige `IPHONEOS_DEPLOYMENT_TARGET=15.0` en los settings efectivos: un override no puede pasar sólo porque el PBX original indique 15.0. Emite `IOS_SIMULATOR_BUILD_OK` sólo tras completar esas comprobaciones.

Evidencias en `front/dist/ios-evidence/`:

- `build.json`: SHA, Xcode, SDK, Capacitor, identidad, API/WSS, resultado y hash de resolución Swift.
- `Package.resolved`: revisarlo y conservarlo para futuros builds.
- `ios-project-review.tgz`: proyecto nativo para revisión, sin assets web ni configuración copiada local.
- `simulator-app.tgz`: aplicación de simulador **sin firma**, no IPA ni aplicación instalable en un iPhone.

Tras la primera ejecución autorizada, descargar y revisar el proyecto; en una etapa separada incorporar a Git `front/ios` con AppDelegate/SceneDelegate, assets/storyboards, Info.plist, PrivacyInfo, proyecto PBX y configuración SPM/Package.resolved. Mantener excluidos public, capacitor.config.json, DerivedData, xcuserdata y material de firma. El workflow nunca realiza ese commit automáticamente.

## GitHub Actions sin Mac local

`.github/workflows/ios-simulator.yml` usa sintaxis JSON válida como YAML, para permitir su validación estructural local sin agregar un parser. Sólo tiene `workflow_dispatch`, no push/PR/schedule. Requiere un SHA completo igual al SHA de la rama seleccionada; hace checkout de ese mismo SHA. Las acciones oficiales se fijan por SHA, los permisos son `contents: read` y no se conservan credenciales Git ni se usan secretos Apple/productivos.

Runner `macos-26`, Node 24.18.0 y Xcode estable seleccionado por ruta, sin `macos-latest` ni selección automática. El [inventario oficial del runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md) consultado incluye Xcode 26.0.1 y su SDK. Si GitHub los retira, el control falla y exige revisión; no cambia silenciosamente de compilador. [Capacitor requiere Xcode 26+](https://capacitorjs.com/docs/ios).

Los contratos del job excluyen el probe Gradle, pues el runner iOS no requiere Android SDK. Después de compilar, los artefactos se conservan siete días. No hay distribución, login, despliegue ni escrituras empresariales. Los minutos macOS pueden generar costos; no se ejecutó el workflow en esta etapa.

**Bloqueo operativo de activación:** la rama predeterminada es `main`. GitHub exige que `workflow_dispatch` exista en ella para su activación manual normal. Publicar sólo la rama móvil no resuelve este requisito. [Documentación oficial](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=webui). Se propone autorizar posteriormente una incorporación revisada de este workflow a `main`, sin fusionar funcionalidades móviles ni desplegar; luego seleccionar explícitamente `feature/rsp-mobile-multiplataforma` y su SHA aprobado para ejecutarlo. La guarda exige que ese SHA coincida con la rama elegida. No se modificó `main`, no se abrió PR y no se ejecutó ningún workflow en este cierre. No se habilita un disparador por push ni se asume que `gh workflow run --ref` elimina el requisito inicial.

## Pruebas locales y límites

Verificaciones repetidas en Windows durante el cierre técnico:

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

No se validó todavía: resolución Swift en macOS, compilación Xcode, agregado final de privacidad por Xcode, renderizado en simulador, permisos/cámara/Keychain reales, suspensión/reanudación, teclado, share sheet de iPad, GPS ni persistencia tras cierre físico. Una compilación exitosa tampoco certificará esas pruebas.

## Pasos siguientes separados por autorización

1. Revisar el commit local de cierre y autorizar su publicación por separado.
2. Autorizar el registro y la ejecución manual del workflow para un SHA definitivo. Obtener el primer build sin firma y revisar resolución Swift, proyecto y manifests transitivos.
3. Revisar y versionar el proyecto generado/lock. Ejecutar regresión de simulador con ese estado reproducible.
4. Para iPhone/iPad físicos: definir identidad registrada, equipo Apple, firma y aprovisionamiento. El simulador no necesita Apple Developer; TestFlight/Ad Hoc requiere la membresía correspondiente, certificados/perfiles y eventualmente App Store Connect. Nada de ello se solicitó ni configuró aquí. [Opciones oficiales de Apple](https://developer.apple.com/support/compare-memberships/).
5. Con autorización específica de instalación: probar primero apertura, login del propietario, consultas, perfil/PDF y orientación vertical/horizontal, sin crear registros, subir fotos ni sincronizar escrituras. Esta app comparte funcionalidades empresariales; **no es una variante técnicamente de sólo lectura**. El límite de consulta es operativo, no una promesa de bloqueo de todos los botones de escritura.
6. Autorizar por separado pruebas offline con datos/control de numeración adecuados. No confundir Safari con almacenamiento nativo ni borrar colas locales para recuperar una prueba.

Pendiente independiente: **perfil constructivo en blanco y negro siguiendo la fotografía de referencia del propietario**, sin modificar geometría, profundidades, intervalos ni grosores aprobados 0.13. No se implementa en esta etapa.
