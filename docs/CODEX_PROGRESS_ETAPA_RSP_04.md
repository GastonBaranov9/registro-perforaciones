# Progreso ETAPA-RSP-04 - Cookies HttpOnly y CSRF

## Precondiciones verificadas

- Rama de trabajo: `feature/cookies-http-only`.
- Punto de partida limpio: `d929bac`, merge de ETAPA-RSP-03 en `main`.
- `468efe8` es ancestro de `HEAD`.
- `version_sesion` existe en `api/src`, `api/db/scripts.sql` y `api/db/migrations/001_add_version_sesion.sql`.
- Antes de modificar pasaron el build API, 7/7 tests backend de referencia, 82/82 tests frontend y el build frontend.

## Arquitectura implementada

- El JWT conserva `sub`, roles y `version_sesion`, pero se entrega exclusivamente en la cookie `rsp_session`.
- La cookie de sesion usa `HttpOnly`, `SameSite=Lax`, `Path=/`, vigencia de 10 horas y `Secure` en produccion.
- `jwtVerify({ onlyCookie: true })` rechaza autenticacion mediante `Authorization: Bearer`; no existe fallback al mecanismo anterior.
- El login ya no devuelve el JWT. Responde solamente `{ authenticated: true }` y emite un token CSRF aleatorio de 256 bits en `rsp_csrf`, legible por el frontend.
- Las mutaciones autenticadas requieren el patron double-submit: la cookie `rsp_csrf` y `X-CSRF-Token` deben existir y coincidir mediante comparacion de tiempo constante.
- `POST /login` queda exento porque aun no existe una sesion; los metodos seguros y `OPTIONS` no requieren CSRF.
- `POST /logout` exige sesion valida y CSRF, elimina ambas cookies y responde 204.
- CORS permite credenciales y declara `X-CSRF-Token` entre las cabeceras aceptadas, manteniendo la lista explicita de origenes.
- Swagger documenta la autenticacion como cookie.

## Frontend

- Se elimino el JWT del store, de respuestas de login y de `localStorage`.
- Al iniciar la aplicacion se consulta `GET /login`; el estado autenticado deriva de la cookie y del usuario devuelto por la API.
- El interceptor limita `withCredentials` a URLs de la API y agrega `X-CSRF-Token` solo para metodos mutables.
- No se agrega cabecera `Authorization`.
- El logout llama a la API antes de limpiar el estado en memoria y navegar al login.
- Se eliminan claves legacy `token` y `user` de `localStorage` para no conservar credenciales o estado obsoleto de versiones anteriores.

## Pruebas y resultados finales

- Tests backend nativos: 13/13 correctos.
  - Atributos y separacion de cookies.
  - Activacion de `Secure` por entorno.
  - Validacion CSRF, incluidos ausentes, vacios y distintos.
  - Integracion Fastify: Bearer rechazado, cookie aceptada, mutaciones protegidas y login exento.
  - Se mantienen todas las pruebas de `version_sesion` y revocacion.
- Suite frontend completa: 84/84 correcta.
  - Credenciales incluidas hacia la API.
  - Ausencia de Bearer.
  - Cabecera CSRF en mutaciones.
- Build API: correcto.
- Build frontend: correcto.
- `git diff --check`: correcto.
- Auditoria estatica: no hay lectura/escritura del JWT en `localStorage`, respuesta con token ni construccion de Bearer en codigo de aplicacion.

Persisten advertencias no bloqueantes conocidas de Ionic/Stencil, iconos y `baseline-browser-mapping`. La instalacion de dependencias informa vulnerabilidades del arbol npm existente; no se ejecuto una actualizacion masiva fuera del alcance de esta etapa.

## Dependencia

- Se agrego `@fastify/cookie` como dependencia directa de la API y se actualizo su lockfile.

## Commits

- `fab38ad feat: autenticar mediante cookies HttpOnly y CSRF`
- `7159d36 feat: consumir sesiones mediante cookies seguras`
- `3e5fba6 test: cubrir cookies HttpOnly y proteccion CSRF`
- El commit de este documento se agrega al cierre.

## Limites respetados

- Sin push, merge, cambio de rama, acceso a produccion ni despliegue.
- Sin cambios de aislamiento de propietarios ni perfil litologico.
- Sin cambios de base de datos: la columna y migracion de `version_sesion` permanecen intactas.

## Operacion y rollback

- El proxy debe conservar las cabeceras `Cookie`, `Set-Cookie` y `X-CSRF-Token`, y servir frontend/API bajo HTTPS en produccion para que `Secure` sea efectivo.
- Frontend y API deben publicarse juntos porque el contrato anterior con JWT en el cuerpo deja de ser compatible.
- Rollback recomendado: volver conjuntamente a las versiones anteriores de frontend y API. No es necesario revertir datos ni la migracion de `version_sesion`.
