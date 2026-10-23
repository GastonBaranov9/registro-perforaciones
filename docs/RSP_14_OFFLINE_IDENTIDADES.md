# RSP 14 — trabajo local, sincronización y administración de identidades

Fecha: 2026-10-05. Implementación en el árbol de trabajo, sin commit, push ni despliegue.

Revisión dirigida posterior: [RSP_14_REVISION_FINAL.md](RSP_14_REVISION_FINAL.md). Ese informe actualiza la protección del último administrador, política compartida de contraseñas/login, recuperación de rechazos offline mediante la migración 015 y los resultados finales de pruebas. Los conteos de este documento corresponden a la implementación inicial.

## 1. Punto de partida

- HEAD inicial: `4997988df0c5d0ef5797cf165cd242785f3c7185`.
- Mensaje: `feat(pilot): simplify provisional owners and improve admin management`.
- `git status --short` inicial: vacío.
- Rama conservada: `feature/rsp-10-pilot-apk`.
- No se leyó ni modificó `.env.pilot.local`. No se ejecutó `api/db/tests/013_bellagamba_cleanup.sql`.

## 2. Arquitectura encontrada

Angular 20.3/Ionic con servicios HTTP, guards y componentes compartidos. Web con cookies y CSRF; Capacitor 8 con tokens opacos nativos en secure storage, binding de instalación y marcador durable de logout. API Fastify 5/TypeBox, PostgreSQL 16 y archivos privados para las fotografías. WebSocket nativo usa tickets y revalidación de sesión.

`usuario` representa tanto personas sin credenciales como cuentas. `cuenta_acceso`, `activo`, `version_sesion` y `usuario_rol` distinguen identidad, autorización y acceso. El nombre provisional se guarda en `pozo.propietario_provisional`, sin crear un usuario. Ya existían creación de propietarios reales sin contraseña, datos de contacto, búsqueda/paginación y vinculación administrativa explícita.

La creación completa de pozo usa una transacción para sitio, pozo y datos técnicos, junto con staging y compensación de fotografía. Las escrituras usan `iniciarEscrituraSesion`, locks de sesión y una puerta de administración compartida/exclusiva. La migración 011 asigna números mediante un trigger con reserva permanente. La regla de 24 horas usa fecha de creación y reloj del servidor. La migración 013 agrega índices de búsqueda.

Faltaban persistencia y cola local, idempotencia de creación, conversión de identidad existente a cuenta y una acción administrativa visible de eliminación segura. El DELETE anterior intentaba borrar directamente la fila de usuario; las FK empresariales existentes generalmente lo impedían, pero no definía una UX adecuada para conservar historial.

## 3. Diseño offline implementado

Ruta nativa `/trabajo-local`, accesible al perforador autenticado previamente. Reutiliza el formulario de pozo, datos técnicos, cámara y geolocalización. Permite guardar datos incompletos, abrir y editar borradores no enviados, consultar estados y reintentar. Inicio y menú Perforaciones ofrecen acceso; Crear pozo redirige allí al perforador nativo sin rol administrador. La web conserva su flujo de creación existente.

El acceso local no declara una sesión validada por el servidor. Los guards y el interceptor HTTP originales siguen bloqueando operaciones remotas cuando la sesión está `offline-unverified`. Una ruta específica permite exclusivamente el espacio local.

## 4. Almacenamiento local

Capacitor Filesystem, `Directory.Data`, bajo `offline-v1/<SHA-256 del origen backend>/<id_usuario>/<UUID local>/`. No usa directorio de caché ni Preferences para fotografías o borradores. El UUID v4 se genera una vez por registro.

Metadatos JSON en revisiones inmutables: escribir temporal, renombrar a una revisión nueva, conservar revisión actual y anterior. No se sobrescribe la última revisión confirmada. El servicio serializa escrituras y sincronización; una escritura fallida no convierte una operación en guardada. Una revisión corrupta produce error y conserva los archivos; no se descarta silenciosamente.

Las fotografías son archivos binarios separados. Base64 sólo se utiliza como transporte hacia el plugin y hacia la API existente. La referencia a la foto se incorpora después de escribirla. Las coordenadas obtenidas por el componente existente se guardan en los datos del sitio. La disponibilidad del GPS depende del dispositivo; un borrador incompleto puede guardarse igualmente.

Secure storage conserva el perfil mínimo validado junto al token y binding de instalación, sin password. El origen del backend y usuario separan los espacios. Se excluye `offline-v1/` de backup/transferencia Android, igual que las credenciales ya excluidas. Un cambio de cuenta no abre ni envía borradores del usuario anterior.

Se eligió Filesystem porque ya está instalado y el agregado actual se guarda como un documento con una fotografía por pozo. Las revisiones evitan introducir una base SQL nativa y migraciones de plugins para este volumen de operaciones. El catálogo de litologías se conserva en disco al consultarlo con conexión y se precarga desde Inicio para el perforador nativo.

## 5. Cola y sincronización

Estados: pendiente, sincronizando, sincronizado, error y conflicto. La pantalla indica cantidad pendiente, resultado y mensajes de cada registro. Hay reintento manual, evento de reconexión y reanudación al abrir la pantalla con sesión validada. No se promete ejecución en segundo plano mientras Android mantiene cerrada la aplicación.

Antes de enviar, se revalida la sesión y el rol contra el servidor. Los datos incompletos quedan locales. Antes del HTTP se persiste `enviado=true`; tras interrupción se reenvía con el mismo UUID. Dos acciones simultáneas comparten la misma promesa y cola. La respuesta debe incluir ID y número empresarial antes de marcar sincronizado. No se borran borrador ni foto al confirmar.

Una vez iniciado el primer envío, el contenido se congela hasta resolver su recepción. Un resultado incierto mantiene clave y payload. La revisión final agrega un cierre transaccional del servidor: sólo después de confirmar que la clave anterior nunca podrá crear un pozo se habilita editar el mismo borrador local con una nueva clave de operación. Un 4xx aislado nunca habilita ese cambio. El trabajo local abierto debe guardarse antes de sincronizar.

## 6. Idempotencia

El POST completo acepta `Idempotency-Key` UUID v4. La clave primaria de `creacion_offline` es `(actor, clave)`, con huella SHA-256 de JSON canónico y recibo completo de creación sin los bytes de la foto. Se toma un advisory lock transaccional por actor/UUID después de bloquear/revalidar sesión. La consulta de recibos ocurre antes de insertar sitio o pozo. Payload diferente con la misma clave produce conflicto comprensible.

El recibo se inserta en la misma transacción que el pozo y su número. Si falla, no queda recibo confirmado. Si la respuesta se pierde, el reintento devuelve el mismo recibo. La PK aporta una segunda protección. También los replay requieren una sesión y rol vigentes.

Retención: una fila por creación confirmada, ninguna por intento o error. No hay TTL que permita recrear un pozo desde un teléfono atrasado. El almacenamiento crece con creaciones empresariales, no con reintentos; los recibos no contienen fotografías. Su eliminación futura necesitaría conservar como mínimo una reserva permanente de la clave. La FK del actor impide eliminar una identidad necesaria para esta auditoría.

## 7. Fotografías

Se mantiene el modelo actual: una fotografía JPEG/PNG por pozo, hasta 5 MB. Cada borrador tiene su propia referencia persistente. Pozo, fotografía y recibo se envían juntos usando la creación completa existente; no hay una segunda cola que pueda asociar una foto al pozo incorrecto.

Si COMMIT arroja error después de haberse intentado, no se elimina el archivo: una respuesta perdida no prueba rollback. El reconciliador existente permite auditar archivos huérfanos; no se ejecutó ninguna limpieza. Las fotos locales siguen conservadas después del éxito. Los archivos de fotos reemplazadas y temporales interrumpidos pueden requerir una futura herramienta explícita de gestión de espacio; no se purgan datos locales automáticamente.

## 8. Numeración comercial

El cliente no genera, reserva ni calcula número. El repositorio rechaza borradores numerados, la cola omite el campo y el servidor rechaza números enviados en operaciones con clave offline. Sólo el trigger global existente asigna número; la idempotencia evita ejecutar una segunda inserción.

No se conectó la implementación al piloto ni se modificaron `proximo=NULL`, `mayor_asignado=3001` o la reserva 3001. Con `proximo=NULL`, la creación remota seguirá siendo rechazada y el borrador permanecerá local: este cambio no decide el próximo número real.

La suite PostgreSQL creó bases nuevas en el contenedor aislado `rsp-014-offline-lab`, usuario de pruebas `rsp14_test`, PostgreSQL 16, puerto loopback 60411. Sólo allí configuró numeración ficticia desde 8000.

## 9. Sesiones vencidas, revocadas y cambios de cuenta

Se conserva la validación autoritativa y los locks de sesión/versionado existentes. El servidor rechaza sesiones vencidas, revocadas, cuentas desactivadas y pérdida de rol, incluso cuando el UUID ya tiene recibo. No se guardan passwords ni se valida una contraseña localmente.

Un 401 exige volver a iniciar sesión. Los archivos sobreviven, aunque el espacio privado quede bloqueado hasta autenticar nuevamente al mismo usuario. Una identidad eliminada o sin acceso no puede sincronizar con sus antiguas credenciales. Una eventual recuperación administrativa de archivos de una cuenta definitivamente revocada necesita un procedimiento explícito; no se habilitó acceso cruzado entre cuentas.

## 10. Regla de 24 horas

Borradores locales no enviados pueden editarse sin usar la hora del teléfono como autorización. La creación real conserva `fecha_creado` del servidor y desde ella aplica la ventana existente. No se implementa cola de modificaciones de pozos ya sincronizados: se editan en línea, con validación backend de las 24 horas y controles existentes de propietario. Esta es la variación conservadora para evitar sobrescrituras y evasión de la ventana. Un payload con hora del teléfono no autoriza nada.

## 11. Provisional a propietario real

Se conserva y aprovecha el componente administrativo existente en Editar perforación: muestra el provisional, busca personas y permite crear una identidad con todos los datos de contacto existentes. El administrador selecciona un ID y confirma su vinculación. No hay unión por nombre. La operación verifica el propietario esperado y rechaza si otro cliente ya lo cambió.

La migración agrega `propietario_provisional_original`; un trigger conserva el primer texto provisional, incluso después de vincular la identidad real. No altera la referencia de propietario ni datos técnicos de los pozos existentes.

## 12. Propietario real a cuenta con acceso

En Usuarios y propietarios, una identidad sin acceso ofrece “Crear acceso al sistema”: email de login, contraseña inicial y confirmación. El backend comprueba coincidencia, límite de bcrypt en bytes, inexistencia de acceso previo y unicidad de email. Hashea con el mecanismo existente, activa acceso y agrega rol Propietario dentro de una transacción. No cambia el ID ni las asociaciones de pozos, ni el email de contacto.

Después, “Administrar acceso” permite modificar contraseña y permisos mediante el flujo existente con revocación de sesiones. La ficha del propietario también muestra si tiene credenciales, su estado de acceso y las acciones de creación o gestión de contraseña/roles. La UI distingue datos personales y cuenta/permisos. Las respuestas nuevas no contienen passwords ni hashes; la confirmación también está cubierta por redacción de logs.

## 13. Roles

Se mantiene el catálogo y la selección múltiple existentes. Crear acceso asigna Propietario por su nombre de rol; no acepta IDs de roles sensibles en ese endpoint. Las mutaciones son administrativas en backend. No se modifica la precedencia de administrador ni las reglas de consulta: el propietario recibe exclusivamente pozos asociados a su ID, incluso si intenta alterar el ID de la URL del listado.

## 14. Eliminar usuario

“Eliminar acceso”, sólo para admin y con confirmación explícita, desactiva la cuenta, pone `cuenta_acceso=false`, quita email/password de login, incrementa versión de sesión, revoca sesiones nativas y cierra conexiones. Conserva identidad, rol de propietario si existe, datos de contacto y todas las relaciones empresariales. Quita los restantes roles de acceso.

Para una identidad sin acceso existe otra acción confirmada: “Eliminar identidad sin historial”. El backend bloquea la fila, inspecciona todas las FK directas a usuario y rechaza si encuentra dependencias empresariales. Sólo ignora asociaciones de roles y sesiones nativas como registros descartables de cuenta. Las FK y la transacción protegen frente a nuevas referencias concurrentes. Una identidad con historial no se elimina. Ninguna de estas operaciones se encola offline.

## 15. Migración

Nueva `api/db/migrations/014_offline_identidad.sql`: tabla de recibos, PK/FK, columna de provisional original y trigger de conservación. Normal, incremental, ejecutada únicamente con el migrador oficial en bases aisladas. Segunda ejecución del migrador: cero migraciones aplicadas. No se editaron 000–013.

## 16. Endpoints

- Modificado `POST /usuarios/:id_usuario/pozos/completo`: clave de idempotencia opcional; clientes web anteriores siguen funcionando.
- Nuevo `POST /usuarios/personas/:id_usuario/acceso`: crear credenciales y otorgar Propietario; respuesta 204.
- Modificado `DELETE /usuarios/:id_usuario`: revocar/eliminar acceso conservando identidad; respuesta 204.
- Nuevo `DELETE /usuarios/personas/:id_usuario`: borrar sólo una identidad sin acceso y sin dependencias empresariales; respuesta 204.
- GET/PUT de propietario operativo exponen los flags públicos opcionales `cuenta_acceso` y `activo` para la ficha administrativa, sin credenciales.
- Se mantienen búsqueda/paginación, CRUD de propietarios, vinculación, roles, login, tickets y sesiones existentes.

## 17. Archivos principales

API: migración 014; `acceso-persona-service.ts`; `usuarios-service.ts`; `pozo-completo-service.ts`; rutas `usuarios.ts` y `pozos.ts`; CORS y redacción de logs.

Frontend: `offline-repository.ts`, `offline.service.ts`, `offline.guard.ts`, `routes/offline/offline.page.ts`; secure storage y AuthService; caché de litologías; acceso desde Inicio/Perforaciones; pantalla Usuarios y componente `acceso-persona.component.ts`; formulario compartido y recuperación de IDs locales de intervalos técnicos. Android: sólo exclusiones de backup para el directorio local.

## 18. Pruebas agregadas

`api/test/offline-identidad.postgres.local.ts`: migración y repetición oficial, numeración sin configurar, concurrencia de reintentos, respuesta perdida, payload conflictivo, numeración forjada, fallo de fotografía, error 500 transaccional, formalización, homónimos, cuenta sin password, alta de acceso, login duplicado, aislamiento del propietario, permisos, 24 h, sesión nativa revocada, múltiples instalaciones, expiración, pérdida de rol, eliminación y supervivencia de datos.

`front/src/app/core/native/offline.spec.ts`: persistencia con reinicio del repositorio, foto separada, escritura interrumpida, rutas/usuarios/números forjados, edición sin red, sincronización y single flight, reintento después de 500, revocación, conflicto, aislamiento y reanudación de estado sincronizando. El Filesystem está simulado: la prueba física se enumera aparte.

Ampliada la prueba administrativa de Usuarios: botón sólo admin, confirmación cancelada y confirmada, y explicación de conservación. Actualizados contratos existentes de sesión segura y eliminación de cuenta para la nueva semántica.

## 19. Resultado de suites ejecutadas

| Comando / ubicación | Resultado final |
| --- | --- |
| `npm test` en API | 330 pass, 0 fail, 0 skip |
| `node --experimental-strip-types --test test/offline-identidad.postgres.local.ts` con puerto aislado | 14 pass, 0 fail, 0 skip |
| `npm test -- --watch=false --browsers=ChromeHeadless` en front | 416 SUCCESS, 0 fallos |
| `npm run test:config` en front | 47 pass, 0 fail, 0 skip |
| Suite incluida en `check:native-release-readiness` | 46 pass, 0 fail, 0 skip |
| `npm run check:utf8` | Correcto |

Corridas intermedias: API pasó también las 330 pruebas antes de cerrar cambios. Angular primero tuvo 27 fallos por expectativas del nuevo perfil seguro y precarga de catálogo desde login; se retiró esa precarga del servicio de login, se pasó a Inicio y se ajustaron las expectativas del perfil, manteniendo los checks de token/binding. Después pasó 412 y finalmente 415. PostgreSQL tuvo inicialmente 9 pass/4 fail por tres expectativas incorrectas del harness (nombre de migración, semántica del listado e ID de sitio omitido); corregidas, pasó 13 y luego 14 con el caso 500 adicional. Configuración primero tuvo 44 pass/3 fail en probes Gradle dentro del sandbox; fuera del sandbox pasó 47. Hubo intentos de compilación/pruebas bloqueados por permisos de lectura y dos errores de tipos iniciales, todos corregidos/reintentados.

No se ejecutaron todos los scripts históricos `*.local.ts` ni scripts operativos de despliegue/upgrade contra bases existentes. Los logs de estas corridas están en el directorio temporal del usuario con prefijo `rsp14-`.

## 20. Builds

- API `npm run build`: exit 0.
- Web `npm run build:production`: exit 0.
- Native `npm run build:native:production`: exit 0, contrato CSS nativo validado.
- Origen de build: `https://api.raulsilvaperforaciones.com`, tomado de los assets Android existentes. Configurado sólo en el entorno del proceso mediante `NATIVE_BACKEND_ORIGIN`.
- `npx cap sync android`: exit 0; mantiene los siete plugins existentes.
- Warning de Stencil `empty-glob` durante build; no bloquea compilación.
- No se construyó ni firmó una APK, ni se instaló/desinstaló la aplicación.

## 21. Assets nativos

`npm run verify:native-assets`: exit 0. 231 archivos idénticos por SHA-256; branding validado con 2 originales y 26 derivados.

## 22. Preparación nativa

`npm run check:native-release-readiness`: exit 0, READY. Origen HTTPS, identidad, nombre, versión, debuggable=false y contrato de firma correctos. La inspección de firma usa sentinels sintéticos, sin solicitar ni imprimir secretos.

Conservados: `uy.com.raulsilva.perforaciones`, `Raul Silva Perforaciones`, versionCode 1, versionName 1.0 y minSdk 24. No se modificó configuración privada de firma ni certificado.

## 23. MANUAL_CHECK

- En Android con una build de prueba y backend aislado migrado: login previo, catálogo descargado, modo avión, creación con foto/GPS, guardar, cierre forzado, reapertura y edición del borrador.
- Reconectar, interrumpir durante upload y reabrir; comprobar una única perforación/número/foto en el backend aislado.
- Revocar sesión/cuenta desde otro cliente mientras el teléfono está offline: rechazar upload y conservar archivos; volver a iniciar sesión con la misma identidad cuando corresponda.
- Cambio de cuenta: no mostrar datos de la anterior. Comprobar también disco lleno y permisos de cámara/ubicación denegados.
- Revisión visual de formulario, confirmaciones y accesibilidad móvil.
- `MANUAL_CHECK` del preflight: confirmar icono y splash definitivos.

No se declara probado el comportamiento físico del plugin Filesystem/cámara/GPS por ejecutar pruebas con dobles en Chrome. Una consulta ADB dentro del sandbox falló por permisos; no se interactuó con datos de la aplicación.

## 24. Decisiones y límites

- El modo offline comprende creación y edición de borradores locales; los pozos sincronizados se modifican en línea. Esto evita conflictos por cambios remotos o formalización y conserva la validación de 24 horas.
- Los borradores enviados se congelan hasta resolver el recibo; un conflicto no se soluciona creando automáticamente otra perforación.
- El modelo existente no impone unicidad de documento/RUT. Se conserva esa compatibilidad; la búsqueda ayuda a confirmar identidad, sin fusionar por documento ni nombre. Email de login sí es único y devuelve error comprensible.
- Se conserva una fotografía por pozo, conforme al modelo actual. No se agregó soporte de álbumes múltiples.
- Se guardan los datos al pulsar Guardar; el intento al salir de la pantalla es adicional. Un cierre abrupto antes del primer guardado no equivale a un borrador confirmado.
- Los recibos son permanentes y las fotos locales no se purgan automáticamente. La futura gestión de espacio debe ser explícita y preservar archivos pendientes.
- Para habilitar offline por primera vez después de actualizar, debe existir una validación online que guarde el perfil seguro. Sin catálogo previo, se puede guardar un borrador incompleto y completar litologías al recuperar conexión.
- La migración no está aplicada al piloto. Su instalación y cualquier próximo número empresarial quedan fuera de esta ejecución.
- El contenedor/base de laboratorio se conservaron para inspección. No se limpiaron otros contenedores ni datos.

## 25. Git diff

`git diff --check`: exit 0, sin errores de whitespace. Git muestra advertencias de conversión LF/CRLF por configuración del entorno, no errores de diff.

## 26. Estado final

HEAD y rama permanecen en el punto inicial. Cambios sin commit, archivos nuevos de migración/servicios/UI/tests y este informe. El listado exacto final se adjunta a continuación tras la verificación final.

## 27. Propuesta de commit

`feat(offline): persist native drafts and sync idempotently; manage owner access safely`
