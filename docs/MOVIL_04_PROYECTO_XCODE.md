# Móvil 04A — recuperación del proyecto Xcode compilado

Rama: `feature/rsp-mobile-multiplataforma`. Base: `8c2bafd2e3d27bb2e62c32cb46924a0edd299e3c`. Esta etapa recupera código nativo existente; no genera un proyecto ficticio, no lanza Actions/Xcode, no firma ni instala aplicaciones y no accede a producción.

## Procedencia e integridad

- [Run 41048734153](https://github.com/GastonBaranov9/registro-perforaciones/actions/runs/41048734153), job `124039225225`, attempt 1, `workflow_dispatch`, conclusión `success` sobre el SHA base exacto.
- Artefacto `ios-simulator-8c2bafd2e3d27bb2e62c32cb46924a0edd299e3c`, ID `12972864987`, 7.668.127 bytes. La API de GitHub publicó el digest SHA-256 `12ae0dce0c2e5b3a3decb499935773828aca4b058493c7573181ebdf73086892`.
- Se utilizó el ZIP previamente descargado `rsp-ios-simulator-success.zip`. Su hash coincide exactamente con ese digest. Se trabajó sobre una copia temporal, sin extraer sobre el repositorio ni ejecutar binarios. La evidencia privada completa no entra en Git.
- ZIP: exactamente `build.json`, `Package.resolved`, `ios-project-review.tgz`, `simulator-app.tgz`; CRC32, tamaños y descompresión correctos. Se rechazaron rutas absolutas, segmentos `..`, rutas Windows incrustadas, duplicados y enlaces/archivos especiales antes de extraer.
- Log: `IOS_SIMULATOR_PREFLIGHT_OK` a las 11:33:20 UTC; `BUILD SUCCEEDED` a las 11:34:56; `IOS_SIMULATOR_BUILD_OK` a las 11:34:58 del 30/10/2026.
- `build.json`: Xcode **26.2 (17C52)**, SDK **iphonesimulator26.2**, runtime **26.2 (23C54)** disponible, host **arm64**, Capacitor **8.5.0**, identidad **uy.com.raulsilva.perforaciones**, familia **[1,2]**, `signed=false`, primera resolución Swift. Orígenes: `https://api.raulsilvaperforaciones.com` y `wss://api.raulsilvaperforaciones.com`.

El archivo de simulador se inspeccionó en temporal: 279 entradas, 15.449.212 bytes descomprimidos; 237 assets web validados por hashes/CSP/HTTPS/WSS y las siete clases de plugins esperadas. No se ejecutó. La app no tiene `_CodeSignature` raíz ni provisioning profile; los frameworks precompilados de Capacitor/Cordova sí incluyen sus propios `CodeResources`. Esas firmas de dependencias no son firma de distribución de la app ni material privado de Apple; ninguno de esos binarios se incorpora al repositorio.

## Resolución Swift

El lock independiente coincide **byte por byte** con el del workspace recuperado. Ambos coinciden con `spmSha256` de `build.json`: `56a364979903d2990a2eaad3fb86781113e286e27d4c7d63a7945dc9722ae9df`.

Formato SwiftPM 3, cuatro pins `remoteSourceControl`, sin repositorios adicionales:

| Identidad | Versión | Revisión fijada | Repositorio |
| --- | --- | --- | --- |
| capacitor-swift-pm | 8.5.0 | `4f71d0b979f2f957326f04353eca7604ee937e1e` | `https://github.com/ionic-team/capacitor-swift-pm.git` |
| ion-ios-filesystem | 1.1.4 | `56bd6f9e77cb4f2269c03f2d92a9fe58fe168a1c` | `https://github.com/ionic-team/ion-ios-filesystem.git` |
| ion-ios-geolocation | 2.1.1 | `db363927d3a954e3ea24d2e72b6e9814769a84be` | `https://github.com/ionic-team/ion-ios-geolocation.git` |
| keychain-swift | 21.0.0 | `265806607b45687a3d646e4c9837c31c90f202e8` | `https://github.com/evgenyneu/keychain-swift.git` |

Los manifiestos instalados de Filesystem, Geolocation y SecureStorage declaran estos repositorios y rangos compatibles. Capacitor está fijado a 8.5.0 exacto. Los siete plugins se enlazan desde rutas relativas a `node_modules`, cuyas versiones continúan fijadas por `package-lock.json`. No se actualizó ninguna dependencia. La compilación exitosa acredita el enlace de esta combinación para simulador; no acredita funcionalidades físicas de los plugins.

## Inventario recuperado

Se importan estos **21 archivos**, idénticos al artefacto, bajo `front/ios/`:

```text
.gitignore
debug.xcconfig
App/App.xcodeproj/project.pbxproj
App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
App/App/AppDelegate.swift
App/App/SceneDelegate.swift
App/App/Info.plist
App/App/PrivacyInfo.xcprivacy
App/App/Base.lproj/Main.storyboard
App/App/Base.lproj/LaunchScreen.storyboard
App/App/Assets.xcassets/Contents.json
App/App/Assets.xcassets/AppIcon.appiconset/Contents.json
App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
App/App/Assets.xcassets/Splash.imageset/Contents.json
App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png
App/CapApp-SPM/.gitignore
App/CapApp-SPM/README.md
App/CapApp-SPM/Package.swift
App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift
```

Se añade `front/ios/.gitattributes`: texto nativo LF y PNG binario, para que `core.autocrlf=true` en Windows no cambie los bytes del lock revisado. No altera atributos de Android ni otros módulos.

Otros cambios: cinco contratos adicionales en `front/scripts/native-ios.test.mjs`, este documento y una nota de actualización en `docs/MOVIL_03_IOS.md`.

Excluidos: ZIP/TGZ, `.app`, binarios, assets web `public`, `capacitor.config.json`, `config.xml`, Cordova generado, `IDEWorkspaceChecks.plist`, directorios vacíos/caches `.swiftpm`, `.build`, `Packages`, DerivedData, xcuserdata y material de firma. El `.gitignore` recuperado y el raíz conservan las exclusiones. `config.xml`, `public` y `capacitor.config.json` siguen referenciados por Xcode: los regenera `cap sync ios` antes del build, no deben eliminarse esas referencias ni versionarse esos resultados.

## Auditoría nativa

Un único target universal, iOS mínimo **15.0**, bundle ID aprobado, nombre `Raul Silva Perforaciones`, retrato y paisaje; iPad admite también retrato invertido. AppDelegate/SceneDelegate usan el bridge oficial. Los storyboards y recursos conservan sus referencias relativas. No hay rutas del runner, scripts de shell añadidos al PBX, equipos Apple, perfiles, entitlements, Keychain compartido ni iCloud.

El proyecto conserva los valores de plantilla `CODE_SIGN_STYLE=Automatic` e identidad genérica `iPhone Developer`, sin equipo ni credenciales. El procedimiento de simulador impone `CODE_SIGNING_ALLOWED=NO`, `CODE_SIGNING_REQUIRED=NO`, identidad/equipo vacíos y verifica los settings efectivos; no se interpreta la plantilla como una autorización para firmar.

Privacy Manifest idéntico al aprobado, incorporado exactamente una vez en Resources: UserDefaults **CA92.1**, FileTimestamp **C617.1**, sin tracking. Cámara, selección de fotografías y ubicación durante el uso conservan los textos españoles existentes. La clave `NSLocationAlwaysAndWhenInUseUsageDescription` está por requisito del plugin enlazado, con el texto de uso en primer plano; no se añadió una solicitud de ubicación permanente, capacidad background, ATS, HTTP ni excepciones TLS. No se añade permiso de guardar en galería.

Continúa pendiente la revisión de privacidad agregada y declaraciones de datos para distribución. Autenticación, Keychain, cola offline y código empresarial no se modifican.

**Branding pendiente:** inspección visual del ícono y las tres imágenes de splash confirma recursos predeterminados de Capacitor. Se conservan sin sustituciones improvisadas. Deben diseñarse/revisarse antes de distribuir una aplicación con marca definitiva.

## Reproducibilidad y límites

El `prepare:ios` existente reconoce el proyecto SPM y no necesita `cap add`. Después de `npm ci` y build Angular, ejecuta `cap sync ios`, aplica la política y verifica los assets. No fue necesario modificar scripts de preparación ni de compilación.

En Windows se comprobó sobre una copia temporal que `configureIos` deja idénticos Info.plist, PBX, Privacy Manifest, Package.swift y lock. También se comprobó que el generador SPM oficial, con los plugins instalados en su orden real y separadores POSIX, reproduce exactamente el Package.swift recuperado. Las rutas resuelven a los paquetes actuales. Esto no ejecuta `cap sync` ni Xcode en Windows.

Los futuros builds usan el lock versionado con `-onlyUsePackageVersionsFromResolvedFile` y rechazan cambios del lock. `firstSpmResolution` deberá ser `false`. El guard de Git limpio sigue activo: cualquier cambio inesperado en archivos versionados durante preparación bloquea la compilación. No se debilitaron validadores.

La comprobación pendiente es otra compilación macOS desde el **nuevo SHA publicado y autorizado**, usando el proyecto ya versionado. No se afirma reproducibilidad binaria absoluta ni funcionamiento físico a partir de estas pruebas estáticas.

## Verificaciones locales

- `npm run test:native-config`: **161/161**, incluidos **71 iOS**. La ejecución focalizada previa `npm run test:ios` también pasó 71/71 y no se vuelve a sumar.
- Angular/ChromeHeadless: **140/140**, seleccionando `core/native/*.spec.ts`, `core/interceptors/native-token-interceptor.spec.ts`, `shared/services/auth-service/*.spec.ts` y `shared/services/websocket.native.spec.ts`. Autenticación, almacenamiento seguro simulado, offline e interceptor/WebSocket. **301 casos únicos** en total.
- `npm run build:native:production` y `node scripts/verify-ios.mjs --web-only`, con variante y HTTPS productivos explícitos: correctos. CSP, WSS, inventario de hashes y contrato CSS verificados sin conexión empresarial. El primer intento del build fue bloqueado por permisos del sandbox; el mismo comando fuera del sandbox pasó sin cambios de código. Permanece la advertencia no bloqueante `empty-glob` de Stencil.
- Sintaxis Node, análisis YAML/JSON del workflow existente, reglas de exclusión y `git diff --check`: correctos. Inspección del contenido importado sin secretos ni datos empresariales. El detector encuentra un marcador ficticio de clave privada en una prueba negativa preexistente, idéntica al padre; no contiene una clave.
- APK Android previa: SHA-256 `958676df4f0088e0ed3b5629e714ed2a9eb3f811e359789a2bb42a37cb1166e6`, conservado. No se sincronizó Android ni se construyó otra APK. Los contratos compartidos inspeccionan modelos Gradle sintéticos, sin producir APK.

Los cinco contratos añadidos cubren proyecto real, pins/hash del lock, idempotencia sobre copia, generación SPM y reglas de Git. No se corrigió lógica nativa ni empresarial: sólo se preservaron los finales de línea y se añadió cobertura de importación. Las pruebas sobre plantillas/copias temporales no se presentan como otra compilación Xcode ni como validación física.

## Próximas autorizaciones y pendientes

1. Revisión del commit local y autorización separada de push.
2. Autorización separada de un build manual de simulador con el nuevo SHA de la rama móvil; no Re-run del SHA anterior ni ejecución sobre main.
3. Branding, privacidad de distribución, firma Apple y aprovisionamiento siguen pendientes, sin certificados ni cuentas configuradas aquí.
4. Instalación iPhone/iPad y pruebas de login, cámara, GPS, PDF, rotación/teclado, almacenamiento real, suspensión y sincronización requieren autorización posterior. Android físico continúa pendiente por el cable USB; su APK no cambia.
5. Edición offline general de pozos existentes y PDF completamente offline continúan fuera del alcance comprobado. No prometer sincronización mientras iOS suspende la app ni ejecutar escrituras empresariales sin autorización específica.

Pendiente independiente: **perfil constructivo en blanco y negro según la fotografía de referencia del propietario**, conservando geometría, profundidades, intervalos y espesores aprobados 0.13. No se implementa ahora.
