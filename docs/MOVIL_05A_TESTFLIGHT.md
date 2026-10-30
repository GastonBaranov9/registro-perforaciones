# Etapa móvil 05A — preparación local de TestFlight

Auditoría del 30/10/2026, desde `232f12553c726be7ad99eb62033d00a5ab5cad1e`, rama `feature/rsp-mobile-multiplataforma`. La API/web empresarial continúa en 027. No se modifica código de aplicación, proyecto Xcode, Android, workflow, versiones ni dependencias.

**No está lista para distribuir por TestFlight.** La membresía individual está pendiente según el propietario. No se consultó su cuenta Apple. La ejecución manual [41059732780](https://github.com/GastonBaranov9/registro-perforaciones/actions/runs/41059732780) terminó `success` sobre el SHA anterior: acredita compilación de simulador del branding, no Archive Release para dispositivo, firma, instalación o pruebas físicas.

## Estado técnico observado

| Área | Resultado local / límite |
| --- | --- |
| Identidad | `uy.com.raulsilva.perforaciones`, `Raul Silva Perforaciones`, familia `1,2`, mínimo iOS 15.0 |
| Release | Existe; no hereda `debug.xcconfig` ni `DEBUG`. `CODE_SIGN_STYLE=Automatic`, sin Team ID/perfil. A nivel proyecto permanece `CODE_SIGN_IDENTITY="iPhone Developer"`: debe sustituirse por firma Apple Distribution efectiva al preparar el archive. No es una configuración de distribución lista |
| Versiones | Debug/Release: `MARKETING_VERSION=1.0`, `CURRENT_PROJECT_VERSION=1`. Info.plist deriva sus dos claves de esos settings |
| Branding | Ícono 1024×1024 y splash 941×1672, RGB/sRGB sin alfa, hashes comprobados. Vista nativa física pendiente |
| Dependencias | Capacitor Core/CLI/iOS 8.5.0. Siete plugins SPM. No se actualiza npm ni Swift |
| Swift fijado | capacitor-swift-pm 8.5.0 (`4f71d0b979f2f957326f04353eca7604ee937e1e`); ion-ios-filesystem 1.1.4 (`56bd6f9e77cb4f2269c03f2d92a9fe58fe168a1c`); ion-ios-geolocation 2.1.1 (`db363927d3a954e3ea24d2e72b6e9814769a84be`); keychain-swift 21.0.0 (`265806607b45687a3d646e4c9837c31c90f202e8`) |
| Lock | SHA-256 `56a364979903d2990a2eaad3fb86781113e286e27d4c7d63a7945dc9722ae9df`; cualquier cambio bloquea el verificador |
| Transporte | HTTPS `https://api.raulsilvaperforaciones.com`, WSS equivalente, WKWebView `capacitor://localhost`, CSP restringida. No ATS global ni HTTP |
| Sesión | Bearer sólo hacia API permitida; SecureStorage/Keychain `whenUnlockedThisDeviceOnly`, `setSynchronize(false)`, sin grupos compartidos. Logout/revocación y tickets WebSocket conservados |
| Offline | Borradores/fotografías locales e idempotencia existentes. Reanudación en primer plano; no se promete sincronización durante suspensión de iOS |

**Hallazgo para el archive de dispositivo:** `UIRequiredDeviceCapabilities` conserva `armv7` del template oficial. Esto no selecciona la arquitectura del ejecutable, pero [Apple exige declarar arm64 para apps de 64 bits](https://developer.apple.com/documentation/bundleresources/information-property-list/uirequireddevicecapabilities). Antes del archive de distribución deberá ajustarse esa declaración y comprobarse arm64/elegibilidad efectiva de ambos dispositivos. No se considera listo ni se oculta este pendiente; 05A conserva el proyecto de simulador y documenta el cambio requerido para la preparación del archive. El verificador lo informa expresamente como bloqueo pendiente.

Permisos en español: cámara, selección de fotos y ubicación durante uso. La clave `NSLocationAlwaysAndWhenInUseUsageDescription` es exigida por la biblioteca del plugin, no habilita solicitudes permanentes ni background. No hay `UIBackgroundModes`. `saveToGallery:false` evita necesitar permiso de guardar en galería. No se agregan permisos.

El manifest incluye UserDefaults `CA92.1`, FileTimestamp `C617.1`, ausencia de tracking y dominios vacíos. Está incorporado en Resources. **No equivale a declarar que no se recogen datos**: cuenta, fotos, ubicación y registros deben revisarse con el propietario, incluyendo retención, finalidad, asociación con personas y destinatarios. La ausencia actual de `NSPrivacyCollectedDataTypes` requiere resolver esa revisión antes de distribución; no se inventa una respuesta. Ver [datos recogidos y manifest](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests), [requisitos de SDK](https://developer.apple.com/support/third-party-SDK-requirements/) y [privacidad de la ficha](https://developer.apple.com/app-store/app-privacy-details/). Xcode deberá generar el reporte agregado de todos los SDK del archive.

HTTPS/Keychain utilizan cifrado; no se marca automáticamente `ITSAppUsesNonExemptEncryption=false`. El propietario debe completar la evaluación de [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/), considerando también dependencias. La respuesta y cualquier documentación deben corresponder al producto real. No hay declaración de exención nueva en 05A.

## Verificador local de sólo lectura

Desde la raíz, usando Node/dependencias del lockfile ya instalado:

```powershell
node front/scripts/ios-distribution-readiness.mjs --approved-sha <SHA_COMPLETO_REVISADO>
```

No reemplazar el SHA revisado por uno arbitrario. El script comprueba rama y URLs fetch/push de origin, HEAD, proyecto nativo, Release/Info.plist, permisos, privacidad, lock/plugins, branding, Core/CLI/iOS, contrato HTTPS/WSS/CSP, workflow manual intacto y sintaxis de scripts. No compila, firma, hace fetch, conecta a Apple/API ni escribe archivos. El chequeo CSP es de configuración; los assets empaquetados deben volver a validarse sobre el archive real.

Escanea los archivos actualmente versionados, incluidos los staged al preparar el commit: extensiones de firma/secretos/artefactos, symlinks y patrones de payloads de claves/tokens. No lee `.env` privados ignorados, ni historial Git. No prueba matemáticamente ausencia de secretos o datos personales. Una única excepción documentada admite el token inválido de 43 letras `a` del test negativo existente `api/test/websocket-native-contract.test.ts`; no dispensa otros secretos ni otros archivos. Los archivos nuevos deben incluirse en staging y revisarse antes del escaneo final.

Salida JSON: `passed`, `failed`, `pending`, `appleMembershipBlocked`, `requiresMacOS`, `requiresPhysicalDevice`. Siempre `readyForTestFlight:false`. Código **1**: fallo local/argumentos; código **2**: controles locales aprobados pero distribución bloqueada. No devuelve 0 ni dispone de `force`, `skip` o desbloqueo de firma. El árbol sucio se informa como pendiente; no habilita un archive. No usar este diagnóstico como sustituto de una futura barrera de distribución que exija árbol limpio, reservas y evidencias Apple.

## Números de compilación

No cambiar ahora `1.0`/`1`. Para el primer candidato se propone una versión de distribución de tres componentes, por ejemplo **1.0.0**, sujeta a aprobación. [CFBundleShortVersionString](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring) identifica la versión; [CFBundleVersion](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion) identifica el build.

Política local conservadora: build entero canónico **1..9999**, globalmente creciente para este Bundle ID, aun entre versiones. Al agotarlo se detiene para revisar la política; no se reinicia ni trunca. No se deriva exclusivamente de `run_number`, fecha o SHA. Los reintentos reciben otra reserva; nunca se recicla un intento incierto.

Después de activar Apple: consultar builds existentes y un registro duradero de reservas (incluye fallidos/no subidos); bajo exclusión mutua reservar el siguiente número antes de construir, vinculando Bundle ID, versión, número, SHA, run/attempt y operador. El registro se mantiene fuera de artefactos efímeros y fuera de Git público; ubicación y control de escritura se aprobarán con el workflow futuro. Si se pierde o hay discrepancia, bloquear. `concurrency` de GitHub sólo serializa el flujo, no sustituye ese registro ni controla subidas manuales externas. Verificar nuevamente ASC antes de subir.

El script permite evaluar **un plan**, sin reservar ni aplicar settings:

```powershell
node front/scripts/ios-distribution-readiness.mjs --approved-sha <SHA_REVISADO> --version <VERSION_APROBADA> --build <NUMERO_RESERVADO> --last-allocated <ULTIMA_RESERVA_PREVIA_VERIFICADA>
```

Los tres valores son obligatorios juntos. El cero sólo corresponde a `last-allocated` cuando se haya confirmado que no hubo reservas/builds anteriores. `reservationVerified:false` permanece explícito: un valor introducido por el operador no demuestra unicidad remota.

El futuro archive aplicará `MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` como overrides controlados sin cambiar el código aprobado; no se permitirá que Xcode renumere automáticamente al exportar. Se compararán settings efectivos, Info.plist del archive, IPA exportada y registro procesado en Apple con la reserva y el SHA. La versión empresarial 027 y la numeración de perforaciones no guardan relación con estos números.

## Pasos del propietario tras la activación (NO ejecutados)

1. **Manual:** confirmar membresía activa, identidad y 2FA; aceptar acuerdos pendientes. El pago/enrollment pendiente no basta. En cuenta individual, el vendedor será la persona legal, no automáticamente la marca comercial. Revisar titularidad/autorización del nombre, logo y fotografías de marca. [Inscripción individual](https://developer.apple.com/programs/enroll/) y [roles de cuenta](https://developer.apple.com/help/account/access/roles).
2. **Manual:** obtener el Team ID real y registrar App ID explícito con Bundle ID `uy.com.raulsilva.perforaciones`. Activar sólo capacidades justificadas; no iCloud, grupos compartidos, push ni background por defecto. [Registrar App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/).
3. **Manual:** crear un único registro iOS universal en ASC, nombre, idioma, SKU privado elegido y Bundle ID correcto. El identificador numérico que devuelva Apple no es el Bundle ID ni el Team ID. No crear otra aplicación para iPad. [Crear aplicación y acuerdos](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/).
4. **Manual y autorización separada:** preparar Apple Distribution, su clave privada correspondiente y perfil App Store Connect con el App ID y certificado correctos. [Certificados](https://developer.apple.com/help/account/certificates/certificates-overview/), [CSR oficial](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/), [perfil ASC](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/). No confundir un `.cer` público con un `.p12` que contiene la clave privada. TestFlight no requiere registrar UDIDs como Ad Hoc.
5. **Decisión previa de custodia sin Mac local:** el CSR oficial usa Keychain Access en macOS. Elegir una sesión macOS confiable accesible al propietario o evaluar una herramienta local Windows para CSR/PKCS#12 y validar el par clave/certificado antes de su uso. No generar la única clave en un runner efímero sin un procedimiento aprobado de custodia cifrada y recuperación. No transferirla por chat, Git ni artefactos públicos. Esta selección sigue pendiente; no se instaló ninguna herramienta.
6. **Manual:** revisar privacidad, política pública apropiada, información de contacto, cifrado y derechos. No declarar que no se recogen datos sólo porque la app es empresarial. Preparar información beta y restricciones de consulta.
7. **Manual:** autorizar configuración de CI protegida, secrets y reserva de builds descritas abajo. El propietario ingresa personalmente secretos; no debe enviarlos por chat.
8. **Automatizable después de autorización:** checkout del SHA exacto, `npm ci`, contratos, build Angular nativo, `prepare:ios`, comprobaciones de identidad, lock y assets. Crear Archive **Release para `generic/platform=iOS`, SDK iphoneos y arm64**, no iphonesimulator. El workflow de simulador permanece separado e intacto. Seleccionar/revalidar Xcode 26.2 y requisitos de subida vigentes antes de iniciar; no sustituir versiones automáticamente.
9. **Automatizable con revisión:** validar firma/cadena, expiración, Team ID, application-identifier, perfil, `get-task-allow=false`, entitlements mínimos, privacidad agregada, arm64, familia, mínimo 15.0, recursos y versiones. Las banderas `CODE_SIGNING_ALLOWED=NO` del simulador **no** sirven para este archive firmado. La falta de firma nunca se transforma en un éxito de distribución.
10. **Autorización expresa separada:** exportar para App Store Connect con la modalidad soportada por el Xcode seleccionado (`app-store-connect`, confirmar en su ayuda), firma manual/perfil correspondiente y control de versión. Validar/subir por herramienta oficial compatible, registrar hash de IPA y resultado de procesamiento. [Distribución Xcode](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases) y [subida de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/). No ofrecer una IPA de simulador como instalable.
11. **Manual:** completar información TestFlight, cifrado y notas de prueba. Crear grupo interno con el propietario como usuario ASC habilitado, invitar/seleccionar ese build. TestFlight admite hasta 100 testers internos; externos hasta 10.000 requieren el circuito de revisión beta, incluida la primera build externa. No hace falta empezar con pruebas externas. [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) y [testers internos](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).
12. **Manual, futura autorización:** instalar TestFlight desde App Store en iPhone/iPad y aceptar la invitación. Confirmar versión/build mostrado y probar sólo consultas inicialmente. No se instaló nada en 05A.

## Diseño futuro de firma/CI (no se crea un workflow de subida)

- Workflow separado, exclusivamente `workflow_dispatch`, inputs de SHA exacto, versión y reserva. `contents:read`, checkout sin credenciales persistentes, actions fijadas por SHA, timeout, exclusión mutua sin cancelación de un intento activo. Ningún login empresarial ni pruebas de escritura; los secrets Apple nunca se suministran al workflow de simulador, a PRs o a forks.
- GitHub Environment protegido para firma y otro para publicación, con ramas autorizadas y revisión manual del SHA. En repositorio público, asumir que fuentes, logs y artefactos pueden ser accesibles a terceros. [Protecciones de environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments). Revisar el plan GitHub efectivo antes de configurarlas. Si se exige impedir autoaprobación, hace falta otro revisor de confianza; con un único propietario esa regla bloquearía sus ejecuciones. No simular doble control ni desactivar protecciones silenciosamente: decidirlo explícitamente.
- Importar `.p12` y perfil sólo después de aprobación, en `$RUNNER_TEMP` y llavero temporal con contraseña aleatoria por job; permisos mínimos, sin `set -x`, sin imprimir contenido, contraseñas ni JWT. La clave/certificado deben ser de Apple para esta cuenta, independientes de credenciales empresariales. El perfil y las identidades se validan antes de firmar. Limpiar llavero, perfiles y temporales en finalización/fallo; usar runner hospedado efímero. [Guía oficial GitHub](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications).
- No subir `.p12`, `.p8`, perfiles, llaveros o dumps de entorno como artefactos. Tampoco publicar automáticamente IPA/archive firmados en este repositorio público. Para revisión entre fases, elegir almacenamiento privado cifrado, con hash y acceso restringido; o una ejecución autorizada que reconstruya y revalide. Aún no se ha aprobado ese almacenamiento.
- La credencial de subida es diferente de la de firma. El Account Holder debe solicitar acceso API ASC cuando corresponda. Evaluar clave individual con alcance del usuario frente a clave de equipo: una clave de equipo no queda restringida a una sola app; una individual no usa endpoints de provisioning. No asignar Admin por comodidad. [API y roles](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/) y [tipos de claves](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api). Confirmar compatibilidad de la herramienta de subida y mínimos privilegios; usar JWT corto, sin Apple ID/password/MFA almacenados en CI. Issuer ID depende del tipo de clave: no inventarlo ni confundirlo con Team ID.
- No se produce aquí ExportOptions con IDs ficticios ni un workflow utilizable de upload. El futuro flujo debe verificar firma y políticas efectivas sobre artefactos, no sólo el PBX. `verifyProject` actual rechaza Team ID/perfiles porque protege simulador: mantenerlo y crear contratos de distribución separados en la siguiente etapa.

Información no secreta que el propietario podrá confirmar después: membresía activa, acuerdos, Team ID, Bundle ID registrado, ID numérico ASC, versión propuesta, responsable/revisores, grupo interno y decisión de custodia. Key ID/Issuer ID sólo si se aprueba ese tipo de acceso. Claves privadas, contraseñas, perfiles completos, JWT y certificados con clave nunca por chat.

## Protocolo físico futuro

Registrar dispositivo/modelo, iOS, orientación, SHA/build, resultado y error técnico sin datos personales. No interpretar compilación o Safari como prueba nativa.

| Etapa | Lista verificable | Autorización |
| --- | --- | --- |
| Consulta inicial | [ ] ícono/splash [ ] apertura [ ] login propietario [ ] consultas existentes [ ] perfil constructivo [ ] PDF existente [ ] navegación de formularios sin guardar [ ] teclado/rotación iPad [ ] cerrar/reabrir [ ] logout/revocación | Consulta productiva; sesiones/tickets técnicos pueden crearse. No guardar formularios, fotos ni borradores |
| Capacidades físicas | [ ] cámara/galería y orientación [ ] permiso denegado/aceptado [ ] ubicación real según modelo (iPad sin GPS puede usar ubicación de red) [ ] compartir PDF | Autorización posterior; evitar subir fotos/ubicaciones o guardar cambios empresariales |
| Offline completo | [ ] borrador [ ] foto pendiente [ ] cierre/reapertura [ ] suspensión [ ] reconexión [ ] sincronización [ ] interrupción/reintento [ ] ausencia de duplicados [ ] recibo/UUID conservados | Bloqueado hasta autorizar escrituras y su efecto en números/auditorías o contar con backend aislado |

No borrar datos locales para reparar fallos. No utilizar P-3277 ni crear perforaciones ficticias en producción. Edición offline general de pozos existentes y generación completa de PDF offline siguen fuera del alcance comprobado. No prometer ejecución en background.

## Verificación de esta etapa

Los tests nuevos cubren identidad y SHA, lock alterado, versiones/builds inválidos o reutilizados, Release contradictorio, permisos peligrosos, secretos/artefactos, argumentos y salida bloqueante sin mutar Git. Se ejecutan con `node --test front/scripts/native-ios-distribution.test.mjs`; también están incluidos por el glob existente de `npm run test:native-config`. No cambia el workflow de simulador ni su comando de tests.

Resultados locales: **173 contratos nativos existentes + 60 nuevos de distribución + 140 Angular = 373 casos únicos aprobados**. La primera ejecución conjunta pasó 230/230 (173 + 57); después se añadieron tres negativos de tipo y se repitió solamente la suite afectada, 60/60. Los 83 casos iOS previos están incluidos en los 173, no se suman otra vez. Angular pasó 140/140 con ChromeHeadless, cubriendo autenticación, almacenamiento seguro simulado, offline, interceptor y WebSocket. Los probes Gradle existentes usan modelos sintéticos; no se generó otra APK.

Comandos ejecutados: `npm.cmd run test:native-config`; `node --test scripts/native-ios-distribution.test.mjs`; `npm.cmd test -- --watch=false --browsers=ChromeHeadless --include='src/app/core/native/*.spec.ts' --include='src/app/core/interceptors/native-token-interceptor.spec.ts' --include='src/app/shared/services/auth-service/*.spec.ts' --include='src/app/shared/services/websocket.native.spec.ts'` (desde `front`). Sintaxis Node, integridad de recursos y `git diff --check` correctos. El diagnóstico CLI pasó sus controles locales y terminó con código 2 por los bloqueos de distribución esperados; no se ocultó un error para obtener 0.

La aprobación de tests permite versionar estas herramientas, no firmar ni distribuir. No hubo conexión autenticada a Apple, Actions, Xcode, push, cambios de producción ni Android.

Pendientes independientes: Android físico por cable USB; offline real iPhone/iPad; activación, firma y TestFlight; **perfil constructivo en blanco y negro según la fotografía del propietario**, preservando geometría y espesores 0.13. Ninguno se implementa aquí.
