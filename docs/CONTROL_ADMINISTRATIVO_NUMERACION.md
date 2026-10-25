# Control administrativo de numeración — 025

## Diagnóstico y alcance

La API calculaba el mínimo como el máximo entre 3282, el mayor asignado más uno y
el próximo configurado. El frontend repetía esa restricción. PostgreSQL además
exigía `proximo > mayor_asignado`: corregir un cursor por debajo del máximo real
requería cambiar el modelo, no sólo habilitar un botón.

El diagnóstico productivo fue exclusivamente READ ONLY: se confirmó un error de
configuración sin una asignación correspondiente. No se modificaron números,
reservas, referencias, fotografías ni servicios productivos. Los casos numéricos
en las pruebas son ficticios. Esta entrega sólo autoriza un commit local; no push ni despliegue.

## Política

- Rango automático: 3282–2147483647. Rango histórico: 1–3281, con los flujos existentes.
- `proximo` es un cursor; `mayor_asignado` conserva el máximo de asignaciones,
  sujeto únicamente a las anulaciones excepcionales ya auditadas por 022–023.
- Configurar no crea una perforación, no reserva un número ni modifica el máximo.
- La siguiente alta recibe **exactamente** el cursor. Si dejó de estar disponible,
  falla sin saltarlo silenciosamente. Después avanza al menor número libre superior.
- El avance saltea perforaciones, reservas y referencias históricas/offline, incluso
  referencias sin reserva. No elimina ni cambia ninguna de ellas. No vuelve al
  comienzo al agotarse el rango: el administrador debe revisar otro número libre.
- Un histórico o reingreso no adelanta ni retrocede el cursor automático.
- Las altas y configuraciones comparten el bloqueo de la fila del contador.
  Se mantienen UNIQUE en perforación/reserva, reservas permanentes, números
  asignados inmodificables e idempotencia de creación/offline.

## Autorización especial

No existe un superadministrador diferenciado en el modelo anterior. Se incorpora
una **capacidad específica de numeración**, en `autorizacion_numeracion`, ligada a
una cuenta existente. No es un nuevo rol seleccionable desde la gestión ordinaria
de usuarios y no se concede automáticamente a ningún administrador.

Para retroceder, o configurar bajo el mayor asignado, se exige simultáneamente:
cuenta activa con acceso, rol administración y autorización específica activa.
La autorización se vuelve a comprobar y bloquear dentro de la transacción.
Un administrador ordinario conserva los adelantos y las operaciones excepcionales
anteriores, con sus restricciones propias; no puede concederse esta capacidad
mediante la API de roles. No se agregan endpoints de concesión en este cambio.

**Paso pendiente antes de utilizar retrocesos reales:** elegir la cuenta autorizada
y aprobar por separado el aprovisionamiento controlado de esa capacidad, con
responsable y motivo. No se incluye un ID, email o nombre privilegiado fijo.
No ejecutar SQL de corrección del contador para sustituir el nuevo flujo.

### Procedimiento de concesión y revocación (posterior, requiere autorización)

La revisión final incorporó `administrar_autorizacion_numeracion` y su historial
inmutable. La función no es `SECURITY DEFINER`, no concede acceso SQL ni está
disponible para `PUBLIC`: se utiliza desde la conexión administrativa local
protegida del operador de base, después de instalar 025. La cuenta de la aplicación
no puede invocarla desde un endpoint. Un administrador de la aplicación no obtiene
acceso a PostgreSQL por tener un rol administrativo.

1. Obtener autorización expresa identificando la cuenta destinataria, el
   administrador responsable y el motivo. Verificar ambas identidades en la
   gestión existente, sin asumir IDs ni usar nombres fijos.
2. Abrir la conexión `psql` administrativa local ya prevista, sin contraseñas en
   argumentos o logs, con `-X --set=ON_ERROR_STOP=1`. Confirmar servidor/base,
   migración 025 y respaldo vigente antes de escribir.
3. Usar este bloque en esa sesión. Los valores se solicitan expresamente; no
   ejecutar el ejemplo durante un despliegue. Para revocar, cambiar
   `conceder` a `false` y escribir `REVOCAR <ID>` al confirmar.

```sql
\set conceder true
\prompt 'ID de la cuenta destinataria verificada: ' destinatario
\prompt 'ID del administrador responsable verificado: ' responsable
SELECT current_database(), session_user;
SELECT u.id_usuario, u.activo, u.cuenta_acceso,
       EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r USING(id_rol)
               WHERE ur.id_usuario=u.id_usuario AND r.nombre='administracion') administrador
FROM usuario u WHERE u.id_usuario IN (:'destinatario'::bigint, :'responsable'::bigint);
SELECT id, usuario, activa, revision, concedido_por, concedida_en, motivo
FROM autorizacion_numeracion WHERE usuario=:'destinatario'::bigint;
\prompt 'Revision observada (0 sólo si no existe autorización): ' revision
\prompt 'Motivo autorizado (10-1000 caracteres): ' motivo
\prompt 'Escriba CONCEDER o REVOCAR seguido del ID destinatario: ' confirmacion
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT administrar_autorizacion_numeracion(
  :'destinatario'::bigint, :'responsable'::bigint, :'conceder'::boolean,
  :'motivo', :'revision'::bigint, :'confirmacion');
SELECT a.id, a.usuario, a.activa, a.revision, h.responsable, h.motivo, h.fecha, h.operador_bd
FROM autorizacion_numeracion a JOIN autorizacion_numeracion_historial h ON h.autorizacion_id=a.id
WHERE a.usuario=:'destinatario'::bigint ORDER BY h.id DESC LIMIT 1;
-- Revisar el resultado: ejecutar COMMIT sólo si coincide; en otro caso ROLLBACK.
```

4. Después del `COMMIT`, comprobar la fila y el evento persistidos y consultar
   `GET /pozos/numeracion` desde la sesión de la cuenta autorizada. No configurar
   ningún número como prueba. Guardar la evidencia privada de la intervención.

La función rechaza cuentas no administrativas/inactivas al conceder, responsables
no habilitados, motivos inválidos, confirmaciones distintas, revisiones obsoletas
y operaciones sin cambio. La revocación admite una destinataria ya deshabilitada.
Comparte el bloqueo administrativo con las configuraciones y cambios de roles.
Concesión/revocación y auditoría son una sola transacción: si falla la auditoría,
se revierte el permiso. El contexto se limpia al terminar; DML sin contexto falla.
No borrar autorizaciones: revocarlas conserva identidad y antecedentes.

Cada transición incrementa una revisión incluida en el desafío firmado. Revocar
y volver a conceder no resucita confirmaciones anteriores, aunque suceda dentro
del mismo milisegundo. El historial conserva ambas versiones, motivo, responsable,
fecha y cuenta de conexión SQL; no admite UPDATE, DELETE ni TRUNCATE. Los campos
de responsable/fecha/motivo de la fila actual describen su última transición;
la concesión original permanece en el historial. El operador propietario de la
base sigue siendo una identidad de infraestructura de confianza: estos controles
no pretenden impedir que ese propietario altere el esquema deliberadamente.

## Contrato de configuración

1. `GET /pozos/numeracion`: contador actual y capacidad de retroceso del actor.
2. `POST /pozos/numeracion/revision`: sólo lectura, recibe número y motivo.
   Devuelve disponibilidad, bloqueos, dirección, aviso de salto ≥100 y desafío.
3. `PUT /pozos/numeracion`: exige estado anterior, motivo 10–1000 caracteres,
   desafío firmado, `CONFIRMAR <número>` y declaración sobre carpetas físicas,
   referencias externas y sincronizaciones pendientes.

La firma dura cinco minutos y vincula actor, operación, número, motivo, contador,
mayor asignado, revisión del historial, autorización y disponibilidad. Reutilizar
una firma, cambiar el motivo, modificar el estado o usar otra cuenta falla.
La auditoría guarda el nonce único, identidad de autorización, estado verificado,
motivo, actor, fecha, valores y dirección. Un valor igual no se guarda ni audita.
La consulta/cancelación no consume desafíos ni escribe. Una respuesta de red perdida
requiere consultar el contador: no se vuelve a aplicar automáticamente.

`GET /pozos/numeracion/historial` es administrativo, sólo lectura, paginado de 30 en
30 por ID. Incluye movimientos del contador de configuración y rectificaciones;
los detalles completos de reservas permanecen en sus auditorías originales.

## Migración y recuperación

`025_control_administrativo_numeracion.sql` sólo cambia estructura: reemplaza la
dependencia cursor/máximo por validación de disponibilidad, asignación serializada
y unicidad. Agrega capacidad explícita y columnas de auditoría compatibles con
eventos anteriores. No cambia el contador, reservas o referencias ni concede permisos.
000–024 permanecen intactas. Los triggers de auditoría inmutable se conservan.

El backup integral formato 2 sigue incluyendo todas las tablas/secuencias y toda
la persistencia. Se probó restauración a una base nueva, comparando todas las tablas
y secuencias relevantes y verificando inmutabilidad. No se modifica el restaurador.
Instalar 025 antes del nuevo backend, sólo mediante un despliegue futuro autorizado.
No iniciar automáticamente un backend anterior sobre este modelo: desconocería
las reglas del cursor bidireccional y los nuevos campos de auditoría.

## Interfaz

Cinco secciones: próximo automático, pruebas, reservas individuales, reingreso
histórico e historial. Una herramienta visible por vez, identidad institucional,
resumen permanente, mensajes cercanos al campo y navegación adaptable.
El guardado se separa de la revisión y exige una frase escrita y declaración.
Cambiar campos o sección invalida la revisión; sólo una respuesta exitosa anuncia
guardado. Los errores conservan número/motivo para revisión, no una confirmación vieja.
El reingreso usa el formulario de 024 y conserva su borrador/fotografía; no se duplica.

## Verificación focalizada

- `api/test/control-numeracion.postgres.local.ts`: 22/22, incluyendo corrección de
  tipeo, huecos bajo el máximo, permisos, concurrencia, rollback, offline, DELETE
  antiguo, actualización 024→025 y dump/restore en PostgreSQL nuevo de Temp.
  La revisión añade concesión/revocación auditadas, bloqueo de DML sin contexto,
  privilegios SQL, revisión concurrente, fallo de auditoría y confirmaciones
  anteriores a una revocación/reconcesión. Reejecutado al cierre junto con
  reingreso (20/20), incluidos backup/restore, y TypeScript. La interfaz no cambió
  en esta revisión; se reutilizan sus pruebas, capturas y compilación aprobadas.
- Seguridad de eliminación: 20/20. Rectificación: 11/11. Reingreso: 20/20.
- Numeración previa: escenarios nuevo y equivalente al piloto satisfactorios.
- Angular: 38/38, incluyendo validaciones, cancelación, doble envío, sesión local,
  reingreso y distribución a 390/768/1366 px.
- `front/scripts/test-numeracion-visual.mjs`: build local, perfil Chrome descartable,
  API simulada, sin conexiones productivas. Capturas y resultados quedan en Temp.
  Omite el service worker únicamente en el navegador de prueba para interceptar
  todas las peticiones. No cambia su configuración en la aplicación.
- TypeScript y build Angular. Advertencia conocida de Stencil `empty-glob`, sin
  errores de compilación. `git diff --check` requerido al cierre.

Las referencias físicas y PDFs entregados no son comprobables automáticamente.
La disponibilidad en la base no sustituye la declaración del responsable.

## Archivos del cambio

- `api/db/migrations/025_control_administrativo_numeracion.sql`
- `api/src/routes/numeracion-perforacion.ts`
- `api/src/services/numeracion-perforacion-service.ts`
- `api/test/control-numeracion.postgres.local.ts`
- `api/test/administracion-eliminaciones.postgres.local.ts`
- `api/test/numeracion-perforacion-postgres.local.ts`
- `api/test/reingreso-historico.postgres.local.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.html`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.scss`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/rectificacion-numeracion.component.ts`
- `front/src/app/routes/pozos/pages/numeracion/reservas-eliminadas.component.ts`
- `front/src/app/shared/services/numeracion-perforacion.service.ts`
- `front/scripts/test-numeracion-visual.mjs`
- `docs/CONTROL_ADMINISTRATIVO_NUMERACION.md`
