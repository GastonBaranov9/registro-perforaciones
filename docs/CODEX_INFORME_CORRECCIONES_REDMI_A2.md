# Correcciones para la próxima APK — Redmi A2

Fecha: 2026-10-02. Base: `1b58c29bfcbfc0d5c9055d9fa20509a08d67793e`, rama `feature/rsp-10-pilot-apk`.

## Resultado

Se implementaron las dos correcciones en API y frontend. No se creó ningún commit ni se realizó push. No se modificó `.env.pilot.local`, no se ejecutaron migraciones en el piloto, no se desplegaron contenedores y no se firmó ni instaló una APK. Las únicas consultas al piloto fueron `SELECT` dentro de transacciones `READ ONLY` usando su contenedor PostgreSQL existente.

Los cambios se prepararon y probaron en una copia temporal del commit indicado, reutilizando las dependencias instaladas. La aplicación al repositorio requiere permiso del entorno porque API, frontend y documentación están fuera de la raíz de escritura `front/android`.

## Inspección y decisiones

### Intervalos

El componente compartido `DatosTecnicosBorradorComponent` ya incorporaba litologías al final, con foco y desplazamiento posterior al renderizado. Los otros botones estaban arriba y `actualizar()` ordenaba los grupos por profundidad en cada edición. Un aporte nuevo de profundidad 0 podía saltar al principio.

Ahora los cuatro grupos conservan el orden de incorporación durante la edición. La carga inicial sigue ordenando los registros existentes; las validaciones y la vista previa mantienen sus mecanismos de ordenamiento independiente. Ningún valor técnico se modifica para conseguir el orden visual.

Los botones quedan al pie de cada grupo, con un área táctil de al menos 48 px. Tras renderizar la nueva fila se enfoca su primer campo habilitado con `preventScroll` y se desplaza hacia ella. `prefers-reduced-motion: reduce` utiliza desplazamiento sin animación. Los IDs locales siguen identificando cada fila y no se recrean las anteriores al agregar.

### Propietarios

La migración 004 permitía registros de `usuario` sin email/password y con `cuenta_acceso=false`. El endpoint `POST /pozos/propietarios` estaba disponible para perforadores y creaba esos registros. No eran credenciales de acceso, pero sí identidades globales, seleccionables en búsquedas posteriores. La FK de `pozo.id_propietario` exigía siempre un usuario existente.

La migración incremental **012_propietario_provisional.sql**:

- Permite `NULL` en `pozo.id_propietario`, conservando su FK a `usuario`.
- Añade `pozo.propietario_provisional`, de hasta 160 caracteres.
- Exige mediante `CHECK` exactamente una representación: ID real con provisional nulo, o ID nulo con nombre provisional no vacío.
- No modifica migraciones 000–011, usuarios históricos, IDs, secuencias, números empresariales ni relaciones existentes.

El backend normaliza y valida esta alternativa. Crear un provisional no inserta en `usuario` ni `usuario_rol`. El estado pendiente se deriva de `id_propietario IS NULL`, evitando un segundo indicador que pueda quedar desincronizado. No se intenta convertir automáticamente los registros operativos antiguos en provisionales.

El frontend permite seleccionar un propietario existente con las restricciones actuales o escribir el nombre provisional. Muestra “Pendiente de vinculación” en formulario, detalle y listado; los informes identifican también esa condición. Las consultas de detalle e informe utilizan `LEFT JOIN` para conservar pozos sin cuenta vinculada. Los IDs `BIGINT` históricos se normalizan antes de serializar el contrato nullable.

La creación y edición global de propietarios quedan restringidas a administración. El registro administrativo puede seguir sin credenciales; habilitar acceso continúa siendo una operación de administración de usuarios.

### Vinculación y conservación

Administración dispone de una sección específica en la edición del pozo para buscar un propietario real o crearlo y seleccionarlo. La creación de identidad y la vinculación son dos acciones explícitas: si falla la segunda, se conserva la identidad seleccionada para reintentar sin crear otra.

`PUT /pozos/:id_pozo/propietario` recibe:

```json
{"id_propietario": 7, "id_propietario_esperado": null}
```

Exige administración en ruta y servicio, valida propietario activo y rol, bloquea el pozo en transacción y compara el propietario previo esperado. Modifica **solo** `id_propietario` y `propietario_provisional`. No toca sitio, número, hijos técnicos, fotografía ni sus IDs. Permite también corregir una vinculación histórica indicando su ID previo esperado.

La edición general, completa o legacy, no puede cambiar la identidad del propietario: debe utilizarse la operación administrativa. Un formulario desactualizado tampoco puede devolver a provisional un pozo ya vinculado. La pantalla aplica el resultado sin recargar el borrador ni descartar fotografías pendientes; bloquea envíos y recargas durante la vinculación.

Los permisos siguen comparando la identidad autenticada con la FK real del pozo, nunca con un nombre. Un provisional no recibe notificaciones destinadas a una cuenta. Las rutas protegidas de foto y exportación admiten el ID del perforador como prefijo cuando falta propietario; la autorización sigue resolviéndose por sesión y relación con el pozo, no por ese prefijo. Se verificó que los enlaces de fotos anteriores siguen funcionando para los usuarios autorizados después de vincular.

## Marcelo Bellagamba: diagnóstico confirmado

Consulta de solo lectura al piloto del 2026-10-02:

| ID usuario | Cuenta de acceso | Activo | Pozos como propietario | Identificación adicional disponible |
|---|---|---|---|---|
| 4 | No | Sí | Pozo ID 4, número 3001 | Sin documento ni teléfono |
| 5 | No | Sí | Ninguno | Sin documento ni teléfono |
| 7 | Sí | Sí | Pozo ID 2, sin número empresarial | Email de acceso; sin documento ni teléfono |

Los tres tienen rol propietario. El agrupamiento por nombre normalizado encontró este único grupo repetido en la base consultada. Las tarjetas representaban tres filas distintas; la consulta original ya tenía restricciones de unicidad en roles que impedían multiplicar la misma identidad en este caso. El alta operativa reiterada y la falta de datos diferenciadores explican el problema observado. El nombre compartido no demuestra que sean la misma persona.

El buscador ahora usa `EXISTS` para filtrar roles sin multiplicar filas. El componente elimina repeticiones por **ID**, nunca por nombre, y muestra registro, documento, teléfono, localidad y email de contacto disponibles. No se expone el email de acceso del propietario como sustituto del email de contacto.

### Procedimiento seguro de conciliación — no ejecutado

1. Administración confirma documentalmente si los IDs 4, 5 y 7 corresponden a la misma persona. Reunir identificación/contacto y conservar una exportación de los registros antes de cambiar nada. El ID 7 es un candidato a identidad canónica por disponer de acceso, no una elección automática.
2. Ejecutar `api/db/tests/012_propietarios_auditoria.sql` en modo de solo lectura. Inventariar las FK reales y todas las referencias, no solo pozos: `pozo.id_propietario`, `id_perforador`, `creado_por`, `documento.generado_por`, `informe.generado_por`, `numeracion_perforacion_configuracion.cambiado_por`, `sesion_nativa.id_usuario` y `usuario_rol.id_usuario`.
3. Si se confirma que 4 y 7 son la misma identidad y se elige 7, vincular el **pozo ID 4** mediante la pantalla administrativa o el endpoint con `id_propietario=7` e `id_propietario_esperado=4`. No confundir el ID 4 con el número empresarial 3001. El pozo ID 2 y su número nulo deben conservarse.
4. Verificar los dos pozos, sus fotos, informes, intervalos y permisos. Registrar quién aprobó la conciliación y el mapeo de IDs. Conservar referencias históricas de autoría; no actualizarlas como si fueran propietarios.
5. Solo después de revisar todas las relaciones, desactivar los registros sobrantes confirmados mediante administración, conservándolos para trazabilidad. Revisar/revocar sesiones si corresponde. No eliminar usuarios, fusionar credenciales, reciclar IDs ni renumerar pozos automáticamente. Si son personas distintas, completar los datos diferenciadores y mantener ambas identidades.

## Validaciones

| Verificación | Resultado |
|---|---|
| API: `npm.cmd test` | 324 pruebas aprobadas |
| API: `npm.cmd run build` | Compilación TypeScript aprobada |
| Frontend: `npm.cmd test -- --watch=false --browsers=ChromeHeadless` | 393 pruebas aprobadas |
| Frontend: `npm.cmd run build:production` | Compilación aprobada |
| Frontend: `npm.cmd run check:utf8` | Aprobada |
| PostgreSQL real aislado: prueba `propietario-provisional.postgres.local.ts` | 8 pruebas/subpruebas aprobadas |
| Parche: `git apply --check` y comprobación de espacios | Sin errores |

La integración se ejecutó en PostgreSQL **18 local**, puerto 55432, con una base desechable generada por la prueba. Ejecuta 000–011, crea datos anteriores, aplica 012 y verifica la preservación de registros. Utiliza las rutas Fastify y el plugin JWT reales, cookies firmadas, FK y transacciones reales; no reemplaza las comprobaciones de permisos por hooks permisivos. Cada base de prueba se elimina al terminar. **El piloto sigue en PostgreSQL 16, sin aplicar 012.**

Cobertura específica:

- Provisional válido, inválido/vacío y representación ambigua; selección de propietario histórico.
- Conteo y contenido de usuarios intactos al crear el pozo provisional.
- Bloqueo del alta y edición global de propietarios para perforadores.
- Vinculación administrativa, rol incorrecto, ID previo desactualizado y rechazo de reasignaciones por edición general.
- Detalle, listado, informe y fotografía del provisional; acceso denegado a propietarios homónimos y perforadores ajenos.
- Conservación exacta de las filas técnicas, sus IDs, el resto de la fila del pozo y los bytes de fotografía al vincular.
- Homónimos con diferentes IDs y múltiples roles sin multiplicación artificial de resultados.
- Incorporación sucesiva, conservación de filas anteriores, botón al final, foco y movimiento reducido en los cuatro grupos.
- Conservación del borrador y foto local al vincular; doble envío, reintento sin crear otra identidad y bloqueo de recargas simultáneas.

Las compilaciones conservan una advertencia de Stencil sobre el glob `*.entry.js`; la suite frontend también emite advertencias de iconos Ionic. No impiden la compilación ni producen pruebas fallidas. No se realizaron pruebas físicas nuevas en el Redmi ni una compilación Gradle/APK.

## Integración en una sola próxima APK

1. Revisar el diff completo y este informe antes de preparar el commit solicitado en una etapa posterior.
2. Ensayar el upgrade en una copia de la base del piloto sobre PostgreSQL 16, con respaldo de BD y fotos, usando el runner incremental existente (`npm run db:migrate` desde API compilada y con configuración explícita de esa copia). No usar `--adopt-current-schema` para este upgrade normal ni editar migraciones anteriores.
3. Coordinar migración 012, publicación de API/frontend y una única versión móvil con ambas correcciones. No publicar esta API contra una base sin 012. La versión anterior de la app no ofrece provisionales y sus intentos de alta como perforador recibirán 403; coordinar la actualización/minimum build mediante el procedimiento de publicación existente.
4. Antes de distribuir, compilar la variante nativa prevista con el endpoint correcto y ejecutar el proceso habitual de firma fuera de este trabajo. No modificar `.env.pilot.local` para preparar el parche.
5. En una única actualización del Redmi comprobar teclado y scroll con varios elementos consecutivos de cada tipo; crear un pozo provisional con foto y todos los grupos; reabrirlo; vincularlo desde administración; verificar acceso del propietario real y denegación a otro usuario. Confirmar número 3001 y registros anteriores intactos.
6. Conciliar duplicados como operación separada, aprobada y documentada. La migración 012 no lo hace.

No revertir a una API antigua una vez que existan pozos provisionales sin un plan de compatibilidad: la API anterior presupone propietario obligatorio. Tampoco eliminar la columna o restaurar `NOT NULL` mientras existan pendientes.

## Archivos modificados

La lista siguiente incluye implementación, migración, pruebas y este informe. Las migraciones 000–011 permanecen sin cambios.

- `api/src/models/schemas.ts`
- `api/src/routes/pozos.ts`
- `api/src/services/candidatos-pozo-service.ts`
- `api/src/services/generar-informe-consultas.ts`
- `api/src/services/pozo-completo-service.ts`
- `api/src/services/pozos-services.ts`
- `api/src/services/propietario-pozo-service.ts`
- `api/test/pozos-roles-multiples.test.ts`
- `api/test/propietario-operativo.test.ts`
- `api/test/propietario-provisional.postgres.local.ts`
- `api/test/propietario-provisional.test.ts`
- `api/test/rsp06c.test.ts`
- `api/test/rsp06i-r5-compatibilidad.test.ts`
- `api/test/rsp06k-r2-ids.test.ts`
- `api/db/migrations/012_propietario_provisional.sql`
- `api/db/tests/012_propietarios_auditoria.sql`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.css`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.spec.ts`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts`
- `front/src/app/routes/pozos/components/selector-persona-pozo/selector-persona-pozo.component.html`
- `front/src/app/routes/pozos/components/selector-persona-pozo/selector-persona-pozo.component.spec.ts`
- `front/src/app/routes/pozos/components/selector-persona-pozo/selector-persona-pozo.component.ts`
- `front/src/app/routes/pozos/components/vincular-propietario/vincular-propietario.component.spec.ts`
- `front/src/app/routes/pozos/components/vincular-propietario/vincular-propietario.component.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.html`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.spec.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts`
- `front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.html`
- `front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.ts`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html`
- `front/src/app/shared/services/pozos-create.service.spec.ts`
- `front/src/app/shared/services/propietarios-operativos.service.ts`
- `front/src/app/shared/types/schemas.ts`
- `docs/CODEX_INFORME_CORRECCIONES_REDMI_A2.md`
