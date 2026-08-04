# Progreso ETAPA-RSP-02

## Bloque 1 — Roles dinámicos en edición

- Estado: completado.
- Commit: `e544436` (`feat: cargar roles dinamicamente al editar usuarios`).
- Archivos principales: página TS/HTML de edición.
- Resultado: usuario y catálogo cargados con `Promise.all`, deduplicación y reconciliación por `id_rol`, formulario bloqueado ante catálogo vacío o roles ausentes y condición de carrera eliminada mediante `userResource.error()`.
- Verificación: build frontend correcto.

## Bloque 2 — Validación frontend de roles

- Estado: completado.
- Commit: `1185309` (`feat: validar roles seleccionados en usuarios`).
- Archivos principales: utilidad `roles-seleccion`, creación y edición de usuarios.
- Resultado: selección no vacía, pertenencia al catálogo, deduplicación y cuerpos construidos con objetos canónicos del catálogo.
- Password no se normaliza; email y nombre conservan `trim()`.

## Bloque 3 — Auditoría de `isPropGuard`

- Estado: completado.
- Commit: `0438544` (`fix: validar rol propietario en isPropGuard`).
- Evidencia: el nombre del guard y los equivalentes backend `userIsPropietario`/`isProp()` establecen inequívocamente el rol `propietario`.
- Resultado: propietario permitido y usuario exclusivamente perforador rechazado.
- Pruebas dirigidas: 2/2 correctas.

## Bloque 4 — Pruebas automáticas

- Estado: completado.
- Commit: `401cfe6` (`test: cubrir roles guards y contrasenas de usuarios`).
- Infraestructura: import inválido de un spec corregido; Karma configurado con Zone.js ya instalado transitivamente.
- Cobertura y resultados:
  - roles, reconciliación y actualización: 11/11 correctos;
  - guard propietario: 2/2 correctos;
  - password API: 3/3 correctos;
  - build API: correcto;
  - build frontend: correcto.
- Suite frontend completa: 70 ejecutados, 20 correctos y 50 fallidos por problemas heredados de specs, principalmente providers HTTP ausentes y componentes standalone declarados como NgModule.

## Bloque 5 — Auditoría final

- Estado: completado.
- Hallazgos confirmados:
  - no hay IDs de rol `1`, `2` o `3` incrustados en creación o edición;
  - no hay `SELECT *` en los servicios de usuarios o roles;
  - no hay `trim()` aplicado a password;
  - no existe uso de `UsuarioRegister`;
  - las respuestas de usuarios usan `UsuarioPublico` y no exponen password/hash;
  - no se añadieron errores TypeScript;
  - los `any` de los handlers modificados se reemplazaron por `unknown`.
- Logs preexistentes revisados: `websocket.ts` registra `socketUser` y `jwt.ts` registra IDs; no imprimen tokens, passwords ni hashes. No se modificaron por estar fuera del alcance de la campaña.

## Advertencias conocidas

- Warnings no bloqueantes: `baseline-browser-mapping`, glob vacío de Stencil y conversión LF/CRLF.
- La suite frontend heredada no está verde; los 50 fallos no fueron provocados por esta campaña.

## Decisiones pendientes

- Para probar sesiones activas/inactivas y actualización real de password se necesita una base de pruebas o inyección/mocking formal del pool PostgreSQL.
- La reparación integral de los specs frontend heredados requiere una campaña específica de infraestructura de pruebas.

## Trabajo no realizado y motivo

- No se probaron sesiones ni persistencia de password contra PostgreSQL para evitar credenciales y datos reales.
- No se implementaron migraciones, `version_sesion`, cookies, aislamiento de perforaciones ni otros cambios expresamente fuera de alcance.
- No se repararon los 50 specs heredados porque implicaría modificar numerosos módulos no relacionados.
