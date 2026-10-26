# Actualización 026 — Numeración por instalación

Implementación local sobre 025. No aplicada a producción. No concede permisos,
no cambia ningún número existente, no libera reservas y no corrige el contador.

## Diagnóstico y modelo

El corte anterior estaba en la API, formularios Angular, validación del histórico,
reingreso, clasificación de reservas, rectificación y funciones/constraints SQL
de 017, 022, 024 y 025. Sólo se agrega 026; esas migraciones no se editan.

Ahora son conceptos separados:

- `numeracion_perforacion.proximo`: cursor elegido, no evidencia de asignación.
- `mayor_asignado`: máximo registrado; no impone el mínimo del cursor. Las
  rectificaciones excepcionales conservan su recalculado auditado anterior.
- `pozo.origen`: procedimiento de alta (`normal` o `historico`), independiente
  del número. No se reclasifican registros existentes.
- Reservas: conservan la identidad que recibió cada número, incluso al borrar.
- Referencias históricas/offline: bloquean asignaciones ordinarias aunque falte
  su reserva. No se eliminan ni se redirigen sus resultados de idempotencia.
- `politica_numeracion`: rangos protegidos pendientes de digitalización,
  excepciones individuales comprobadas y revisión de la política.

Rango técnico: enteros de 1 a 2147483647. El valor 2147483648 sólo representa
agotamiento interno; no se ofrece como número empresarial configurable.

## Instalación y compatibilidad

026 crea metadata y auditoría de política y sustituye funciones/constraints.
No actualiza tablas de perforaciones, reservas, contador, referencias ni permisos.
No concede capacidades. La capacidad existente de 025 conserva ID y revisión.

**Compatibilidad conservadora:** una instalación anterior con perforaciones,
reservas, cursor configurado o auditoría de configuración recibe inicialmente
la protección 1–3281 que antes imponía el software. Ésta es una inicialización
de metadata de transición, no un mínimo global en las funciones de asignación.
Una instalación enteramente nueva recibe política vacía y cursor sin configurar:
puede comenzar en 1, 300, 1000 u otro entero permitido. Antes de importar carpetas
de otra empresa deben declararse sus rangos reales pendientes de digitalización.

El script legado de reset de piloto permanece fuera de este flujo: exige
exactamente esquema 000–017 y un inventario cerrado de tablas/identidades. Ya
rechaza 026 y no es un aprovisionador de futuras empresas. No se ejecutó ni amplió.

Históricos pueden registrarse con cualquier número positivo o `null` cuando se
desconoce. No se les inventa un número automático. La posterior asignación manual
exige origen histórico comprobado y ausencia de conflictos. Registros legados sin
origen histórico comprobable requieren revisión, no conversión automática.

## Configuración, protección y avance

Las cinco herramientas administrativas permanecen. Dentro de «Próximo automático»
se puede consultar la protección histórica y sus últimas 30 revisiones.

Para cambiar el cursor se conserva la vista previa, motivo de 10–1000 caracteres,
declaración de antecedentes físicos, frase `CONFIRMAR N`, desafío firmado de cinco
minutos y auditoría inmutable. Los retrocesos (o selección bajo el máximo registrado)
exigen capacidad especial de 025. Administradores comunes no obtienen derechos nuevos.

La próxima alta normal recibe **exactamente** el número elegido, revalidado dentro
del bloqueo del contador. Si otro histórico lo ocupó después, el alta falla sin
consumir otro número. Después de asignar, avanza al menor entero superior permitido,
omitiendo activos, reservas, referencias y protecciones. No busca hacia atrás por
sí solo. Los rangos se saltan por sus extremos, sin recorrer cada entero.

Un histórico no cambia el cursor, aunque su número coincida con él: en ese caso
administración debe elegir otro antes de una nueva alta normal. Las altas y las
operaciones administrativas comparten el bloqueo de contador; las operaciones HTTP
conservan también la barrera de escritura de sesión y la idempotencia existentes.

### Elegir 300 en una instalación con antecedentes protegidos

1. Consultar su situación. Si está ocupado, reservado o tiene referencias,
   la configuración ordinaria y la excepción de protección se rechazan.
2. Si sólo está protegido como antecedente pendiente, revisar carpetas físicas,
   documentación entregada y sincronizaciones. **Si existió o hay dudas, no habilitarlo.**
3. Con capacidad especial, seleccionar «Habilitar un número sin antecedentes,
   previa revisión», indicar 300 y un motivo documentado.
4. Revisar y declarar que nunca fue asignado y que no existen antecedentes
   incompatibles. Escribir `POLITICA 300` y confirmar. Esto sólo crea una excepción
   individual de protección: no libera reservas ni mueve el cursor.
5. Revisar el cambio de contador a 300 y confirmarlo por el procedimiento normal.
   Si los demás números hasta 3281 siguen protegidos, tras asignar 300 se avanza
   a 3282 o al siguiente permitido si éste tuviera conflictos.

También se pueden agregar rangos protegidos y retirar excepciones individuales.
No existe desprotección masiva de rangos. No se permite proteger el cursor actual:
primero debe elegirse otro. Una política admite hasta 100 rangos normalizados y
10000 excepciones; superar ese alcance requiere revisión de diseño.

Toda modificación de protección exige administrador activo con capacidad especial,
motivo, declaración, firma vinculada a actor/operación/estado/capacidad, revisión y
confirmación escrita. Se revalida dentro de una transacción; se guarda usuario,
autorización, motivo, fecha, confirmación y política anterior/posterior. La revisión
de política también invalida vistas previas del contador. Nonce único y revisión
impiden reutilización; revocar/reconceder capacidad invalida desafíos anteriores.
Fallar al registrar auditoría revierte todo. No hay endpoint para conceder privilegios.

## Reservas, rectificación y reingreso

La clasificación consulta evidencia de origen: registro activo, creación histórica,
auditoría de eliminación o reingreso anterior. Nunca deduce el origen por ser menor
o mayor que 3282. Si no se conoce o es contradictorio, bloquea y exige revisión.

La eliminación normal conserva la reserva y el contrato de confirmación del backend.
Las recuperaciones de pruebas automáticas mantienen las condiciones conservadoras
de cola final consecutiva, ausencia de referencias y auditoría; no son una liberación
arbitraria de huecos. Un rango protegido impide rectificarlas como números nuevos.

El reingreso histórico conserva el procedimiento 024: autorización temporal, nuevo
ID, sustitución de reserva e INSERT atómicos, referencia original intacta, auditoría
de ambas identidades y mismo contador. Funciona también por encima del antiguo corte.
P-3277/ID 19 no es excepción programada ni se libera mediante esta actualización.
Los intentos pendientes mantienen clave, época, contenido y fotografía; no se
recuperan automáticamente borradores de otros dispositivos.

## API y límites de evidencia

- `GET /pozos/numeracion/politica`: consulta administrativa y auditoría reciente.
- `POST /pozos/numeracion/politica/revision`: prepara confirmación, sin escribir.
- `PUT /pozos/numeracion/politica`: verifica y audita `proteger_rango`,
  `habilitar_numero` o `proteger_numero`.
- La revisión existente de contador informa ocupado/reservado/referenciado/protegido.
- Las rutas históricas aceptan números positivos, sin techo histórico empresarial.

La base puede comprobar referencias digitales conocidas; no puede probar la ausencia
de carpetas físicas, PDFs externos o dispositivos sin sincronizar. Esa comprobación
es responsabilidad expresa del administrador y queda auditada. Ante incertidumbre se
conserva la protección. No se promete disponibilidad productiva de 300 sin esa revisión.

## Respaldo, restauración y futuras empresas

Las tablas nuevas se incluyen en el pg_dump integral existente. Las pruebas restauran
en otra base y comparan todas las tablas y secuencia de pozo, incluyendo política,
autorizaciones y auditorías. No cambian rutas, formato ni tratamiento de fotografías
o cuarentenas. Se conserva la compatibilidad con el restaurador integral ya ensayado;
no se repitió un despliegue ni se tocaron respaldos reales. Una restauración debe
coordinar código y esquema compatibles, nunca reutilizar una API anterior a ciegas.

**Esto sigue siendo una sola empresa por instalación. No hay aislamiento multiempresa.**
Para vender instalaciones independientes se requieren bases, volúmenes, credenciales,
documentos y backups separados. Una futura base compartida requerirá revisión propia:
`empresa_id` obligatorio, claves únicas compuestas empresa/número, FKs compuestas,
contadores y locks por empresa, permisos/membresías por empresa, autorizaciones y
desafíos vinculados a empresa, idempotencia por empresa/actor/operación, rutas de
documentos/fotos aisladas, RLS o barreras equivalentes y pruebas cruzadas de aislamiento.
No basta agregar un selector de empresa a estas tablas globales.

## Verificación focalizada

- Política 026 y actualización 025 con datos/permisos previos: 25/25 PostgreSQL.
- Control administrativo 025 sobre esquema nuevo: 22/22.
- Eliminación segura: 20/20; reingreso/identidad 19/fotos: 20/20; rectificación: 11/11.
- Validación de numeración/PDF: 6/6; modelos históricos: 3/3.
- Frontend focalizado: 87/87, con cancelación, doble clic, errores, permiso y pendientes.
- Build local: cinco secciones y política expandida a 390, 768 y 1366 px, 3/3.
- TypeScript API y compilación Angular correctos. Aviso no bloqueante de Stencil
  `empty-glob`; pruebas de interfaz muestran advertencias existentes de tracking y
  recurso `/null` en fixtures. Sin cambios en dependencias.

PostgreSQL usado: clústeres nuevos en Temp, datos ficticios, credenciales aleatorias,
puertos loopback y directorios verificados; detenidos al terminar. Sin Docker ni
sesiones/datos productivos. No se hicieron commits, push ni despliegues.

Algunas expectativas antiguas de pruebas se actualizaron: rango por política en lugar
de corte fijo, fixtures previos a 024 creados sin ejecutar servicios 026, rechazo 409
por estado/confirmación y litología ficticia válida en la prueba PDF.

## Archivos del cambio

32 archivos: 25 modificados y 7 nuevos, sin staging.

- `api/db/migrations/026_numeracion_empresarial_configurable.sql`
- `api/src/models/historicos.ts`
- `api/src/routes/historicos.ts`
- `api/src/routes/numeracion-perforacion.ts`
- `api/src/services/administracion-eliminaciones-service.ts`
- `api/src/services/historicos-service.ts`
- `api/src/services/numeracion-perforacion-service.ts`
- `api/src/services/politica-numeracion-service.ts`
- `api/src/services/rectificacion-numeracion-service.ts`
- `api/src/services/reingreso-historico-service.ts`
- `api/test/administracion-eliminaciones.postgres.local.ts`
- `api/test/control-numeracion.postgres.local.ts`
- `api/test/historicos.test.ts`
- `api/test/numeracion-perforacion.test.ts`
- `api/test/politica-numeracion.postgres.local.ts`
- `api/test/rectificacion-numeracion.postgres.local.ts`
- `api/test/reingreso-historico.postgres.local.ts`
- `docs/NUMERACION_EMPRESARIAL_CONFIGURABLE.md`
- `front/scripts/test-numeracion-visual.mjs`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.html`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.spec.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.html`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.ts`
- `front/src/app/routes/pozos/pages/numeracion/politica-numeracion.component.html`
- `front/src/app/routes/pozos/pages/numeracion/politica-numeracion.component.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/politica-numeracion.component.ts`
- `front/src/app/routes/pozos/pages/numeracion/rectificacion-numeracion.component.ts`
- `front/src/app/routes/pozos/pages/numeracion/reservas-eliminadas.component.ts`
- `front/src/app/shared/services/administracion-eliminaciones.service.ts`

## Cierre de la continuación

Se reutilizaron las verificaciones aprobadas de implementación. En la continuación
se revisaron el estado y diff local, archivos nuevos, integración y evidencias;
sólo se completó este inventario documental y se verificó `git diff --check`.
No se modificó código funcional ni se repitieron suites. Las migraciones 000–025
permanecen intactas. Sin secretos identificados en los cambios revisados.
Rama `feature/rsp-10-pilot-apk`, HEAD `06601c6aecdfeeffa7c763ce754fa5176d1b4afc`.
Pendiente autorización para commit; no se creó commit ni se hizo push o despliegue.
