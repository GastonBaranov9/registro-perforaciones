# Progreso ETAPA-RSP-03 - Revocacion permanente de sesiones

## Problema anterior

Los JWT solo identificaban al usuario. El middleware comprobaba que la cuenta siguiera activa, pero un token emitido antes de una desactivacion podia volver a funcionar al reactivar la cuenta. Los cambios de password o permisos tampoco invalidaban de forma permanente los tokens existentes.

## Arquitectura implementada

- La tabla `usuario` incorpora `version_sesion INTEGER NOT NULL DEFAULT 1` y una restriccion positiva.
- Cada login obtiene la version desde PostgreSQL y la firma dentro del JWT junto con `sub` y los roles.
- El middleware normaliza `sub` y `version_sesion` como enteros positivos seguros. Acepta numeros o strings decimales canonicos, conservando la politica previa de `sub`.
- En cada request autenticada se consulta conjuntamente `activo` y `version_sesion`. El token solo es valido si el usuario existe, esta activo y ambas versiones coinciden.
- Un `WeakMap` por request evita repetir la comprobacion de sesion cuando una ruta encadena `authenticate` con un guard de rol.
- Todos los rechazos de sesion usan HTTP 401 con el mensaje generico `Sesion invalida o no autorizada`, sin revelar existencia, actividad o version.
- `version_sesion` se mantiene fuera de `UsuarioPublico` y no aparece en respuestas administrativas.

## Reglas de revocacion

- Cuenta nueva: version 1 por default de PostgreSQL.
- Password proporcionado y valido: incrementa una vez, dentro de la transaccion que guarda el hash.
- Transicion de activo a inactivo: incrementa una vez.
- Reactivacion: no incrementa nuevamente, pero tampoco reduce la version; el token anterior sigue revocado.
- Cambio efectivo del conjunto de `id_rol`: incrementa una vez. Orden y duplicados no cuentan como cambio.
- `changeRol`: conserva advisory lock y agrega el incremento a la misma transaccion del toggle.
- Renombrar o eliminar un rol revoca las sesiones de los usuarios afectados porque el nombre determina autorizacion. Cambiar solo su descripcion no revoca.
- Cambios exclusivos de nombre o email y cuerpos equivalentes no incrementan.
- El bootstrap incrementa al reemplazar la password de una cuenta administrativa existente; una cuenta nueva comienza en 1.
- Cualquier fallo revierte conjuntamente datos, relaciones y version.

## Migracion

- Archivo incremental: `api/db/migrations/001_add_version_sesion.sql`.
- Es idempotente: agrega la columna y la restriccion solo si faltan, restablece el default, completa posibles nulos y fuerza `NOT NULL`.
- Instalaciones nuevas: `api/db/scripts.sql` contiene la misma columna y restriccion.
- No usa `DROP TABLE`, no recrea tablas y no elimina filas.

Aplicacion en otro entorno, despues de respaldar y seleccionar explicitamente la base correcta:

```sh
psql -v ON_ERROR_STOP=1 -f api/db/migrations/001_add_version_sesion.sql
```

El despliegue debe aplicar primero la migracion y luego la API que firma y valida la version. Reaplicar el archivo es seguro.

Rollback no destructivo recomendado: volver temporalmente a la version anterior de la API y conservar la columna; PostgreSQL tolera la columna adicional. No se recomienda eliminarla porque perderia el historial de revocacion y podria revivir tokens. Un rollback de seguridad debe invalidar o rotar el secreto JWT antes de volver a aceptar autenticacion antigua.

## Archivos modificados

- `api/db/scripts.sql` y la migracion incremental.
- Modelos y errores de API.
- Plugin JWT, ruta de login y servicio de autenticacion.
- Servicios de usuarios y roles.
- Bootstrap administrativo.
- `api/test/session-version.test.ts`.
- `api/test/session-revocation.local.ts`.
- Este documento.

## Commits

- `ca16e6e feat: agregar version de sesion a usuarios`
- `ecdd072 fix: revocar sesiones ante cambios sensibles`
- `cfc24d6 test: cubrir revocacion permanente de sesiones`
- `688e120 fix: reforzar migracion de version de sesion`
- `fcc72a4 test: verificar revocacion mediante middleware jwt`
- El commit de documentacion se agrega al cierre.

## Pruebas y resultados

- Tests backend nativos: 10/10 correctos.
- Suite frontend completa: 82/82 correctos.
- Build API: correcto.
- Build frontend: correcto.
- PostgreSQL local: migracion aplicada y reaplicada; 4 usuarios existentes quedaron inicialmente en version 1 y no hubo versiones nulas o no positivas.
- Prueba local controlada mediante `fastify.inject`: token vigente 200; usuario inactivo 401; token anterior tras reactivar 401; login nuevo 200; token anterior tras cambiar password 401; password anterior rechazada; password nueva aceptada; cambio de roles revoca; mismos roles reordenados/duplicados y cambios de nombre no revocan; un fallo de FK conserva version y token vigentes.
- La prueba crea un usuario temporal y verifica su eliminacion en `finally`; no imprime token, password, hash ni email.

## Auditoria

- No hay `SELECT *` en servicios de usuarios o roles.
- No existe `UsuarioRegister`.
- No se aplica `trim()` a password.
- No se registran tokens, passwords ni hashes.
- No se agregaron `any`, tests desactivados ni cambios a `package-lock.json`.
- `version_sesion` no se expone mediante contratos publicos.

## Advertencias y limitaciones

- `npm test` de la API sigue siendo un placeholder; los tests se ejecutan con el runner nativo de Node.
- La prueba integral local requiere PostgreSQL de desarrollo, variables de entorno locales y al menos dos roles. No debe apuntarse a produccion.
- Persisten advertencias no bloqueantes conocidas de Ionic/Stencil, iconos, Zone y `baseline-browser-mapping`.
- El token continua almacenado en `localStorage`. Cookies HttpOnly, CSRF y rotacion de refresh tokens quedan para una campana posterior.
