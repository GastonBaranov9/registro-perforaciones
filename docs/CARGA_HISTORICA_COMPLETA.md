# Carga histórica completa: informe previo a commit y despliegue

Fecha: 2026-10-07. Base: `ef074e4b857bbff4676953d24caeeb680063273a`.

Implementación local terminada y validada. Sin commit, push ni despliegue. No se ejecutaron resets ni se modificaron migraciones 000..017. La continuación de la tarea conservó los cambios y no repitió las suites ni los builds ya aprobados.

## Comparación funcional

| Aspecto | Crear normal | Nueva perforación histórica |
|---|---|---|
| Número | Automático; no acepta número manual, tampoco de Administración | Obligatorio, entero manual 1..3281 |
| Próximo automático | Lo asigna y avanza | No lo modifica |
| Origen | Normal | Histórico, fijado por el servidor |
| Permisos | Administración/perforador según permisos existentes | Sólo Administración; otros roles reciben 403 |
| Información | Formulario y secciones técnicas existentes | Mismos componentes y secciones; permite omitir información desconocida |
| Persistencia | Alta completa transaccional | Alta completa, reserva atómica e idempotencia histórica |
| Fotografía | Una JPEG/PNG | Una JPEG/PNG; edición permite conservar, reemplazar o eliminar |
| Edición | Flujo normal existente | Acción administrativa «Editar perforación histórica» en el detalle |
| Identidad al editar | Protegida | Número, origen, ID interno y reserva no se pueden cambiar |

La pantalla histórica anterior era reducida. El servicio de alta ya admitía numerosos datos opcionales y estructuras técnicas; faltaban su exposición completa en la interfaz, fotografía y edición histórica integral.

## Reutilización y separación

- `PozosFormComponent`: formulario compartido de identificación, personas, sitio, datos generales, fotografía y textos constructivos. El modo histórico adapta obligatoriedad y numeración; el modo normal conserva su numeración automática.
- `DatosTecnicosBorradorComponent`: las mismas secciones de litología, diámetros, filtros y aportes, con sus validaciones y catálogos.
- Servicios existentes de candidatos, propietarios y lectura de estructuras técnicas; conversión de fotografía compartida con el alta normal.
- `tecnicosPersistidos`: adaptación común de estructuras ya guardadas para edición normal e histórica, incluyendo referencias a litologías y ranuras legadas.
- `reemplazarHijosPozo`: lógica del servicio normal extraída y compartida para validar y guardar estructuras técnicas.
- Ruta y API históricas separadas. El endpoint completo normal rechaza editar una perforación histórica y los permisos impiden a un no administrador editarla por ser su creador.

La página histórica maneja creación y edición. Después de guardar navega al detalle; éste ofrece la edición administrativa y la lista general identifica el origen histórico.

## Campos disponibles

| Sección | Datos |
|---|---|
| Identificación | Número histórico P- manual al crear, sólo lectura al editar |
| Personas | Propietario registrado o nombre provisional; perforador; empresa |
| Sitio | Departamento, localidad, padrón, latitud, longitud |
| Fechas | Inicio y finalización |
| Medidas | Profundidad final (m), nivel estático (m), nivel dinámico (m), caudal estimado (l/h) |
| Construcción | Método sedimentario, método rocoso, cementación, desarrollo, revestimiento textual existente en el modelo |
| Litología | Desde/hasta, material y referencia al catálogo de litologías |
| Diámetros | Desde/hasta, diámetro en pulgadas, material de tubería |
| Filtros | Desde/hasta, diámetro en pulgadas, material de tubería, ranura en mm |
| Aportes de agua | Profundidad de cada aporte, tal como admite el modelo actual |
| Fotografía | JPEG/PNG, máximo 5.000.000 bytes; conservar, sustituir o eliminar al editar |

Los datos desconocidos quedan ausentes/nulos; no se inventan fechas, profundidades, personas ni coordenadas. Se conservan las validaciones de consistencia para datos conocidos: fechas válidas y ordenadas, intervalos coherentes, referencias válidas y relación con la profundidad cuando está informada.

### Límites del modelo y flujo existente

- El alta normal no ofrece carga de documentos/adjuntos arbitrarios. Esta entrega tampoco agrega ese subsistema. La fotografía y los PDF generados existentes continúan disponibles.
- Los aportes almacenan profundidad; no se inventan caudales individuales ni otros atributos inexistentes.
- Un sitio informado exige departamento. Las coordenadas se cargan como par válido. Puede omitirse completamente el sitio al crear un histórico; un sitio existente conserva su departamento obligatorio.
- Un sitio compartido por varias perforaciones debe editarse desde Sitios. El servicio rechaza modificarlo desde esta edición para no alterar silenciosamente otras perforaciones. El formulario histórico envía el sitio informado, por lo que esa situación requiere resolver la edición del sitio por su flujo específico.
- Los campos legados `sello_sanitario` y `pre_filtro` no forman parte del formulario normal vigente y no se reintrodujeron.
- La UI es para uso conectado: conserva una solicitud histórica pendiente para reintentar, pero no incorpora altas históricas a la cola de altas normales offline.

## Endpoints y garantías

Rutas internas de la API; el proxy público agrega `/api`:

- `POST /pozos/historicos`: Administración, número manual, datos opcionales completos y foto. Conserva `Idempotency-Key` y `X-Epoca-Datos`, reserva atómica y rechazo de duplicados/reservados.
- `PATCH /pozos/historicos/:id_pozo`: Administración, edición transaccional de campos mutables, sitio, estructuras y fotografía. No acepta número, origen, ID ni reserva en el cuerpo, ni siquiera con sus valores actuales. Sólo edita registros históricos.
- `POST /usuarios/:id_usuario/pozos/completo`: alta normal existente; número exclusivamente automático.
- `PUT /usuarios/:id_usuario/pozos/:id_pozo/completo`: edición completa normal; remite los históricos a su ruta específica.

Rutas de interfaz:

- `/pozos-historicos`: nueva perforación histórica.
- `/pozos-historicos/:id_pozo/editar`: edición administrativa histórica.

Las escrituras verifican sesión y rol dentro de la transacción. La edición bloquea el registro y no escribe la numeración ni las reservas. En PATCH, omitir una colección conserva sus datos; el formulario envía las colecciones completas y aplica la misma estrategia de reemplazo técnico del flujo normal. Las identidades de filas hijas pueden regenerarse cuando se reemplazan colecciones; el ID de perforación y su reserva permanecen intactos.

La fotografía participa mediante staging y compensación del sistema de archivos ante rollback confirmado. Si el resultado de COMMIT es incierto, se evita borrar una foto que pudiera haber quedado confirmada. Los reintentos de creación conservan UUID, época y payload; la foto pendiente se guarda en IndexedDB para no agotar sessionStorage con base64.

## Pruebas y validación

Resultados completados antes del cierre, sin repetir ejecuciones exitosas:

| Validación | Resultado |
|---|---|
| Suite API `npm test` | 344/344 aprobadas |
| PostgreSQL aislado: históricos + época | 12/12 aprobadas |
| Suite frontend Angular | 486/486 aprobadas |
| Build API | Correcto |
| Build frontend de producción | Correcto |
| Comprobación UTF-8 de interfaz | Correcta |
| `git diff --check` | Código 0, sin errores; avisos de normalización LF/CRLF |
| Diff de migraciones y scripts/servicio de reset | Sin cambios |

Cobertura relevante: alta histórica completa con hijos y foto; alta parcial; completar una P-3281 de fixture sin recrearla; carga 3280 después de 3281 manteniendo próximo 3282; rechazo de números inmutables y origen; conservación de reserva; roles y sesión revocada; duplicados y números ya reservados; concurrencia e idempotencia; no duplicación de hijos; fotos conservadas/reemplazadas/eliminadas; rollback de foto y datos por fallo posterior a escritura; referencias técnicas inválidas; reintento después de recargar la interfaz; alta normal automática 3282 exclusivamente en fixture.

PostgreSQL se ejecutó en `rsp-historicos-completos-test`, con etiqueta `rsp.purpose=isolated-historical-tests`, almacenamiento tmpfs y bases independientes. El contenedor se detuvo al finalizar. Ninguna prueba utilizó P-3281 real ni consumió numeración del piloto.

Incidencias de validación resueltas: ajuste de un mock a la consulta de origen y corrección del orden de validación de hijos para mantener el rechazo antes de modificar datos. El build de producción inicialmente no resolvió dependencias bajo el sandbox; terminó correctamente al ejecutarse con autorización fuera de él. Persisten avisos no bloqueantes de Stencil/Ionicons en build/tests.

## P-3281 real y numeración

Verificación final mediante `BEGIN READ ONLY` y exclusivamente SELECT:

| Dato real | Valor |
|---|---|
| P-3281 | `id_pozo=18`, `origen=historico` |
| Reserva existente | `numero_perforacion=3281`, `id_pozo_original=18` |
| Próximo | **3282** |
| Mayor asignado | 3281 |
| Perforaciones con número 3282 | **0** |

No se modificó P-3281 real. El nuevo código admite completar un histórico parcial existente sin recreación ni cambio de número, origen o reserva; fue comprobado con una P-3281 independiente de fixture. Su disponibilidad en el piloto requiere un despliegue posterior, que no se realizó.

## Archivos modificados y estado Git

`git status --short`: 23 archivos versionados modificados y 7 nuevos sin seguimiento, incluyendo este informe. Ningún cambio preparado mediante git add; sin commits nuevos. HEAD continúa en `ef074e4b857bbff4676953d24caeeb680063273a`.

```text
 M api/src/models/historicos.ts
 M api/src/routes/historicos.ts
 M api/src/services/edicion-pozo.ts
 M api/src/services/historicos-service.ts
 M api/src/services/pozo-completo-service.ts
 M api/test/edicion-pozo.test.ts
 M api/test/historicos.postgres.local.ts
 M api/test/historicos.test.ts
 M api/test/rsp06c.test.ts
 M front/src/app/app.routes.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts
 M front/src/app/routes/pozos/pages/historicos/historicos.page.spec.ts
 M front/src/app/routes/pozos/pages/historicos/historicos.page.ts
 M front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.spec.ts
 M front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts
 M front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html
 M front/src/app/shared/services/edicion-pozo.service.ts
 M front/src/app/shared/services/pozos-create.service.ts
 M front/src/app/shared/types/schemas.ts
?? api/src/services/foto-historico-transaccion.ts
?? docs/CARGA_HISTORICA_COMPLETA.md
?? front/src/app/routes/pozos/pages/historicos/historicos.page.html
?? front/src/app/shared/services/historico-foto-pendiente.ts
?? front/src/app/shared/utils/historicos-form.spec.ts
?? front/src/app/shared/utils/historicos-form.ts
?? front/src/app/shared/utils/tecnicos-persistidos.ts
```
