# Auditoría de seguridad: desactivación de empleado y escrituras pendientes

Fecha: 2026-10-02. Rama: `feature/rsp-10-pilot-apk`; HEAD sin cambios: `b9d9666`. Estado: cambios locales preparados para revisión, sin commit. Esta actualización reemplaza el dictamen provisional de la auditoría del mismo día.

**Dictamen técnico: la carrera observada quedó corregida para las 37 operaciones HTTP autenticadas del inventario.** Una escritura que ya autenticó pero todavía no obtuvo el bloqueo de sesión recibe 401 si la desactivación se confirmó primero. Si la escritura obtiene el bloqueo primero, la transacción de desactivación espera su COMMIT o ROLLBACK y confirma después. No se observó ningún cambio tardío en la base ni en las fotos en los ensayos de PostgreSQL real con credenciales web y Android.

## Implementación y decisión de bloqueos

- Administración mantiene la opción **Activo** en `front/src/app/routes/usuarios/components/usuario-form/usuario-form.component.html`, accesible desde edición de empleados y `UsuariosEditService`. `PUT /usuarios/:id_usuario` en `api/src/routes/usuarios.ts` llama a `updateUsuario`, que bloquea al empleado, cambia `activo` e incrementa `version_sesion` al desactivar. La reactivación conserva la versión incrementada: no rehabilita JWT ni bearer anteriores.
- Las verificaciones `onRequest` permanecen: cookie JWT y sesión nativa consultan el estado vigente en cada petición nueva. El plugin JWT propaga la identidad ya autenticada al servicio con `AsyncLocalStorage`, sin abrir por sí mismo ninguna transacción. `iniciarEscrituraSesion` ejecuta `BEGIN` en la **misma conexión** que guardará el cambio; toma un advisory lock compartido de escrituras comunes o exclusivo de administración de cuentas/roles; bloquea la fila del actor con `FOR SHARE`; coteja `activo`, `cuenta_acceso`, `version_sesion` y expiración. En Android además bloquea y coteja la fila de `sesion_nativa` (revocación, caducidad y versión). Los bloqueos se mantienen hasta COMMIT/ROLLBACK de la operación original.
- Orden canónico para escrituras HTTP: gate administrativa → actor → sesión nativa, si aplica → pozo, propietario, rol u otro recurso. Los cambios de cuentas/roles toman el gate exclusivo **antes** del `FOR UPDATE` del empleado o rol. Las escrituras del dominio lo toman compartido. El `FOR SHARE` de la cuenta impide que una desactivación por SQL confirme mientras la escritura protegida siga abierta; el gate evita inversiones de bloqueos actor/destinatario entre operaciones administrativas. Dos administradores que se editan mutuamente se ensayaron en paralelo sin deadlock.
- Los servicios que ya tenían transacciones conservan su conexión y su COMMIT original. Las operaciones antes autocommit (pozo simple, intervalos, ubicaciones, catálogo, roles y otros recursos) usan `conEscrituraSesion` para incluir validación y mutación en una sola transacción. Los métodos auxiliares que reciben un cliente solo lo reutilizan si la misma petición ya lo protegió. Después de esperar bloqueos se repite la restricción de edición del pozo o sitio para perforadores; administración mantiene su excepción de las 24 h.
- El reemplazo y borrado de fotos valida sesión antes de mover, crear o borrar archivos. La compensación intenta restaurar archivos antes del ROLLBACK explícito y siempre intenta ambas fases. Un fallo de ROLLBACK descarta la conexión. Se probó con PostgreSQL real que un reemplazo que falla en SQL restaura bytes y retira el archivo nuevo; las 37 rutas rechazadas mantienen instantáneas idénticas de tablas, foto y directorio. Una caída total del proceso o del almacenamiento entre filesystem y COMMIT sigue siendo un límite de atomicidad preexistente; requiere el reconciliador de fotos ya disponible.
- `niveles-aporte.ts` tenía tres handlers que registraban errores y respondían 200 vacío. Ahora los propagan para que la denegación transaccional se vea como 401.

## Alcance y excepciones justificadas

El bloqueo se aplica a las **30 escrituras operativas del dominio** y las **7 de administración** listadas abajo. El POST de creación legacy de pozo sigue deshabilitado y la vista previa de perfil litológico solo calcula, sin persistir. GET, WebSocket, mapas, informes y descarga de fotos son lecturas, regidas por sus controles de autenticación y permisos. Los procesos internos de migración, bootstrap y mantenimiento no son peticiones con una sesión de empleado; no reciben una identidad HTTP. El logout individual nativo puede revocar únicamente su propia sesión incluso si ya no tiene acceso, pero no modifica registros del dominio; logout-all y emisión de ticket sí usan la transacción de sesión cuando hay un actor vigente. El login nuevo exige credenciales y cuenta activas y el consumo de tickets WebSocket revalida y bloquea usuario/sesión según el mecanismo anterior.

## WebSocket y varias instancias

El proceso que desactiva cierra localmente las conexiones del usuario con código 4003. En otra instancia puede quedar una conexión de notificaciones hasta la revalidación periódica de 30 segundos más la consulta. La conexión solo recibe notificaciones, no acepta comandos de escritura; cualquier PUT/POST/PATCH/DELETE posterior pasa por HTTP y por la transacción protegida en la instancia que lo atienda. La ventana de notificaciones permanece como límite conocido; no afecta la garantía de COMMIT de escritura.

## Inventario de operaciones

Las **17 rutas anteriores no son la totalidad**. En esta intervención las 37 operativas reciben validación transaccional antes de mutar. Son las escrituras sobre un pozo existente, foto y cuatro familias técnicas. Hay **30 combinaciones método/ruta operativas del dominio** al incluir creación, sitios, propietarios, numeración y catálogo; además hay **7 operaciones administrativas de usuarios/roles** que pueden afectar personas vinculadas o permisos. El POST legacy de creación está registrado pero deshabilitado. Todos los métodos siguientes requieren sesión; los permisos indicados son adicionales.

Rutas internas Fastify. En el origen público configurado se antepone `/api`.

Abreviaturas: `P = /usuarios/:id_usuario/pozos/:id_pozo`; `S = /usuarios/:id_usuario/sitios`. “24 h” significa administración o perforador creador dentro del plazo, según el código preparado.

### Las 17 originales

| Método | Ruta | Permiso adicional |
| --- | --- | --- |
| PUT | `P` | 24 h |
| PUT | `P/completo` | 24 h |
| DELETE | `P` | Administración |
| POST | `P/foto` | 24 h |
| DELETE | `P/foto` | 24 h |
| POST | `P/intervalo_litologico` | 24 h |
| PUT | `P/intervalo_litologico/:id_intervalo_litologico` | 24 h |
| DELETE | `P/intervalo_litologico/:id_intervalo_litologico` | 24 h |
| POST | `P/intervalo_diametro_perforacion` | 24 h |
| PUT | `P/intervalo_diametro_perforacion/:id_intervalo_diametro_perforacion` | 24 h |
| DELETE | `P/intervalo_diametro_perforacion/:id_intervalo_diametro_perforacion` | 24 h |
| POST | `P/intervalos_filtro` | 24 h |
| PUT | `P/intervalos_filtro/:id_intervalo_filtro` | 24 h |
| DELETE | `P/intervalos_filtro/:id_intervalo_filtro` | 24 h |
| POST | `P/niveles_aporte` | 24 h |
| PUT | `P/niveles_aporte/:id_nivel_aporte` | 24 h |
| DELETE | `P/niveles_aporte/:id_nivel_aporte` | 24 h |

### Otras 13 operativas del dominio

| Método | Ruta | Alcance / permiso |
| --- | --- | --- |
| POST | `/usuarios/:id_usuario/pozos/completo` | Creación atómica de pozo, sitio, hijos y foto; administración/perforador |
| POST | `S` | Alta de sitio; administración |
| PUT | `S/:id_sitio` | Administración o todos los pozos vinculados propios y dentro de 24 h |
| DELETE | `S/:id_sitio` | Administración; rechaza sitio con pozos |
| POST | `/pozos/propietarios` | Administración; alta de identidad operativa |
| PUT | `/pozos/propietarios/:id_propietario` | Administración; datos mostrados por pozos vinculados |
| PUT | `/pozos/:id_pozo/propietario` | Administración; vinculación de propietario real |
| PUT | `/pozos/numeracion` | Administración; contador global |
| PATCH | `/pozos/:id_pozo/numero-perforacion` | Administración; número pendiente |
| POST | `/litologias` | Administración; alta de catálogo |
| PUT | `/litologias/:id_litologia` | Administración; catálogo referenciado por intervalos/perfiles |
| PATCH | `/litologias/:id_litologia/activar` | Administración |
| PATCH | `/litologias/:id_litologia/desactivar` | Administración |

### Administración relacionada: otras 7

| Método | Ruta | Alcance |
| --- | --- | --- |
| POST | `/usuarios` | Alta de cuentas/personas con acceso |
| PUT | `/usuarios/:id_usuario` | Datos, roles, contraseña y activo; puede cambiar datos visibles en pozos |
| DELETE | `/usuarios/:id_usuario` | Borrado sujeto a integridad referencial |
| PUT | `/usuarios/:id_usuario/roles/:id_rol` | Asignar/quitar rol y revocar sesiones |
| POST | `/roles` | Definición de permisos |
| PUT | `/roles/:id_rol` | Definición de permisos; revocación si cambia nombre |
| DELETE | `/roles/:id_rol` | Definición de permisos y revocación |

Todas estas siete requieren administración.

### Rutas que no deben confundirse con escritura de pozos

- `POST /usuarios/:id_usuario/pozos`: legacy deshabilitado, devuelve error; no crea registros.
- `POST P/perfil-litologico/vista-previa`: lectura/cálculo de borrador, no persiste; mantiene autenticación.
- Lecturas de pozo, intervalos, fotos, sitios, mapas, informes, catálogo y numeración: GET autenticados. La auditoría anterior verificó 72 rutas contra sesiones ya revocadas; la prueba PostgreSQL de esta intervención comprueba además las 37 escrituras pendientes con ambos mecanismos. No se cuentan los HEAD generados por Fastify.
- WebSocket `GET /ws`: cookie web o ticket nativo; solo notificaciones del servidor.
- Autenticación: `POST /login`, `GET /login`, `POST /logout`; `POST /auth/native/login`, `GET /auth/native/session`, `POST /auth/native/logout`, `POST /auth/native/logout-all`, `POST /auth/native/ws-ticket`. Modifican/consultan sesiones y tickets, no pozos. El logout native individual permite invalidar un token ya no operativo y no exige cuenta activa; no es una autorización para leer o escribir registros.
- `/health`, `/ready` y raíz no son operaciones sobre registros. No hay ruta activa de fotos públicas en el código revisado.

## Pruebas y verificaciones

Se usó PostgreSQL 18.4 en un clúster **temporal aislado**, escuchando solo en 127.0.0.1:55439. Cada prueba creó y eliminó su propia base; no se conectó al piloto, no se desplegó Docker ni se aplicaron migraciones fuera de bases desechables.

| Comprobación | Resultado |
| --- | --- |
| `api npm test` | 330 PASS; las dos pruebas de carrera web/Android que antes reproducían el defecto ahora exigen 401 y cero guardados. |
| `api npm run build` | PASS, TypeScript. |
| `escritura-sesion.postgres.local.ts` | 85 PASS: ambos órdenes de bloqueo en web/Android, 37 rutas × 2 mecanismos con sesión desactivada y fotografía/tablas inalteradas, reactivación sin revivir sesión, rollback y liberación de bloqueos, concurrencia administrativa y regla de 24 h. |
| `propietario-provisional.postgres.local.ts` | 8 PASS: provisionales, foto, hijos, permisos y compatibilidad histórica. |
| `numeracion-perforacion-postgres.local.ts` | PASS en escenarios fresh y pilot_equivalent: números, concurrencia, históricos, rollback y agotamiento. Se actualizaron dos expectativas del test para la migración 012 ya aprobada; no cambió la numeración. |
| Angular ChromeHeadless, specs de auth/interceptor/WebSocket | 60 PASS. |
| `npm run check:utf8` y `npm run verify:native-assets` | PASS. Branding: 2 originales, 26 derivados; 223 assets Capacitor idénticos. |
| `NATIVE_BACKEND_ORIGIN=https://api.raulsilvaperforaciones.com npm run check:native-release-readiness` | READY; queda el MANUAL_CHECK visual de branding antes de firmar. No se compiló ni firmó APK. |
| `git diff --check` | PASS (salida vacía, código 0). |

La prueba de 37 rutas usa el servidor Fastify y servicios reales, credenciales emitidas antes de la desactivación y PostgreSQL real. Pausa cada petición después de autenticar, confirma la desactivación mediante el endpoint administrativo y luego la reanuda: todas responden 401. La instantánea incluye pozos, sitios, cuatro familias técnicas, catálogo, numeración, roles, usuarios afectados y directorio de fotos. Las barreras adicionales dentro de PostgreSQL demuestran esperas reales en ambos sentidos. También se ejecutaron reactivación, transacción fallida, restauración de fotos y edición de pozo propio vigente/vencido/ajeno.

## Archivos afectados por esta corrección

- `api/src/plugins/jwt.ts` y `api/src/services/escritura-sesion.ts`: identidad HTTP y transacción protegida.
- Servicios de pozo: `pozos-services.ts`, `pozo-completo-service.ts`, `foto-pozo-service.ts`, `foto-archivo-service.ts`, `propietario-pozo-service.ts`, `candidatos-pozo-service.ts`, `numeracion-perforacion-service.ts`.
- Servicios técnicos: `intervalos-litologicos-services.ts`, `intervalo-diametro-services.ts`, `intervalos-filtro-service.ts`, `niveles-aporte-services.ts`, `sitios-service.ts`, `litologias-services.ts`.
- Servicios administrativos y sesión: `usuarios-service.ts`, `roles-services.ts`, `auth-services.ts`, `native-auth-service.ts`; ruta `api/src/routes/niveles-aporte.ts`.
- Pruebas: `api/test/sesion-desactivada-auditoria.test.ts`, `api/test/escritura-sesion.postgres.local.ts`, `api/test/foto-compensacion-r6.test.ts`, `api/test/numeracion-perforacion-postgres.local.ts`.
- Este informe; los cambios locales previos de la ventana de 24 horas y branding Android se conservaron. No se modificó `.env.pilot.local` ni se añadió migración.

## Dictamen de aprobación

**Sí, para las 37 operaciones HTTP autenticadas inventariadas queda garantizado que, una vez confirmado en PostgreSQL el COMMIT de desactivación administrativa, una sesión web o Android previamente emitida no puede confirmar una nueva escritura.** La garantía depende del bloqueo transaccional en la misma conexión que efectúa cada mutación y fue observada con PostgreSQL real en ambos órdenes de carrera. El límite WebSocket entre instancias concierne solo a notificaciones; el límite de filesystem ante caída total se indica arriba. El código queda listo para revisión final sin commit ni push.
