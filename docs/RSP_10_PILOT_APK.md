# Primer APK Android de piloto interno

Este procedimiento distribuye un APK firmado directamente a celulares de la empresa. No requiere Play Console ni AAB. Ejecutarlo desde `feature/rsp-10-pilot-apk` y conservar el mismo `applicationId` y certificado en todas las actualizaciones.

## Decisiones antes del build

1. Elegir el `applicationId` definitivo, en formato Android (por ejemplo, segmentos DNS propios; **no usar el ejemplo como valor real**). Cambiarlo en `front/capacitor.config.ts` (`appId`), `front/android/app/build.gradle` (`namespace` y `applicationId`), el package y la ruta de `front/android/app/src/main/java/com/example/app/MainActivity.java`, y `package_name` en `front/android/app/src/main/res/values/strings.xml`. Revisar `custom_url_scheme` del mismo archivo: actualmente coincide con el identificador. El readiness gate comprueba la coherencia efectiva.
2. Elegir el nombre visible. Cambiar `appName` en Capacitor y `app_name` y `title_activity_main` en `strings.xml`.
3. Confirmar el origin HTTPS productivo exacto para `NATIVE_BACKEND_ORIGIN`: esquema, host y puerto opcional, sin barra final ni rutas. El build rechaza hosts locales, IP y dominios de desarrollo, staging, test o ejemplo. El cliente deriva `/api/` y `wss://<host>/ws`.
4. `versionCode=1` y `versionName=1.0` son válidos para el primer piloto. Para cada APK posterior, aumentar `versionCode` y mantener el mismo `applicationId` y clave; usar un `versionName` legible.
5. Los iconos `front/android/app/src/main/res/mipmap-*` y splash `front/android/app/src/main/res/drawable*` muestran todavía el símbolo azul de plantilla de Capacitor. Son `MANUAL_CHECK` y `HUMAN_DECISION`: reemplazarlos cuando exista branding aprobado, sin bloquear una prueba funcional si la app se identifica claramente por su nombre.

## Keystore empresarial

Crear el keystore **fuera del repositorio**, en una ubicación empresarial con acceso restringido y backup seguro. Guardar también alias, contraseñas y huella del certificado en el gestor de secretos de la empresa. Si se pierde la clave, los celulares con el APK anterior no podrán actualizarse conservando datos mediante `adb install -r`.

En PowerShell, elegir localmente ruta y alias. `keytool` pide la contraseña de forma interactiva; no escribirla en comandos, archivos del proyecto, ChatGPT ni Codex:

```powershell
$PilotKeystore = '<ruta absoluta fuera del repositorio>\raul-silva-pilot.jks'
$PilotAlias = '<alias elegido por la empresa>'
keytool -genkeypair -v -keystore $PilotKeystore -storetype PKCS12 -alias $PilotAlias -keyalg RSA -keysize 3072 -validity 3650
keytool -list -v -keystore $PilotKeystore -alias $PilotAlias
```

El build usa exclusivamente estas variables del proceso: `ANDROID_STORE_FILE`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. El path debe ser absoluto. Inyectar las contraseñas desde el gestor de secretos local o introducirlas sin eco en una terminal privada. Este ejemplo no imprime los valores ni los deja en el historial:

```powershell
$env:ANDROID_STORE_FILE = $PilotKeystore
$env:ANDROID_KEY_ALIAS = $PilotAlias
$SecureStore = Read-Host 'Contraseña del keystore' -AsSecureString
$SecureKey = Read-Host 'Contraseña de la clave' -AsSecureString
$StorePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureStore)
$KeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
    $env:ANDROID_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($StorePtr)
    $env:ANDROID_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($KeyPtr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($StorePtr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($KeyPtr)
}
cd front
npm.cmd run check:android-signing-env
```

El check informa sólo qué **nombres** faltan; no valida contraseñas ni certificado. No ejecutar Gradle en una terminal compartida que registre variables de entorno. Al terminar, cerrar la terminal o retirar `ANDROID_STORE_FILE`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD` del entorno del proceso.

## Build, verificación e instalación

Con identidad y nombre definitivos, origin confirmado y variables de firma presentes:

```powershell
$env:NATIVE_BACKEND_ORIGIN = 'https://<dominio-productivo-real>'
cd front
npm.cmd run check:native-release-readiness
npm.cmd run test:native-config
npm.cmd run test:config
npm.cmd run test:production-build
npm.cmd run check:utf8
npm.cmd test -- --watch=false
npm.cmd run build
npm.cmd run build:native:production
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
.\gradlew.bat assembleRelease
```

El APK esperado es `front/android/app/build/outputs/apk/release/app-release.apk`. Verificarlo antes de distribuirlo:

```powershell
apksigner verify --verbose --print-certs .\app\build\outputs\apk\release\app-release.apk
```

Comprobar que la verificación termina con código 0, que v2/v3 son válidos y que la huella pública coincide con la registrada para el keystore empresarial. `apksigner` está en `Android SDK/build-tools/<versión>/` si no está en `PATH`. Registrar el SHA-256 del APK distribuido y su `versionCode`. No commitear APK ni keystore.

## Backend y celular

Antes del primer login, verificar DNS público (`Resolve-DnsName <dominio>`), certificado TLS confiable para ese host (`curl.exe -I https://<dominio>/`), HTTPS desde Wi-Fi y datos móviles, `/api/` a través de Nginx, y WSS `/ws` con ticket native. Nginx elimina `/api` hacia Fastify y proxya `/ws`; Fastify debe seguir accesible sólo por la red interna de servicios. Confirmar CORS/origin native con la app real, login native, acceso a API y reconexión WebSocket. No probar login con credenciales productivas en herramientas que registren comandos.

En el celular: habilitar **Opciones de desarrollador**, habilitar **Depuración USB**, conectar el cable, aceptar la huella RSA y ejecutar `adb devices -l`. Debe figurar `device`, no `unauthorized`. Instalar sin borrar datos ni desinstalar:

```powershell
adb install -r .\app\build\outputs\apk\release\app-release.apk
adb shell monkey -p <applicationId-definitivo> 1
```

Si falla la apertura, obtener el PID con `adb shell pidof <applicationId-definitivo>` y revisar `adb logcat --pid=<PID>` mientras se reproduce el problema. Registrar modelo, Android, versión y resultado; no copiar tokens ni datos personales a logs compartidos.

## Prueba física mínima

- [ ] Instalación inicial y apertura; login con usuario piloto.
- [ ] Cerrar y reabrir; `force-stop` de **esta app** y reabrir; reiniciar el celular; sesión persistente.
- [ ] Logout y nuevo login.
- [ ] GPS permitido; GPS denegado y luego permitido.
- [ ] Cámara o selector; adjuntar y subir una foto; verificarla desde la app.
- [ ] Crear y editar una perforación real de prueba; confirmar los datos en otro cliente.
- [ ] Wi-Fi a datos móviles y vuelta; pérdida momentánea de red; reconexión WebSocket.
- [ ] Bloquear y desbloquear pantalla durante una sesión.
- [ ] Aumentar `versionCode`, firmar otro APK con la **misma clave** e instalar con `adb install -r`; confirmar que datos y credenciales legítimas persisten.

## RSP-09F: siguiente incremento

La creación actual envía `/api/usuarios/:id_usuario/pozos/completo` con foto codificada en JSON. El formulario y la foto seleccionada viven en memoria. Una respuesta perdida puede dejar una creación exitosa sin confirmación en el cliente y un retry manual puede duplicarla.

Secuencia mínima: (1) UUID de idempotencia estable por intento y persistido antes del envío; (2) clave única por usuario y UUID con reserva/resultado en la misma transacción de PostgreSQL, incluyendo conflicto si cambia el payload; (3) borrador local durable aislado por usuario; (4) foto durable asociada al borrador; (5) estados `borrador`, `pendiente`, `sincronizando`, `sincronizado`, `error`; (6) retry con el mismo UUID; (7) catálogos mínimos cacheados; (8) revalidación de sesión antes de sincronizar. Hasta completar ese flujo, no prometer funcionamiento offline ni reintentar automáticamente una creación ambigua.
