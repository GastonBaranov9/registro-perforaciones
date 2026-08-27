# Progreso ETAPA RSP-09B-R2 — error uniforme de metadata native

## Hallazgo

`POST /auth/native/login` declaraba un schema Fastify estricto para `X-Native-Platform`, `X-Native-App-Build` y `X-Native-App-Version`. Fastify ejecuta la validación de schema antes del handler, por lo que metadata ausente o malformada podía producir `FST_ERR_VALIDATION` sin alcanzar `leerMetadataNative` ni `T05MetadataNativeInvalida`.

El endpoint tenía dos autoridades semánticas con reglas duplicadas y un contrato observable distinto según qué capa rechazara primero.

## Solución

`leerMetadataNative` queda como única fuente de verdad para presencia, tipo, formato, plataforma, rango de build y app version. El schema de headers conserva los nombres y descripciones para Swagger, pero sus propiedades son opcionales/no semánticas y no interceptan valores antes de la capa native.

Login ejecuta sus hooks en este orden:

1. rate limiter específico de login;
2. validación/normalización de metadata mediante `leerMetadataNative`;
3. parsing y validación del body por Fastify;
4. comparación del build mínimo;
5. autenticación y bcrypt.

La metadata normalizada se guarda por request en un `WeakMap`, evitando propagar headers crudos o duplicar reglas en el handler. Metadata inválida se rechaza antes de consultar cuentas, por lo que el resultado no depende de email/password y no introduce enumeración.

## Contratos de error

Todos estos casos responden `400` con `code=ERR_NATIVE_METADATA_T05`:

- platform ausente, vacía, duplicada o distinta de `android|ios`;
- build ausente, vacío, alfabético, decimal, negativo, cero, con cero inicial o superior a `2147483647`;
- app version presente pero vacía o superior a 80 caracteres.

`X-Native-App-Version` sigue siendo opcional. Su ausencia permite continuar el login.

Un build entero válido para una plataforma soportada, pero inferior al mínimo, continúa respondiendo `426` con `NATIVE_APP_UPGRADE_REQUIRED`. Una plataforma inválida nunca se convierte en upgrade required.

## Endpoints auditados

- login: nuevo hook temprano y metadata normalizada compartida con el handler;
- session: `authenticateNative` valida metadata en `onRequest`;
- logout-all: `authenticateNativeAllowObsolete` valida metadata pero conserva la excepción de minimum build;
- ws-ticket: `authenticateNative` valida metadata antes del rate limiter de ticket;
- endpoints de negocio con Bearer: el resolver native común produce el mismo error tipado;
- logout-device: permanece sin requisito de platform/build y sigue disponible para clientes obsoletos.

Todos los schemas de headers native usan ahora únicamente descripción no semántica, evitando una segunda validación divergente. OPTIONS/preflight continúa atendido por CORS y conserva los cinco headers aprobados; no se autentica ni se valida como request de negocio.

## Regresiones y seguridad

No se modificó el error handler global. Un error de schema no relacionado continúa respondiendo `FST_ERR_VALIDATION`. Tampoco cambiaron redacción/logging: no se registran headers completos, Authorization, cookies ni password, y los mensajes de metadata son constantes.

El rate limiter global continúa como hook global y el limiter de login corre antes de metadata, por lo que requests inválidas siguen consumiendo presupuesto sin alcanzar bcrypt.

## Pruebas

`native-auth-login-metadata.test.ts` cubre cada ausencia/formato inválido, arrays de header, límite de app version, no-enumeración, código exacto, separación de `426`, orden del rate limiter y regresión global `FST_ERR_VALIDATION`.

La integración PostgreSQL comprueba además:

- login real permitido;
- app version ausente permitida;
- metadata inválida tipada en login, session, logout-all, ws-ticket y negocio compartido;
- minimum build conserva `426`;
- logout-device continúa funcionando sin metadata;
- concurrencia y locking RSP-09B-R1 permanecen correctos.

Resultados finales: build TypeScript correcto, suite API `281/281`, harness PostgreSQL/migraciones correcto.

## Alcance preservado

No se modificaron migraciones `000..008`, frontend, formato de tokens/tickets, HMAC, resolver Bearer, precedencia cookie/Bearer, CSRF, CORS/Origin, política de sesiones, locking R1, logout, logout-all, emisión WS-ticket, janitor, retención, readiness ni WebSocket runtime.
