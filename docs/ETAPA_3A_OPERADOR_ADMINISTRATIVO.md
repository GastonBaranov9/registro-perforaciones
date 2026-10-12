# ETAPA 3A — operador_administrativo

## Estado encontrado al retomar

- Rama `feature/rsp-10-pilot-apk`, HEAD `1366147`.
- 44 archivos modificados y 3 nuevos, todos de la etapa 3A. Se revisaron `git status --short`, `git diff`, `git diff --stat` y los archivos nuevos antes de editar.
- Existían capacidades, la migración 018 y `api/test/operador-administrativo.test.ts`. Se continuó ese trabajo sin checkout, reset ni reversión.
- Los logs anteriores existían: frontend 562 aprobados / 26 fallidos. Había correcciones de mocks guardadas aún sin validar.

## Migración

`api/db/migrations/018_operador_administrativo.sql` inserta exclusivamente el rol, con `ON CONFLICT (nombre) DO NOTHING`. No cambia esquemas de pozos, contadores ni asignaciones a cuentas. No se modificaron migraciones 000–017. Se ejecutaron exclusivamente en el laboratorio PostgreSQL desechable descrito abajo.

## Matriz efectiva del operador

| Capacidad | Resultado |
|---|---|
| Listar todos los pozos, detalle, informes y fotografía | Permitido |
| Crear y editar históricos | Permitido, conservando validaciones históricas |
| Crear un pozo normal | Permitido por el alta completa existente, con perforador existente y numeración automática |
| Editar datos operativos, ubicación y técnicos | Permitido, conservando validaciones de datos y recursos |
| Litologías dentro del pozo, diámetros, filtros y aportes | Permitido |
| Subir, reemplazar y eliminar fotografías | Permitido conforme a reglas existentes |
| Descargar PDF y exportar KML global | Permitido |
| Consultar candidatos y catálogos operativos | Permitido; no habilita administración de identidades |
| Usuarios, cuentas, habilitar acceso, credenciales y contraseñas | Prohibido, incluso modificar la propia cuenta mediante endpoints administrativos |
| Asignar/quitar roles y CRUD del catálogo de roles | Prohibido |
| Configuración de numeración, contador y asignación manual administrativa | Prohibido |
| CRUD/activación/desactivación global de litologías | Prohibido; consulta operativa conservada |
| Eliminar pozos | Prohibido |
| Crear o editar identidades desde carga histórica | Prohibido |
| Sitios independientes: consultar/editar/listar/crear/eliminar | Prohibido; el operador sólo consulta/edita sitios asociados a un pozo |
| Vinculación administrativa del propietario | Continúa reservada a administración |
| Perforador provisional y su vinculación administrativa | No implementados |

## Backend

`capacidades.ts` define `operarTodosLosPozos`, `gestionarHistoricos`, `escribirPozos`, `consultarRecursos` y `administrarUsuarios`. Las comprobaciones consultan roles persistidos y una cuenta activa con acceso; no usan nombres de rol enviados en el JWT ni el usuario del parámetro URL como actor. Los nombres se comparan sin distinguir mayúsculas, conservando los nombres canónicos y sin aceptar variantes de espacios, acentos o nombres desconocidos.

`jwt.ts` añade middleware específico para operaciones y consulta. `userIsAdmin` sigue exigiendo exclusivamente `administracion`; registra ese requisito para revalidarlo al escribir. El helper `isAdmin()` no se modificó.

`escritura-sesion.ts` revalida la capacidad en la conexión transaccional, después de tomar los locks existentes y comprobar cuenta, versión de sesión y sesión nativa. La capacidad global permite al operador editar pozos ajenos/antiguos e históricos. El perforador mantiene la ventana y el alcance existentes. No se exime al operador de autenticación, revocación ni permisos administrativos.

`historicos-service.ts` exige `gestionarHistoricos` dentro de la transacción, sustituyendo la dependencia de autorización administrativa de numeración. No se modificó la lógica del contador ni sus triggers. Se conservan la validación del número histórico, idempotencia, época, fotografías y validaciones técnicas.

Pozos, sitios, familias técnicas, fotos, KML y las rutas de consulta/PDF usan las capacidades pertinentes. En PDF sólo cambió el middleware de acceso y su prueba; no se modificó la generación del documento.

### Combinaciones de roles

Se rechaza `administracion + operador_administrativo` con error 400 al crear/editar una cuenta, asignar un rol o renombrar un rol provocando esa combinación. La validación obtiene los nombres del catálogo por IDs y considera mayúsculas/minúsculas para evitar eludirla. Usa el lock administrativo exclusivo existente y rollback; las demás combinaciones se conservan.

Esta protección pertenece a los servicios de la aplicación; una escritura SQL externa puede eludirla. La migración se mantuvo limitada al registro del rol, como se solicitó. Los cambios de roles siguen revocando sesiones mediante `version_sesion`.

## Frontend

- `MainStore.isAdmin()` conserva su implementación exclusiva de administración.
- `AuthService` incorpora capacidades operativas, de históricos y administrativas separadas.
- Guards operativos para creación y edición técnica; guard específico de históricos. Guards administrativos sin ampliación.
- Menú de perforaciones con históricos y creación para el operador. Listado con edición normal/histórica y KML; eliminación permanece oculta y bloqueada.
- Seleccionar propietarios/perforadores existentes se separa de crear/editar identidades. Los handlers de creación/edición de identidades en históricos también comprueban el permiso administrativo.
- El operador edita ubicación desde el flujo de pozo; no recibe el módulo independiente de administración de sitios.
- Sin cambios de modelo para perforador provisional ni creación temporal de identidades.

## Endpoints

`U` representa cualquier ID en la URL; el actor siempre es la sesión autenticada. `P` y `S` son los recursos objetivo.

| Permitidos | Alcance |
|---|---|
| `GET /usuarios/U/pozos` y `GET /usuarios/U/pozos/P` | Global |
| `POST /usuarios/U/pozos/completo` | Alta normal automática |
| `PUT /usuarios/U/pozos/P` y `/completo` | Edición operativa con reglas existentes |
| `POST /pozos/historicos`, `PATCH /pozos/historicos/P` | Histórico |
| `GET /pozos/candidatos-personas` | Personas existentes, sólo consulta |
| `GET /pozos/epoca-datos` | Época del flujo operativo |
| Familias de intervalos litológicos, diámetros, filtros y aportes bajo `/usuarios/U/pozos/P` | Consulta y mutaciones técnicas |
| `GET/POST/DELETE /usuarios/U/pozos/P/foto` | Foto del pozo |
| `GET/PUT /usuarios/U/sitios/S` y consultas de mapa | Sólo sitios asociados a un pozo; independiente devuelve 403 |
| Rutas de informe/perfil y `GET /usuarios/U/pozos/P/informe-pdf` | Consulta, vista previa y descarga |
| `GET /pozos/exportar/kml` | Exportación global |
| `GET /litologias`, `GET /litologias/:id` | Consulta operativa |

| Prohibidos | Resultado comprobado |
|---|---|
| `POST/PUT/DELETE /usuarios...` administrativos | 403 |
| `POST /usuarios/personas/:id/acceso` | 403 |
| `PUT /usuarios/:id` con contraseña/email, propio o ajeno | 403 |
| `PUT /usuarios/:id/roles/:id_rol` | 403 |
| `GET/POST/PUT/DELETE /roles...` | 403 |
| `GET/PUT /pozos/numeracion` y consulta administrativa de disponibilidad | 403 |
| `PATCH /pozos/P/numero-perforacion` | 403 |
| `POST/PUT /litologias...`, `PATCH .../activar`, `PATCH .../desactivar` | 403 |
| `GET /litologias?incluir_inactivas=true` | 403 |
| `DELETE /litologias/:id` | 404: no existe borrado físico para ningún rol |
| `DELETE /usuarios/U/pozos/P` | 403 |
| `POST /pozos/propietarios`, `PUT /pozos/propietarios/:id` | 403 |
| `PUT /pozos/P/propietario` | 403 |

## Los 26 fallos frontend

| Grupo | Cantidad | Clasificación y solución |
|---|---:|---|
| EdicionPozoService | 2 | C: mock sin `puedeOperarTodosLosPozos`. Se completó el mock preservando roles y ventana de edición. |
| Carga histórica | 18 | C: mock sin capacidades usadas en el template/handlers. Se completó el mock administrativo y se añadió un caso operador sin gestión de identidades. |
| Rutas web/Android × tres roles | 6 | A: comprobaban que creación incluyera el guard anterior por identidad. Se verificó el nuevo guard y el comportamiento efectivo de los cuatro roles, ampliando rutas administrativas e históricas. |

No se deshabilitaron tests ni se relajaron expectativas de propietario/perforador/administración. Los 26 errores quedaron resueltos. Dos textos nuevos con acentos dañados en el trabajo parcial también se corrigieron.

## Pruebas y builds

| Validación | Resultado |
|---|---|
| Reproducción enfocada: edición e históricos frontend | 29/29 |
| Frontend enfocado: rutas, guards, menús, formularios/pozos, históricos, store y selección de roles | 233/233 |
| Backend enfocado: operador, múltiples roles, históricos, KML, PDF, edición y auditoría de sesiones | 58/58; después se validó la ampliación final de operador: 8/8 |
| `cd api; npm.cmd test` | 396/396 después de la validación PostgreSQL, sin fallos, cancelados ni omitidos |
| `cd front; npm.cmd test -- --watch=false --browsers=ChromeHeadless` | 600/600 |
| `cd api; npm.cmd run build` | Correcto, `tsc` |
| `cd front; npm.cmd run build` | Correcto, build production; aviso `empty-glob` en Stencil |
| `git diff --check` | Correcto, sin errores de whitespace |

Las pruebas HTTP de restricciones mantienen schemas y payloads válidos. Se complementan con un inventario de hooks reales que aísla los handlers, pruebas de servicios/transacciones y de combinaciones. Se ejercitan alta normal e históricos por HTTP con servicios reales y SQL simulado, bloqueo de cuentas y rollback de asignaciones incompatibles, revocación web/nativa y versión de sesión. La prueba de PDF usa middleware real y verifica bytes PDF generados. KML valida la descarga efectiva del operador.

## Validación PostgreSQL real completada — 2026-10-12

Se creó un clúster nativo PostgreSQL **18.4** mediante `initdb`, con autenticación SCRAM y contraseña efímera. No se usó Docker, ningún servidor preexistente, `.env`, `.env.pilot.local` ni `rsp-pilot`.

Ejecución final: `127.0.0.1:52869`, directorio `C:/Users/RAULSI~1/AppData/Local/Temp/etapa3a-pg-validation-TFC0w5/data`. Antes de crear usuarios/bases de prueba se verificaron `SHOW data_directory` contra el directorio recién creado, `SHOW listen_addresses = 127.0.0.1` y el inventario inicial exacto `postgres`, `template0`, `template1`. El ejecutor descartó configuración de conexión heredada y opciones de precarga de Node. Las suites crearon bases exclusivas `rsp_reset_test_<pid>_<timestamp>` y `rsp_session_test_<pid>_<timestamp>`.

Históricos aplicó **000–017** mediante `ejecutarMigraciones`, creó cuentas sintéticas y aplicó **018_operador_administrativo.sql** con el mismo migrador. Se compararon cuentas, asignaciones, roles existentes y contador antes/después: sin alteraciones. El nuevo rol existe una sola vez y repetir el migrador no aplica nada. Se conserva la convención de nombre, ledger, checksum y transacción del migrador. La suite de sesiones aplicó 000–018 con su mecanismo SQL local existente.

| Prueba final de esta pasada | Resultado |
|---|---|
| `historicos.postgres.local.ts` | **12/12** (11 subpruebas y contenedor) |
| `escritura-sesion.postgres.local.ts` | **91/91** (90 subpruebas y contenedor), HTTP web/Android, bloqueos reales y rollback |
| Backend enfocado: operador, auditoría de sesiones, edición, roles múltiples, históricos | **27/27** |
| Backend completo, `npm.cmd test` | **396/396** |
| Backend build, `npm.cmd run build` | Correcto |
| `git diff --check` | Correcto |

No se repitió frontend: no hubo cambios frontend en esta pasada; se conserva la validación previa 600/600 y build correcto.

Se verificaron por HTTP sobre SQL real: creación/edición histórica del operador y administración, listado/detalle global del operador, 403 para cuentas/credenciales/acceso/roles/numeración/catálogo global/eliminación/creación de identidades. Administración conserva acceso administrativo. Retirar el rol o cambiar `version_sesion` **después del middleware y antes del handler** impide la escritura dentro de la transacción. También se probó el servicio histórico sin middleware con el rol retirado. No quedan datos o reservas de esos intentos.

Los históricos mantienen idempotencia, concurrencia, validaciones técnicas, fotos y rollback con PostgreSQL real. La suite de sesiones verifica 40 operaciones por web y Android, revocación en ambas ordenaciones de locks, rollback de foto y SQL, y conservación de la ventana del perforador y de edición administrativa.

### Fallos encontrados y correcciones limitadas

1. El test histórico sobrescribía `PGPASSWORD` con una cadena vacía, incompatible con SCRAM. Ahora conserva la credencial efímera explícita del laboratorio.
2. Los nuevos helpers filtran cuentas inactivas, por lo que una revocación entre autenticación y autorización se confundía con falta de rol (403). `jwt.ts` reconsulta estado/versión al denegar capacidad, y antes de resolver permisos de pozo sin acceso global: conserva **401 para sesión revocada** y **403 para falta de permiso**. Se añadió regresión unitaria; no se amplió ningún permiso ni se quitó la revalidación transaccional.
3. El inventario local de sesiones omitía tres rutas ya existentes: habilitar acceso, eliminar identidad y cerrar clave offline. Se añadieron sus casos de revocación y comprobación de cobertura por URL; no se ocultaron ni deshabilitaron pruebas.

Archivos tocados exclusivamente en esta pasada: `api/src/plugins/jwt.ts`, `api/test/historicos.postgres.local.ts`, `api/test/escritura-sesion.postgres.local.ts`, `api/test/operador-administrativo.test.ts` y este informe. La migración 018 no necesitó cambios. Ningún cambio nuevo en frontend, PDF, contador ni modelo de pozo.

El ejecutor temporal queda en `%TEMP%/etapa3a-postgres-validation.cjs`. Evidencia sin secretos y logs finales: `%TEMP%/etapa3a-pg-validation-TFC0w5/{evidence.json,results.json,historicos.postgres.local.ts.log,escritura-sesion.postgres.local.ts.log}`. Log backend completo: `%TEMP%/etapa3a-backend-postgres-final.log`. Se comprobó que ambas bases de prueba fueron eliminadas; luego se detuvo el clúster propio y se eliminó su directorio de datos.

## Correcciones de auditoría final — 2026-10-12

Esta pasada corrige exclusivamente los tres hallazgos solicitados. Los resultados anteriores se conservan como historial; los resultados vigentes son los siguientes.

1. **Normalización:** `rolesPermiten` y la compatibilidad multirol comparten normalización a minúsculas, con la misma semántica para los nombres canónicos que `LOWER` en `rolUser` y la protección del último administrador. No se reescriben nombres almacenados ni se añade al operador a administración. PostgreSQL comprobó el renombrado `administracion → Administracion`, 401 del token anterior, nueva sesión con administración efectiva, creación/eliminación de un rol y reversión del nombre. La variante `OPERADOR_ADMINISTRATIVO` mantiene operaciones históricas y recibe 403 administrativo. Los tests comparan también perforador/propietario y rechazan nombres desconocidos. No fue necesario cambiar `jwt.ts`, `roles-services.ts` ni la protección del último administrador en esta corrección.
2. **Sitios:** `puedeOperarSitioGlobal` mantiene el acceso global de administración, pero exige al operador al menos un pozo asociado. Se usa en GET, PUT y mapas, y nuevamente desde `escritura-sesion` sobre la conexión de escritura. `rolUser` admite esa conexión sin cambiar su comprobación administrativa. La lectura transaccional de la asociación usa `FOR SHARE`, reteniéndola hasta COMMIT. El operador sin asociación recibe 403; POST, DELETE y listado independiente siguen cerrados. Perforador/propietario conservan sus reglas. El frontend vuelve a exigir asociación para editar sitios; esa corrección deja `permisos-sitio.service.ts` idéntico a HEAD y por eso desaparece del diff final.
3. **Código muerto:** se eliminaron la capacidad backend `administrarNumeracion` y el método frontend `puedeAdministrarNumeracion()`, sin consumidores efectivos. La autorización real de numeración no cambió: middleware administrativo y comprobación administrativa del servicio. El input del formulario con nombre parecido sigue teniendo consumidores y se conserva.

| Validación posterior a las correcciones | Resultado |
|---|---|
| Backend enfocado: operador/capacidades, sitios, edición, roles múltiples y revocación JWT web/Android | **36/36** |
| Backend completo, `npm.cmd test` | **398/398**, sin fallos, cancelaciones ni omitidos |
| Frontend enfocado: permisos de sitios, edición, guards y rutas | **33/33** |
| Frontend completo, `npm.cmd test -- --watch=false --browsers=ChromeHeadless` | **605/605** |
| PostgreSQL históricos, roles y sitios | **15/15**, incluyendo contenedor |
| PostgreSQL sesiones/escrituras | **91/91**, incluyendo contenedor |
| Backend `npm.cmd run build` | Correcto |
| Frontend `npm.cmd run build` | Correcto; aviso existente `empty-glob` de Stencil |
| `git diff --check` | Correcto |

La primera prueba PostgreSQL de la carrera no observó el bloqueo por consultar `pg_stat_activity` repetidamente dentro de la misma transacción. Se corrigió únicamente la observación del test usando otra conexión en autocommit. La repetición conserva la expectativa 403 y verifica que el sitio no cambia. No se deshabilitó ninguna prueba ni se relajaron permisos. Angular necesitó ejecución fuera del sandbox por errores de lectura de archivos; la repetición pasó. `initdb` también necesitó salir del sandbox en la repetición por su error de token restringido.

Se usó el ejecutor temporal ya revisado, con PostgreSQL nativo 18.4, SCRAM y configuración heredada descartada. Cada ejecución verificó `SHOW data_directory`, escucha exclusiva en `127.0.0.1` e inventario inicial `postgres/template0/template1` antes de crear fixtures. Históricos aplicó 000–018 con el migrador del proyecto, sin modificar ninguna migración.

- Sesiones/escrituras 91/91: `127.0.0.1:54627`, evidencia `%TEMP%/etapa3a-pg-validation-X3kuyr/escritura-sesion.postgres.local.ts.log`.
- Históricos final 15/15: `127.0.0.1:61871`, evidencia `%TEMP%/etapa3a-pg-validation-fjboSI/{evidence.json,results.json,historicos.postgres.local.ts.log}`.
- Ambos clústeres fueron detenidos; se verificó la eliminación de sus bases de prueba y se eliminaron sus directorios de datos. El intento de inicialización restringido no llegó a iniciar otro servidor.
- La prueba de carrera retiene el gate administrativo, deja que HTTP compruebe la asociación y que la escritura espere, retira la asociación, libera el gate y comprueba el rechazo transaccional sin modificación del sitio.

Archivos tocados **en esta corrección**, además del trabajo preexistente: `api/src/services/capacidades.ts`, `api/src/services/auth-services.ts`, `api/src/services/edicion-pozo.ts`, `api/src/services/escritura-sesion.ts`, `api/src/routes/sitios.ts`, `api/test/operador-administrativo.test.ts`, `api/test/sitios-standalone.test.ts`, `api/test/historicos.postgres.local.ts`, `front/src/app/shared/services/auth-service/auth.service.ts`, `front/src/app/shared/services/permisos-sitio.service.ts`, el nuevo `front/src/app/shared/services/permisos-sitio.service.spec.ts` y este informe.

Revisión propia final: operador sin GET/PUT de sitios independientes incluso con perforador/propietario; administración mantiene ese acceso; nombres desconocidos no adquieren capacidades; operador nunca satisface administración; numeración administrativa permanece cerrada. Se mantienen `MainStore.isAdmin()`, `userIsAdmin`, permisos de eliminación de pozos, usuarios/cuentas/roles y catálogo global. No se reactivan informes/características legacy. No se modificaron generación PDF, contador, migraciones, `.env`, Docker o Cloudflare. No hubo conexión a producción, ni consumo o reserva del **3282 real**; ese número aparece únicamente como dato sintético del laboratorio.

## Límites y decisiones pendientes

- Se verificó con una inserción SQL dentro de una transacción revertida que SQL externo puede asignar `administracion + operador_administrativo`. Los servicios rechazan la combinación con 400 y rollback. No se añadió ninguna restricción SQL; queda como decisión posterior.
- No se ejecutaron operaciones ni migraciones contra producción. No se consumieron/reservaron números reales; no se consultó el contador productivo. El 3282 utilizado por el test de alta normal pertenece exclusivamente al fixture desechable y no altera el próximo automático productivo.
- `.env`, Docker, Cloudflare, migraciones aplicadas y generación PDF permanecen sin cambios.
- No hay commit ni push. Etapa 3B pendiente por decisión de alcance; no implementada.

## Archivos finales y estado de Git

El bloque siguiente es el inventario completo final de `git status --short`. `M` indica archivo modificado y `??` archivo nuevo sin seguimiento.

```text
 M api/src/plugins/jwt.ts
 M api/src/routes/historicos.ts
 M api/src/routes/informes.ts
 M api/src/routes/intervalos-diametro-perforaciones.ts
 M api/src/routes/intervalos-filtro.ts
 M api/src/routes/intervalos-litologicos.ts
 M api/src/routes/niveles-aporte.ts
 M api/src/routes/pozos.ts
 M api/src/routes/sitios.ts
 M api/src/services/auth-services.ts
 M api/src/services/candidatos-pozo-service.ts
 M api/src/services/edicion-pozo.ts
 M api/src/services/escritura-sesion.ts
 M api/src/services/historicos-service.ts
 M api/src/services/roles-services.ts
 M api/src/services/usuarios-service.ts
 M api/test/edicion-pozo.test.ts
 M api/test/escritura-sesion.postgres.local.ts
 M api/test/exportar-kml.test.ts
 M api/test/historicos.postgres.local.ts
 M api/test/informes-legacy.test.ts
 M api/test/pdf-historicos.test.ts
 M api/test/pozos-roles-multiples.test.ts
 M api/test/propietario-operativo.test.ts
 M api/test/rsp06k-r6-preview-auth.test.ts
 M api/test/sesion-desactivada-auditoria.test.ts
 M api/test/sitios-standalone.test.ts
 M front/src/app/app.routes.spec.ts
 M front/src/app/app.routes.ts
 M front/src/app/app.spec.ts
 M front/src/app/core/guards/islogged-guard-guard.spec.ts
 M front/src/app/core/guards/islogged-guard-guard.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts
 M front/src/app/routes/pozos/pages/historicos/historicos.page.html
 M front/src/app/routes/pozos/pages/historicos/historicos.page.spec.ts
 M front/src/app/routes/pozos/pages/historicos/historicos.page.ts
 M front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.html
 M front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts
 M front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.html
 M front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.ts
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts
 M front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html
 M front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts
 M front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.ts
 M front/src/app/routes/pozos/pozo/pozo.page.html
 M front/src/app/routes/pozos/pozo/pozo.page.spec.ts
 M front/src/app/shared/services/auth-service/auth.service.ts
 M front/src/app/shared/services/edicion-pozo.service.spec.ts
 M front/src/app/shared/services/edicion-pozo.service.ts
 M front/src/app/shared/utils/roles-seleccion.spec.ts
 M front/src/app/shared/utils/roles-seleccion.ts
?? api/db/migrations/018_operador_administrativo.sql
?? api/src/services/capacidades.ts
?? api/test/operador-administrativo.test.ts
?? docs/ETAPA_3A_OPERADOR_ADMINISTRATIVO.md
?? front/src/app/shared/services/permisos-sitio.service.spec.ts
```
