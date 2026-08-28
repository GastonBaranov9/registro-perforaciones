# RSP-09C-R5 — cierre de hallazgos del review

## Sesiones native y cambio de cuenta

Antes de crear una nueva sesión, `AuthService` serializa el login native y, si existe un token native bajo control del cliente, persiste el marcador de revocación y ejecuta `POST /api/auth/native/logout` con ese token. Sólo después de recibir 204 limpia A y envía el login de B. Un fallo de red, metadata o almacenamiento no sobrescribe A; conserva la sesión anterior (o `logout-pending` si ya estaba pendiente) para reintentarla. Los dobles submits comparten el mismo vuelo de login.

La semántica no depende de que B pertenezca al mismo usuario: A se revoca explícitamente antes de cualquier login. Tras 204, la revocación remota es autoritativa y la limpieza local es segura/best-effort; B sólo se considera autenticado una vez persistido en secure storage y limpiado el pending.

## 426 en respuestas Blob

El interceptor procesa 426 únicamente después de comprobar el origin y path exactos del backend native autorizado. Para JSON/texto exige `NATIVE_APP_UPGRADE_REQUIRED`; para respuestas Blob (como imágenes y PDF) aplica el contrato de 426 del API propio y ejecuta `handleNative426()` sin borrar el token. Nunca se inspeccionan ni se modifican respuestas de origins externos, y el Bearer no aparece en URLs.

## Perfil native reducido

La sesión web conserva el DTO completo y sus filas de email, activo y fecha de registro. La vista de usuario ahora muestra esas filas sólo cuando las propiedades existen; el DTO native reducido presenta nombre y roles sin valores `undefined`, `null` ni PII inventada.

## Validación

Se conservaron logout-pending, auth generation, stale session, Preferences probe, secure storage, recursos protegidos Blob/object URL, fallback del mapa, limpieza legacy, runtime unknown fail-closed y autenticación web cookie/CSRF. No se modificó `api/` ni Android en R5. Se ejecutan la suite Angular, contratos de configuración native/web, builds web/native-development, `cap sync android`, diff/UTF-8 y el escaneo de seguridad al cierre.
