# CODEX — PROGRESS ETAPA RSP-09C-R2

## Alcance

R2 cierra los cuatro hallazgos del review sobre el cliente mobile. No se modificÃ³ `api/`, migraciones, WebSocket native ni la autenticaciÃ³n web.

## Android minSdk

La auditorÃ­a del runtime instalado confirma que Capacitor Android 8.5.0, App 8.0.0, Preferences 8.0.0 y `@aparajita/capacitor-secure-storage` 8.0.0 declaran `minSdkVersion` 24. `front/android/variables.gradle` ahora usa 24 y el app module lo consume como `rootProject.ext.minSdkVersion`; no se usÃ³ override ni downgrade. Un contrato de producciÃ³n verifica el floor y las versiones.

La sincronizaciÃ³n Capacitor conserva la configuraciÃ³n. La validaciÃ³n Gradle queda pendiente para RSP-09E porque esta mÃ¡quina no tiene JDK/`JAVA_HOME` ni Android SDK operativo.

## 401 stale y snapshot de sesiÃ³n

`AuthService` mantiene una generaciÃ³n monotÃ³nica en memoria. El interceptor captura atÃ³micamente `{token,generation}` justo antes de enviar la request. Un 401 sÃ³lo llama la invalidaciÃ³n global si la generaciÃ³n coincide; por ello Aâ†’B y una respuesta tardÃ­a de A no borra B, secure storage ni el usuario actual. La generaciÃ³n actual conserva invalidaciÃ³n single-flight y la web mantiene su contrato previo. La generaciÃ³n nunca se persiste ni se registra.

## Logout 204 y markers huÃ©rfanos

Un 204 de `POST /api/auth/native/logout` confirma la revocaciÃ³n remota. Desde ese punto `finishLocalLogout()` limpia memoria/secure storage y deja `unauthenticated`; borrar el marker es best-effort y su fallo no lanza ni restaura sesiÃ³n. En bootstrap, `pending + token` sigue reintentando logout antes de session; `pending + token=null` es un marker huÃ©rfano, se limpia best-effort, no llama `/native/session` y permanece `unauthenticated` aunque Preferences continÃºe fallando.

## Preferences probe pre-login

Antes de crear una sesiÃ³n native se ejecuta `native_storage_probe_v1`: SET, GET con igualdad estricta y REMOVE. Un fallo en cualquiera de los pasos (incluido el borrado final) bloquea el POST de login, no toca installation ID/token/pending real y no deja la clave tÃ©cnica. Web y runtime unknown no ejecutan el probe.

## Pruebas

Se agregaron contratos/tests para minSdk, snapshot stale-401, 204 con fallo de cleanup, marker huÃ©rfano y fallos SET/GET/REMOVE/mismatch del probe. Se preservan los tests R1 de recursos protegidos Blob/object URL, origin externo, runtime unknown, web, multipart y PDF.

## ValidaciÃ³n y pendientes

Se ejecutaron builds web y native-development, contratos de configuraciÃ³n y sync Android. La suite Angular focalizada de AuthService pasÃ³ 23/23 y la suite completa pasÃ³ 259/259. La prueba Gradle fÃ­sica, Xcode/iOS y hardware Keystore/Keychain permanecen pendientes de RSP-09E.
