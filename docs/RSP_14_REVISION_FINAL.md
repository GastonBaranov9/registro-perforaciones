# RSP-14 — revisión final dirigida

Fecha: 2026-10-05. Cambios sobre RSP-14 sin commit. HEAD inicial y final: `4997988df0c5d0ef5797cf165cd242785f3c7185`; rama `feature/rsp-10-pilot-apk`.

Esta revisión comprende exclusivamente los cuatro puntos solicitados y sus pruebas. El árbol ya contenía la implementación RSP-14 sin commit; no se revirtió ni se reescribió esa implementación. Complementa y actualiza [el informe inicial](RSP_14_OFFLINE_IDENTIDADES.md).

## 1. Último administrador

**Problema confirmado:** las operaciones administrativas eran transaccionales y serializaban escrituras de acceso, pero no comprobaban que quedara un administrador activo con cuenta de acceso.

Se agregó `exigirAdministradorActivo` antes del COMMIT, bajo el advisory lock exclusivo de administración `(731024,1)`. Comprueba el estado resultante de la transacción: usuario activo, cuenta de acceso y rol administración. Si no queda ninguno, responde 403 y revierte toda la operación, incluidas credenciales, roles, versión y revocaciones. Los locks se adquieren antes de leer/mutar; dos administradores no pueden aprobar simultáneamente la eliminación del otro basándose en un conteo anterior.

Protege DELETE de acceso, PUT de usuario (desactivación y reemplazo de roles), toggle de rol, eliminación y renombrado de un rol global. DELETE de acceso ahora usa una conexión/transacción explícita también para llamadas internas; los inicios administrativos internos toman el mismo lock. El borrado de una identidad sin acceso no puede eliminar un administrador activo: ya exige `cuenta_acceso=false` y ausencia de dependencias. Crear acceso no retira roles ni reduce administradores.

Con varios administradores sigue siendo posible retirar acceso o rol si queda al menos uno. No se agregó una prohibición general de autoedición.

## 2. Contraseñas

**Problema confirmado en el contrato:** el schema de crear acceso sólo declaraba strings; la longitud mínima se validaba más tarde en `hashPassword`, cuyo error genérico podía producir 500. El límite de bytes se verificaba únicamente en el servicio nuevo.

Se reutilizó y exportó `PasswordPlanoSchema`, compartido con el CRUD de cuentas. Mínimo vigente: 8 caracteres y al menos un carácter no blanco. Constantes compartidas en `constants/password.ts`; máximo de bcrypt: 72 bytes UTF-8, validado en `hashPassword` antes de hashear. El schema además limita a 72 caracteres. Password y confirmación usan el mismo schema; la igualdad se comprueba en el servicio. Errores de política devuelven 400. No se recortan contraseñas ni se altera su significado; `verifyPassword` conserva la compatibilidad de login existente. El hash continúa con bcrypt y coste 12, sin hashes/contraseñas en respuestas públicas.

## 3. Email / login

**No faltaba una constraint:** desde la migración 000, `usuario.email` es `CITEXT UNIQUE`. PostgreSQL ya evita duplicados equivalentes entre mayúsculas y minúsculas, incluso entre escrituras concurrentes. Login web y nativo consultan esa misma columna. Ambos schemas rechazan espacios alrededor; no los canonicalizan con trim en el servidor.

El endpoint nuevo comparte `EmailLoginSchema` con login. Se retiró el trim particular del servicio de creación de acceso, dejando exactamente la misma semántica. `owner@test.local` y `OWNER@TEST.LOCAL` acceden a la misma identidad; crear otro acceso equivalente da 400 y rollback. Insertarlo directamente en PostgreSQL da 23505. Tres variantes con espacios son rechazadas por login web, nativo y crear acceso.

**No se necesita una migración de emails ni se modifican datos existentes.**

## 4. Borrador offline rechazado

**Problema confirmado:** el contenido enviado quedaba congelado incluso ante errores corregibles, sin una salida que demostrara que un intento anterior no había creado el pozo.

Un 400/403/409 aislado no prueba ausencia de creación: pudo haber un intento anterior confirmado cuya respuesta se perdió. Por ello se agregó `POST /pozos/offline/:clave/cerrar`, autenticado y autorizado al perforador de la sesión. Usa el mismo lock transaccional `(actor, UUID)` que crear. Ambos caminos canonicalizan UUID a minúsculas antes del lock.

| Situación | Comportamiento |
| --- | --- |
| Timeout, conexión perdida, 5xx o respuesta incompleta | Conserva UUID de operación y payload congelado; reintenta exactamente el mismo envío. |
| 401 o revocación/pérdida de rol | Conserva archivos y operación; exige volver a autenticar la misma identidad con autorización vigente. |
| 400/403/409 | Solicita cierre autoritativo, sin asumir que no hubo creación. |
| Cierre encuentra recibo confirmado | Devuelve el resultado original y marca sincronizado; no genera otra clave. |
| Cierre confirma ausencia de creación | Persiste una clave cerrada antes del COMMIT; esa clave jamás podrá crear un pozo, ni desde una solicitud atrasada. |
| Cliente recibe cierre confirmado sin creación | Conserva ID local y foto; habilita editar, genera otra clave de operación y exige guardar una corrección antes de reintentar. |
| Respuesta de cierre perdida, rechazada o inválida | Mantiene clave original y contenido congelado. Repetir el cierre recupera el mismo desenlace. |

Crear y cerrar no pueden confirmar resultados incompatibles: se serializan con el mismo lock. La creación consulta primero recibos existentes y luego claves cerradas, antes de insertar sitio/pozo/foto o consumir numeración. Una clave cerrada responde 409 `OFFLINE_CLAVE_CERRADA`. Las fotos locales nunca se borran. Una caída antes de persistir el desbloqueo deja el estado anterior recuperable mediante el cierre repetible.

### Migración 015

`015_offline_claves_cerradas.sql` agrega únicamente `clave_offline_cerrada`, PK `(actor,clave)`, FK a identidad y fecha de cierre. Es necesaria para impedir que un envío antiguo llegue después de habilitar una corrección. No se modificó 014 ni ninguna migración aplicada.

Son marcas permanentes pequeñas, sin fotos ni payloads. Una fila por operación cerrada, ninguna adicional por reintentos del mismo cierre. El cliente no inicia nuevos ciclos hasta que el usuario guarda una corrección. No hay TTL: expirar una clave permitiría que un teléfono atrasado creara una perforación duplicada. La política futura de archivo debe preservar las claves; la FK conserva la identidad necesaria para esa trazabilidad.

Se aplicó y repitió exclusivamente mediante el migrador oficial en bases nuevas del laboratorio PostgreSQL 16 `rsp-014-offline-lab`, puerto loopback 60411. Nunca en el piloto.

## Archivos de esta revisión

- API: `proteccion-admin-service.ts`, `escritura-sesion.ts`, `usuarios-service.ts`, `roles-services.ts`.
- Password/login: `constants/password.ts`, `password-service.ts`, `models/schemas.ts`, `routes/usuarios.ts`, `acceso-persona-service.ts`.
- Offline: migración 015, `offline-cierre-service.ts`, `pozo-completo-service.ts`, `models/errors.ts`, `routes/pozos.ts`, `offline-repository.ts`, `offline.service.ts`.
- Tests: `password-service.test.ts`, `offline-identidad.postgres.local.ts`, `offline.spec.ts`; se actualizaron dobles de SQL en `usuarios-cuentas.test.ts` y `sesion-desactivada-auditoria.test.ts` para las nuevas consultas transaccionales.
- Documentación: este informe y referencia de actualización en el informe inicial.

## Pruebas nuevas

- Único administrador: borrar acceso, desactivarlo, reemplazar roles, quitar administración por toggle; rechazo y rollback de la fila completa.
- Borrar/renombrar administración global; rechazo sin perder administradores.
- Dos administradores: retirar acceso/rol al otro con éxito; dos autoeliminaciones concurrentes y dos retiros de rol concurrentes conservan exactamente uno.
- Password vacío, siete caracteres, mínimo válido de ocho, confirmación diferente, 73 bytes ASCII, 74 bytes UTF-8 y límite válido de 72 bytes.
- Emails equivalentes, rechazo directo por constraint PostgreSQL, login web/native y espacios alrededor.
- Cierre repetido, envío atrasado bloqueado, creación corregida, recuperación de recibo previo, carrera crear/cerrar usando UUID con diferente capitalización y cierre denegado sin rol.
- Cliente: cierre autoritativo permite editar sin perder identidad/foto; cierre perdido mantiene payload; recuperación al repetir; 0/401/500 no cambian clave; recibo de otra clave no desbloquea; recibo confirmado no duplica.

## Resultados finales

Todos los comandos se ejecutaron sobre el árbol actual. Resultados completos de la revisión en los logs temporales `rsp14-review-*.log`.

| Verificación | Resultado |
| --- | --- |
| API `npm test` | 333 pass, 0 fail, 0 skip |
| Integración PostgreSQL RSP-14 | 24 pass, 0 fail, 0 skip (23 casos + test contenedor) |
| Angular ChromeHeadless | 423 SUCCESS |
| `test:config` | 47 pass, 0 fail, 0 skip |
| Build API | exit 0 |
| Build web production | exit 0 |
| Build native production | exit 0; contrato CSS validado |
| `npx cap sync android` | exit 0; siete plugins conservados |
| `verify:native-assets` | exit 0; 231 archivos idénticos por SHA-256; branding 2 originales/26 derivados |
| `check:native-release-readiness` | exit 0; READY; 46 pass, 0 fail, 0 skip; MANUAL_CHECK de icono/splash |
| `check:utf8` | exit 0 |
| `git diff --check` | exit 0; sin errores de whitespace |

Corridas intermedias: API tuvo cinco fallos por dobles SQL anteriores a los nuevos locks/consulta; corregidos, pasó completa. PostgreSQL requirió registrar el stub de rate limit de tickets al agregar las rutas reales de login nativo; después pasó completa. Angular/builds fueron reintentados fuera del sandbox por acceso denegado; Capacitor por `uv_os_get_passwd`; configuración y preflight por restricciones de Gradle. No se modificó código de producción para eludir estas restricciones. Los builds web/native conservan el warning Stencil `empty-glob`, sin impedir la compilación.

## Límites y comprobaciones manuales

Pendiente prueba física Android de modo avión, cámara/GPS, cierre durante upload, recuperación de rechazo y reingreso de la misma cuenta. Los tests de Filesystem usan un doble persistente en memoria entre instancias del repositorio; no sustituyen esa prueba física. Se conserva el MANUAL_CHECK de icono/splash del preflight.

No se ejecutó commit, push, despliegue, instalación/desinstalación Android, APK firmada ni migración del piloto. No se leyó/modificó `.env.pilot.local`, no se ejecutó `013_bellagamba_cleanup.sql` y no se alteraron numeración/reserva 3001 ni datos del piloto. La numeración ficticia de pruebas pertenece únicamente a bases aisladas nuevas.

El preflight conserva applicationId `uy.com.raulsilva.perforaciones`, nombre `Raul Silva Perforaciones`, versionCode 1, versionName 1.0 y `debuggable=false`. Firma inspeccionada mediante sentinels sintéticos; ninguna firma real. Origen de build configurado sólo en el proceso: `https://api.raulsilvaperforaciones.com`, conforme a los assets existentes.

## Git status final

39 archivos modificados, 15 nuevos sin seguimiento, 0 staged. Incluye los cambios RSP-14 previos a esta revisión. Sin commit; HEAD y rama conservados. `git diff --check` pasa; sólo hay avisos de conversión LF/CRLF propios de la configuración Git del entorno.

```text
 M api/src/logging.ts
 M api/src/models/errors.ts
 M api/src/models/schemas.ts
 M api/src/plugins/cors.ts
 M api/src/routes/pozos.ts
 M api/src/routes/usuarios.ts
 M api/src/services/candidatos-pozo-service.ts
 M api/src/services/escritura-sesion.ts
 M api/src/services/password-service.ts
 M api/src/services/pozo-completo-service.ts
 M api/src/services/roles-services.ts
 M api/src/services/usuarios-service.ts
 M api/test/password-service.test.ts
 M api/test/sesion-desactivada-auditoria.test.ts
 M api/test/usuarios-cuentas.test.ts
 M front/android/app/src/main/res/xml/backup_rules.xml
 M front/android/app/src/main/res/xml/data_extraction_rules.xml
 M front/src/app/app.routes.ts
 M front/src/app/core/native/native-storage.service.ts
 M front/src/app/routes/home/home.page.html
 M front/src/app/routes/home/home.page.ts
 M front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts
 M front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.ts
 M front/src/app/routes/pozos/pozo/pozo.page.html
 M front/src/app/routes/session-status/session-status.page.html
 M front/src/app/routes/session-status/session-status.page.ts
 M front/src/app/routes/usuarios/components/usuario-form/usuario-form.component.html
 M front/src/app/routes/usuarios/pages/propietario-detail/propietario-detail.page.html
 M front/src/app/routes/usuarios/pages/propietario-detail/propietario-detail.page.ts
 M front/src/app/routes/usuarios/pages/usuarios-list/usuarios-list.page.html
 M front/src/app/routes/usuarios/pages/usuarios-list/usuarios-list.page.spec.ts
 M front/src/app/routes/usuarios/pages/usuarios-list/usuarios-list.page.ts
 M front/src/app/shared/services/auth-service/auth.service.spec.ts
 M front/src/app/shared/services/auth-service/auth.service.ts
 M front/src/app/shared/services/litologias.service.ts
 M front/src/app/shared/services/usuarios-list.service.ts
 M front/src/app/shared/types/schemas.ts
?? api/db/migrations/014_offline_identidad.sql
?? api/db/migrations/015_offline_claves_cerradas.sql
?? api/src/constants/password.ts
?? api/src/services/acceso-persona-service.ts
?? api/src/services/offline-cierre-service.ts
?? api/src/services/proteccion-admin-service.ts
?? api/test/offline-identidad.postgres.local.ts
?? docs/RSP_14_OFFLINE_IDENTIDADES.md
?? docs/RSP_14_REVISION_FINAL.md
?? front/src/app/core/guards/offline.guard.ts
?? front/src/app/core/native/offline-repository.ts
?? front/src/app/core/native/offline.service.ts
?? front/src/app/core/native/offline.spec.ts
?? front/src/app/routes/offline/offline.page.ts
?? front/src/app/routes/usuarios/components/acceso-persona.component.ts
```

## Propuesta actualizada de commit

`feat(offline): sync durable drafts idempotently and protect owner and admin access`
