# CODEX — PROGRESS ETAPA RSP-09C-R3

## Alcance

R3 cierra los dos hallazgos P1 del review, sin cambios en `api/`, migraciones ni WebSocket native.

## Toolchain Android

La auditoría de los módulos instalados confirmó que Capacitor Android/core/CLI 8.5.0 y los plugins Android cargan Android Gradle Plugin 8.13.0, con compile/target SDK 36 y minSdk 24. El proyecto checked-in fue alineado a Gradle 8.13, AGP 8.13.0, compileSdkVersion 36, targetSdkVersion 36 y minSdkVersion 24. `app/build.gradle` sigue consumiendo las variables canónicas y `cap sync android` no revierte el cambio.

La ejecución Gradle física continúa bloqueada en esta estación por ausencia de JDK, `JAVA_HOME` y Android SDK. No se generó APK/AAB.

## Respuestas stale de native/session

`restoreNativeSessionInternal()` captura un snapshot consistente `{token,generation}` antes del GET. Después de cualquier resultado (200, 401, 426, red, 5xx o shape inválido), compara la generación; si cambió, descarta completamente el resultado. Los 401 actuales pasan la generación a la invalidación single-flight. El inicio de logout avanza la generación inmediatamente, por lo que una revalidación A tampoco puede restaurar la sesión durante `logout-pending`.

Así, A→login B descarta respuestas tardías de A y conserva token/usuario B; A→logout descarta cualquier resultado viejo y no navega ni cambia el estado local. La ruta web no cambia.

## Pruebas y validación

Se agregaron pruebas de 200/401/network stale tras replacement login y de respuesta stale tras logout, ademÃ¡s del contrato Android Gradle/AGP/SDK. AuthService R3 pasó 27/27; la suite Angular completa pasó 263/263; contratos de configuración 9/9 y native-config 4/4; API 281/281. Web normal, production y native-development compilan. `cap sync android` pasó. Gradle real queda pendiente de RSP-09E por el bloqueo de tooling.
