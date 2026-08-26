# ETAPA RSP-09A-R1 — Generalizar Auth Mobile Android+iOS

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial: `ad4b86acfc90d075733f13ee766be128fad1bc93`

## 1. Resultado

RSP-09A nació para Android, pero su contrato final se generalizó a **Mobile/Native**, con un cliente Capacitor compartido y un backend común para Android e iOS. No se rediseñó ni debilitó web: cookie `rsp_session` HttpOnly, CSRF double-submit, Origin web y topología same-origin permanecen congelados.

No se implementó runtime, ruta, tabla, migración, plugin, plataforma iOS ni build mobile. Se conservaron token opaco frente a JWT, sesión única frente a access+refresh, 256 bits, TTL absoluto recomendado de 30 días configurable, HMAC/token hash server-side, `version_sesion`, logout por dispositivo/global y ticket WS single-use de unos 30 segundos configurable.

## 2. Estado de plataformas

### Android actual

- `front/android/` existe y `@capacitor/android` 8.0.0 está instalado.
- Capacitor core/CLI son 8.0.0; min SDK 23, target/compile SDK 35, Java 21, AGP 8.7.2 y Gradle 8.11.1.
- `capacitor.config.ts` conserva assets locales, sin `server.url`, hostname ni scheme explícitos.
- origin efectivo esperado: `https://localhost`.
- manifest propio sólo declara Internet y mantiene `allowBackup=true` sin reglas de exclusión.
- `appId=com.example.app` sigue siendo placeholder y bloquea conceptualmente un piloto productivo.

### iOS actual

- no existe `front/ios/`;
- `@capacitor/ios` no está en manifest, lock ni módulos instalados;
- no existe proyecto/workspace/scheme Xcode, firma, provisioning ni build iOS;
- no se ejecutó `cap add ios` ni se intentó generar el target desde Windows.

Con los defaults actuales de Capacitor 8 (`hostname=localhost`, `iosScheme=capacitor`), el origin iOS esperado es `capacitor://localhost`. La allowlist native futura será mínima y exacta por target: `https://localhost` para Android y `capacitor://localhost` para iOS. R1 no cambia allowlists productivas.

La documentación v8 vigente indica iOS 15+, Node.js 22+, macOS, Xcode 26.0+ y Xcode Command Line Tools. Desde Windows puede avanzarse en Angular/TypeScript compartido, transport, contratos API/WS, fixtures, lógica offline y tests no nativos. Generar, firmar y probar un build iOS exige una etapa posterior con macOS/Xcode, simulador y iPhone real.

## 3. Backend auth común

Se adopta un solo namespace externo:

- `POST /api/auth/native/login`;
- `GET /api/auth/native/session`;
- `POST /api/auth/native/logout`;
- `POST /api/auth/native/logout-all`;
- `POST /api/auth/native/ws-ticket`.

No existirán `/api/auth/android/*` y `/api/auth/ios/*`. Son multiplataforma la sesión opaca, Bearer, token hash/HMAC, `version_sesion`, `expires_at`, `revoked_at`, `installation_id`, logout de dispositivo/global, rate limit, autorización, branching CORS/Origin/CSRF, WS tickets y logging/redaction. Los handlers de negocio y guards de rol/ownership siguen siendo los mismos después de normalizar la identidad.

Web conserva cookie + CSRF. Native usa Bearer explícito y `credentials: omit`; un `Authorization` inválido no cae a cookie y la combinación de ambas credenciales se rechaza. CORS protege al WebView pero no autentica clientes nativos; Origin es defensa adicional y no factor de sesión.

## 4. Secure storage y pertenencia a instalación

`@aparajita/capacitor-secure-storage` 8.0.0 sigue como candidato para RSP-09C: licencia MIT, soporte declarado de Capacitor 8, Android e iOS, AES-GCM con clave Android Keystore y Keychain del sistema en iOS. No fue instalado.

Riesgos que RSP-09C debe cerrar:

- Android: excluir ciphertext y `installation_id` de Auto Backup/device-to-device o justificar `allowBackup=false`; probar corrupción/restores y uninstall;
- iOS: desactivar `synchronizable`/iCloud para el token y seleccionar/probar una accessibility `ThisDeviceOnly`, inicialmente `whenUnlockedThisDeviceOnly`; el default `whenUnlocked` puede migrar con backup;
- iOS Keychain puede sobrevivir al uninstall: un token residual sin el installation ID local correspondiente debe eliminarse y exigir login;
- revisar source, dependencias, issues/releases y mantenimiento concentrado antes de fijar el plugin; alternativas siguen siendo Capawesome comercial, otro plugin Capacitor 8 o implementación nativa mínima propia.

El `installation_id` es un UUID v4 aleatorio generado por la app, igual en Android/iOS, no secreto y no autenticación. No usa IMEI, Android ID, serial, MAC, IDFA ni tracking. Persiste en upgrade in-place, se regenera tras clear data/uninstall/reinstall y no migra a otro dispositivo. Copiarlo no concede acceso sin Bearer/password.

## 5. Lifecycle y threat model

La sesión persistente vive en Keystore/Keychain; el raw se carga en memoria sólo para operaciones autenticadas y no se conserva en estado serializable, storage web, DOM, URL, logs o clipboard.

- Android: cubrir background, process kill y reboot.
- iOS: cubrir background/suspensión, process termination y device restart.
- Resume/cold start reconstruyen estado desde secure storage y validan con servidor cuando vuelve la red.
- No se implementan refresh ni background services.

El threat model incluye root/jailbreak, app maliciosa, exposición Keychain/Keystore, backup/device migration, dispositivo robado, logs/crash reports, screenshots/clipboard y XSS. No se promete protección absoluta si OS, proceso o teléfono desbloqueado están comprometidos.

Biometría queda fuera del MVP. Más adelante puede proteger localmente la lectura mediante Android biometric/device credential o iOS Face ID/Touch ID/passcode; no cambia ni condiciona la autenticación del servidor.

## 6. Distribución piloto y GPS futuro

Android piloto usará un APK privado firmado, instalación manual y actualizaciones firmadas con la misma clave/application ID. Play Store no es obligatoria inicialmente.

iOS requiere una estrategia Apple autorizada. RSP-09E deberá evaluar Ad Hoc y TestFlight según testers/dispositivos reales; no exige publicación pública, pero sí macOS/Xcode, firma y provisioning aplicables. Costos, membresías, límites y reglas se revisarán en fuentes vigentes al distribuir; R1 no los congela ni elige definitivamente.

RSP-09E probará GPS en hardware real Android+iPhone, en la misma ubicación física: latitud, longitud, `accuracy` en metros, varias muestras, permisos precisos y mala conectividad. No se atribuye mayor precisión a una plataforma sin prueba de campo.

## 7. WebSocket existente

Se preserva el hallazgo: una conexión WS web ya abierta no se revalida proactivamente tras logout o cambio de `version_sesion`. RSP-09D deberá cerrar/revalidar esa ventana además de implementar tickets native single-use. R1 no corrige runtime.

## 8. Roadmap actualizado

1. RSP-09B — backend auth native común + DB + tests.
2. RSP-09C — cliente Capacitor compartido + secure storage Android/iOS + transport.
3. RSP-09D — WebSocket native + lifecycle + revocación, incluida ventana WS web.
4. RSP-09E — build piloto Android + preparación iOS/macOS + pruebas reales GPS.
5. RSP-09F — resiliencia/offline, idempotencia y conflictos.

## 9. Archivos y límites

R1 actualiza:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R1.md`.

No modifica `api/src`, `front/src`, `front/android`, manifests/locks de paquetes, migraciones, proxy, Compose ni scripts. No instala dependencias y no crea APK, AAB, IPA, archive o proyecto iOS.

## 10. Validaciones ejecutadas

La etapa es exclusivamente Markdown. Resultado:

- `git diff --check`: correcto;
- alcance contra HEAD inicial: sólo los tres documentos RSP-09A/R1;
- secret scan por firmas de private keys, tokens y credenciales comunes: sin coincidencias;
- `api/src` y `front/src`: sin cambios;
- manifests/locks de paquetes: sin cambios, ninguna dependencia instalada;
- `api/db/migrations`: sin cambios, ninguna migración creada;
- `front/ios`: ausente y sin proyecto generado;
- artefactos APK/AAB/IPA/xcarchive/build native nuevos: ninguno.

No se repiten suites API/frontend pesadas porque no cambia ningún archivo ejecutable.

## 11. Fuentes vigentes revisadas

- Capacitor v8 config/iOS/environment: https://capacitorjs.com/docs/config, https://capacitorjs.com/docs/ios y https://capacitorjs.com/docs/getting-started/environment-setup
- secure storage candidato: https://github.com/aparajita/capacitor-secure-storage y release 8.0.0 del 2026-02-10
- Apple Keychain accessibility: https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
- Apple beta distribution: https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases
- Android backup: https://developer.android.com/privacy-and-security/risks/backup-best-practices

Reglas, costos y requisitos de herramientas/distribución se deben volver a verificar al ejecutar RSP-09C/RSP-09E.
