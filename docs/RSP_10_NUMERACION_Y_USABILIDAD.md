# Numeración empresarial y usabilidad del piloto

Fecha: 2026-10-01. Rama: feature/rsp-10-pilot-apk.
Base inspeccionada: b5dedf5730a428845c1ba0de4778f8e88716683d.
Cambios locales preparados sin commit ni publicación.

## Arquitectura inspeccionada

La API usa Fastify, TypeBox y pg; el frontend usa Angular 20 e Ionic 8.
Se revisaron las migraciones 000..010, el runner y su ledger con checksums,
las relaciones de pozo, sitio, usuario, usuario_rol, intervalos, aportes,
documentos e informes; también los servicios de creación/edición, permisos,
formularios, catálogo litológico y composición del PDF.

La creación utilizada por la aplicación es POST
/usuarios/:id_usuario/pozos/completo. Ya incorpora sitio, pozo, capas y datos
técnicos en una transacción. El endpoint legacy de creación está deshabilitado.
La numeración se incorpora a esa transacción.

Todas las claves foráneas, las rutas, los archivos fotográficos y las consultas
de hijos siguen utilizando id_pozo. El número empresarial es un dato distinto.
El rol administrativo real se llama administracion, no admin.

El formulario litológico utiliza un único buscador de nombre o familia y un
selector compartido. Las familias son valores del catálogo; no había un campo
independiente que crease familias desde el formulario de perforación.

## Migración 011 y reglas de numeración

Archivo nuevo: api/db/migrations/011_numero_perforacion.sql.
No se modifican las migraciones 000..010.

- pozo.numero_perforacion: INTEGER positivo, con UNIQUE real. Rango admitido:
  1..2147483647. Los pozos anteriores quedan NULL, sin deducir números de id_pozo.
- numeracion_perforacion: una única fila global, con próximo número y mayor
  número asignado. El próximo comienza NULL; administración debe configurarlo.
- numero_perforacion_reservado: reserva permanente del número y referencia
  original al pozo. No se elimina en cascada al borrar el pozo.
- numeracion_perforacion_configuracion: historial de cambios del contador,
  con valor anterior, nuevo, usuario y fecha.
- Trigger BEFORE INSERT/UPDATE OF numero_perforacion: bloquea la fila del
  contador con SELECT FOR UPDATE, reserva el número y actualiza el contador
  en la misma transacción. Rechaza modificar o quitar un número confirmado.

La política de reserva tras eliminación e inmutabilidad fue confirmada por
el usuario durante este trabajo.

Un campo omitido o NULL al crear solicita asignación automática. La API rechaza
que un perforador indique un número manual, aunque construya la petición fuera
del formulario. El servicio vuelve a consultar el rol administrativo en la
base. La configuración y la identificación de pozos antiguos también están
protegidas por el middleware de administración y por el servicio.

Los números se validan antes de la coerción HTTP de TypeBox/Ajv: 0, negativos,
decimales, booleanos, cadenas y valores fuera de rango no se transforman en una
petición automática. Los conflictos de numeración se comunican con HTTP 409.

Ejemplo verificado con PostgreSQL real:

| Operación | Número |
| --- | ---: |
| Configuración administrativa inicial | próximo 2047 |
| Dos altas concurrentes | 2047 y 2048 |
| Histórico manual | 1850 |
| Nueva alta automática | 2049 |
| Histórico manual | 1990 |
| Nueva alta automática | 2050 |

En concurrencia, el orden de llegada al bloqueo decide qué perforador obtiene
cada número. No se promete que A siempre reciba el menor.

Un histórico menor no retrocede el contador. Un manual igual o superior al
próximo lo adelanta a manual + 1. Si se registra un histórico antes de configurar
el contador, se conserva el estado sin configurar y queda fijado el mínimo
admisible para la configuración inicial.

El contador nunca retrocede. La configuración envía además el valor previo
observado: si otra operación lo cambió, devuelve conflicto y pide actualizar.
Si falla cualquier parte de la creación, también se revierten la reserva y el
avance del contador. El id_pozo técnico puede tener saltos, como antes.

## Interfaz y API

Administración dispone de “NUMERACIÓN DE PERFORACIONES” en el menú de
perforaciones. Allí configura el próximo número sin cargar los históricos.
En creación puede dejarlo vacío o indicar un histórico y consultar disponibilidad.
La disponibilidad es informativa; la restricción transaccional decide al guardar.

Los pozos del piloto sin número muestran “Perforación sin número asignado”.
Administración puede identificarlos desde el detalle mediante “Asignar número
real”. Esa acción exige un número explícito y no altera sus datos técnicos.

La edición habitual muestra el número como información. El frontend omite el
campo al enviar la edición. Para conservar compatibilidad con clientes que
devuelven todos los datos recibidos, la API acepta el mismo número que ya existe,
pero rechaza cualquier cambio, incluida su eliminación.

Listado, detalle, edición y portada del PDF distinguen número empresarial e
“ID interno”. El listado también permite buscar por número real. La respuesta de
creación devuelve el número confirmado y navega al detalle por id_pozo.

Endpoints administrativos nuevos:

| Método y ruta | Función |
| --- | --- |
| GET /pozos/numeracion | Estado del contador |
| PUT /pozos/numeracion | Configurar con proximo y esperado |
| GET /pozos/numeracion/disponibilidad/:numero | Consultar reserva |
| PATCH /pozos/:id_pozo/numero-perforacion | Identificar un pozo anterior sin número |

No existe una operación pública para liberar o cambiar un número ya asignado.
Una corrección excepcional requerirá un procedimiento específico de
administración y auditoría, fuera de la edición normal.

## Capas litológicas y Home

“+ Agregar otra litología” está debajo de las filas. Las capas nuevas se agregan
al final de la lista visible, incluso al completar un hueco interno, conservando
las filas anteriores y sus datos. Las validaciones y el PDF siguen evaluando
los intervalos por profundidad; no cambia el orden geológico del informe.

Después del renderizado se enfoca el primer campo y se desplaza la nueva fila
con suavidad. Con prefers-reduced-motion el desplazamiento es inmediato.

El buscador despliega los nombres y familias realmente devueltos por el catálogo,
normaliza tildes y mayúsculas y permite selección por flechas/Enter o toque.
Incluye cierre con Escape, semántica combobox/listbox y objetivos táctiles de
48 px. Elegir una sugerencia emite el ID y nombre existentes: no ejecuta altas
del catálogo ni crea familias. Se conserva el tratamiento de litologías
históricas inactivas y materiales anteriores sin vínculo.

El Home conserva su diseño: la animación pasa de 8 s y 4 px a 5,5 s y 7 px,
únicamente cuando el usuario no solicita movimiento reducido.

## Verificación ejecutada

Las pruebas de implementación se ejecutaron en una copia temporal del mismo
commit, con las dependencias instaladas del repositorio. Los tests nativos que
requieren Git y configuración local de Android se ejecutaron en el checkout
original, cuyos archivos nativos no se modificaron.

| Comprobación | Resultado |
| --- | --- |
| API: npm run build | Correcto |
| API: npm test | 322/322 |
| Frontend: npm test -- --watch=false --browsers=ChromeHeadless | 380/380 |
| Frontend: npm run test:production-build | Build production y contrato web correctos |
| Frontend: npm run check:utf8 | Correcto |
| Frontend: npm run test:native-config | 38/38 |
| Frontend: npm run build:native:development | Correcto; contrato CSS nativo validado |
| Frontend: npm run check:native-release-readiness | Tests pasan; falta NATIVE_BACKEND_ORIGIN en esta sesión |
| numeracion-perforacion-postgres.local.ts | Base nueva y equivalente al piloto: correctas |
| sello-sanitario-postgres.local.ts | Regresión del catálogo 000..010: correcta |

La prueba nativa de desarrollo utilizó exclusivamente
https://native-backend.example como origen de fixture: no se hizo ninguna
petición a ese host ni al backend productivo. Ese build temporal no es un
artefacto para distribuir.

Las pruebas PostgreSQL crearon clústeres propios en Temp con puertos libres,
escucha loopback y credenciales aleatorias; verificaron data_directory y
detuvieron/eliminaron exclusivamente sus propios clústeres. No cargaron .env.
La prueba de concurrencia comprobó dos conexiones reales esperando a la vez
por el contador antes de liberar el bloqueo.

Se verificaron duplicados manuales simultáneos, manual frente a automático,
permisos HTTP y de servicios, inválidos, reservas después de eliminación,
contador sin configurar, agotamiento del rango, rollback por fallo de una
capa, conservación de registros previos, número en listado/detalle/reporte y
compatibilidad de edición. El test de PDF inspecciona el texto dibujado en la
portada y comprueba que la generación no modifica los intervalos de entrada.

Las suites conservaron avisos de Ionic/Stencil y del entorno zoneless; no
hubo fallos finales. Algunas ejecuciones iniciales requirieron salir del
sandbox de Windows por acceso denegado a dependencias o a initdb. Los fallos
de expectativas antiguas por el orden visual y por la nueva columna se
actualizaron para verificar el comportamiento nuevo.

## Compatibilidad y límites

El Compose productivo fija PostgreSQL 16.14. El único binario local disponible
es PostgreSQL 18.4, con el que se ejecutaron las pruebas reales. La migración
utiliza INTEGER/BIGINT, restricciones, PL/pgSQL, triggers y bloqueos de fila
disponibles en PostgreSQL 16; no utiliza funcionalidades exclusivas de 18.
Antes del despliegue debe repetirse el ensayo contra PostgreSQL 16.14 y una
copia restaurada del backup real. No se inspeccionaron datos privados de la
base productiva ni se afirma haber probado sobre su snapshot.

El contador es deliberadamente serial: cada creación lo mantiene bloqueado
hasta confirmar el conjunto del pozo, incluidos hijos y fotografía. Esto
prioriza consistencia; este trabajo no constituye una prueba de carga.

Se comprobaron 320 px y eventos de interacción en Chrome Headless. Falta la
validación física del teclado Android, scroll, selección y PDF en Redmi A2:
no se instaló ninguna APK durante este trabajo.

El preflight de release conserva el bloqueo por origen HTTPS ausente y pide
la revisión visual habitual de icono/splash. Identidad, nombre, versión,
debuggable y contrato de firma por variables de entorno resultaron correctos.
No se firmó ningún artefacto ni se cambiaron variables del piloto.

## Integración y despliegue posterior

1. Revisar el diff y confirmar con administración el próximo número real.
   2047 se utilizó en pruebas; no se precarga como valor productivo.
2. Hacer backup verificado de PostgreSQL y fotografías. Restaurarlo en un
   entorno separado PostgreSQL 16.14 y ensayar allí la migración 011 y los
   flujos descritos. Los runners locales aceptan como argumento el directorio
   bin de PostgreSQL para reproducir sus pruebas con otra versión.
3. En una ventana controlada sin altas, aplicar la 011 con el runner existente
   y desplegar API/frontend compatibles. No editar SQL históricos ni sus
   checksums. Confirmar ledger 000..011 y la ausencia de renumeración de pozos
   anteriores.
4. Entrar como administración, configurar el próximo número real y asignar
   únicamente los números conocidos de los registros del piloto.
5. Preparar la siguiente APK con el origen HTTPS real, ejecutar preflight,
   firmar e instalar según el procedimiento del piloto. Esas acciones quedan
   para la etapa autorizada posterior.
6. En Redmi A2 verificar alta automática, histórico administrativo, número
   visible en listado/detalle/PDF, búsqueda litológica y carga sucesiva de capas.
   Probar concurrencia en el entorno restaurado para no consumir números
   empresariales con ensayos en producción.
7. Revisar y crear el commit solamente después de la aprobación del cambio.

No se incluye un down automático: una vez usadas las reservas empresariales,
eliminar la columna o las tablas perdería trazabilidad. Cualquier reversión
de despliegue debe preservar la numeración confirmada.

Se respetaron las restricciones: sin migrar el piloto, sin modificar
.env.pilot.local, sin desplegar Docker, sin firmar o instalar APK, sin commits
y sin subir cambios a GitHub.

## Archivos afectados (46)

| Estado | Archivo |
| --- | --- |
| Modificado | [api/src/models/errors.ts](../api/src/models/errors.ts) |
| Modificado | [api/src/models/schemas.ts](../api/src/models/schemas.ts) |
| Modificado | [api/src/pdf/pdf-generate.ts](../api/src/pdf/pdf-generate.ts) |
| Nuevo | [api/src/routes/numeracion-perforacion.ts](../api/src/routes/numeracion-perforacion.ts) |
| Modificado | [api/src/routes/pozos.ts](../api/src/routes/pozos.ts) |
| Modificado | [api/src/services/generar-informe-consultas.ts](../api/src/services/generar-informe-consultas.ts) |
| Nuevo | [api/src/services/numeracion-perforacion-service.ts](../api/src/services/numeracion-perforacion-service.ts) |
| Modificado | [api/src/services/pozo-completo-service.ts](../api/src/services/pozo-completo-service.ts) |
| Modificado | [api/src/services/pozos-services.ts](../api/src/services/pozos-services.ts) |
| Nuevo | [api/db/migrations/011_numero_perforacion.sql](../api/db/migrations/011_numero_perforacion.sql) |
| Nuevo | [api/test/numeracion-perforacion-postgres.local.ts](../api/test/numeracion-perforacion-postgres.local.ts) |
| Nuevo | [api/test/numeracion-perforacion.test.ts](../api/test/numeracion-perforacion.test.ts) |
| Modificado | [api/test/rsp06c.test.ts](../api/test/rsp06c.test.ts) |
| Modificado | [api/test/sello-sanitario-postgres.local.ts](../api/test/sello-sanitario-postgres.local.ts) |
| Modificado | [api/test/sello-sanitario.test.ts](../api/test/sello-sanitario.test.ts) |
| Modificado | [front/src/app/app.routes.ts](../front/src/app/app.routes.ts) |
| Modificado | [front/src/app/routes/home/home.page.css](../front/src/app/routes/home/home.page.css) |
| Modificado | [front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.css](../front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.css) |
| Modificado | [front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html](../front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html) |
| Modificado | [front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.spec.ts](../front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.spec.ts) |
| Modificado | [front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts](../front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts) |
| Modificado | [front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html](../front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html) |
| Modificado | [front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts](../front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts) |
| Modificado | [front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts](../front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts) |
| Nuevo | [front/src/app/routes/pozos/pages/numeracion/numeracion.page.ts](../front/src/app/routes/pozos/pages/numeracion/numeracion.page.ts) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.html](../front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.html) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html](../front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts](../front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html](../front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts](../front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts) |
| Modificado | [front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.ts](../front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.ts) |
| Modificado | [front/src/app/routes/pozos/pozo/pozo.page.html](../front/src/app/routes/pozos/pozo/pozo.page.html) |
| Modificado | [front/src/app/routes/pozos/pozo/pozo.page.ts](../front/src/app/routes/pozos/pozo/pozo.page.ts) |
| Nuevo | [front/src/app/shared/components/numero-perforacion/asignar-numero-pendiente.component.ts](../front/src/app/shared/components/numero-perforacion/asignar-numero-pendiente.component.ts) |
| Nuevo | [front/src/app/shared/components/numero-perforacion/numero-perforacion.component.spec.ts](../front/src/app/shared/components/numero-perforacion/numero-perforacion.component.spec.ts) |
| Nuevo | [front/src/app/shared/components/numero-perforacion/numero-perforacion.component.ts](../front/src/app/shared/components/numero-perforacion/numero-perforacion.component.ts) |
| Modificado | [front/src/app/shared/components/selector-litologia/selector-litologia.component.css](../front/src/app/shared/components/selector-litologia/selector-litologia.component.css) |
| Modificado | [front/src/app/shared/components/selector-litologia/selector-litologia.component.html](../front/src/app/shared/components/selector-litologia/selector-litologia.component.html) |
| Modificado | [front/src/app/shared/components/selector-litologia/selector-litologia.component.spec.ts](../front/src/app/shared/components/selector-litologia/selector-litologia.component.spec.ts) |
| Modificado | [front/src/app/shared/components/selector-litologia/selector-litologia.component.ts](../front/src/app/shared/components/selector-litologia/selector-litologia.component.ts) |
| Nuevo | [front/src/app/shared/services/numeracion-perforacion.service.spec.ts](../front/src/app/shared/services/numeracion-perforacion.service.spec.ts) |
| Nuevo | [front/src/app/shared/services/numeracion-perforacion.service.ts](../front/src/app/shared/services/numeracion-perforacion.service.ts) |
| Modificado | [front/src/app/shared/services/pozos-edit.service.spec.ts](../front/src/app/shared/services/pozos-edit.service.spec.ts) |
| Modificado | [front/src/app/shared/services/pozos-edit.service.ts](../front/src/app/shared/services/pozos-edit.service.ts) |
| Modificado | [front/src/app/shared/types/schemas.ts](../front/src/app/shared/types/schemas.ts) |
| Nuevo | [docs/RSP_10_NUMERACION_Y_USABILIDAD.md](../docs/RSP_10_NUMERACION_Y_USABILIDAD.md) |
