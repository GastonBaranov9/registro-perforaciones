# Rectificación excepcional de numeración

La eliminación de una perforación no libera su número. La reserva permanente
conserva el ID original y la fecha de asignación; el contador avanza dentro de
la misma transacción que crea la perforación. Eliminar tampoco revierte los
documentos o referencias que ya se hayan entregado fuera del sistema.

## Decisión previa

La opción conservadora es mantener las reservas y continuar la numeración.
Para recuperar un número de una prueba eliminada, administración debe confirmar
que fue una prueba y que no existen PDFs entregados, referencias externas ni
copias pendientes de sincronización. Si no puede comprobarlo, no habilitar la
reutilización. Recuperar el número no recupera los datos o fotografías eliminados.

## Operación implementada (requiere migración 022)

- Exclusiva de una cuenta administrativa activa, con comprobación de permisos
  en la ruta y dentro de la transacción. Perforadores y operadores administrativos
  no pueden ejecutarla.
- Mostrar una vista previa de números, IDs originales, fechas de asignación y
  contador anterior/nuevo. Exigir motivo, declaración sobre referencias externas
  y confirmación explícita. No inferir disponibilidad de la ausencia de un pozo.
- Anular únicamente reservas finales de pruebas eliminadas, identificadas expresamente
  en la vista previa (máximo 100). El contador debe estar inmediatamente después
  del mayor asignado; los saltos de configuración manual requieren otro análisis.
  Conservar íntegramente la reserva original en un historial permanente, vinculada
  a la rectificación y a cualquier asignación posterior; no sobrescribir su identidad.
- Auditar actor, fecha de base de datos, motivo, reservas originales y valores
  anteriores/nuevos de próximo y mayor asignado. Una falla de auditoría debe
  revertir toda la rectificación.
- Usar la protección de sesión existente y bloquear la fila de numeración
  `FOR UPDATE`, compartiendo el mecanismo de serialización de las asignaciones.
  Verificar nuevamente el estado esperado, las reservas y la ausencia de pozos,
  referencias internas y resultados de creación idempotente antes de escribir.
  Cualquier conflicto implica rollback completo, sin reintentos automáticos.
- Preservar unicidad de reservas vigentes y de números de perforaciones. No
  modificar números de registros existentes ni el rango histórico protegido.
  No basta con bajar `proximo`: actualmente debe ser mayor que `mayor_asignado`;
  la operación recalcula ambos valores desde las reservas y registros que quedan,
  sin retroceder el límite histórico. Las reservas anuladas se archivan antes de
  retirar su exclusividad, dentro de la misma transacción. La tabla
  `numeracion_rectificacion` conserva la historia y rechaza UPDATE, DELETE y TRUNCATE.
- La eliminación normal seguirá sin anular reservas. Los PDFs existentes no se
  reescriben; cualquier referencia externa incompatible bloquea esta operación.

La migración 022 sólo crea la auditoría y su protección; aplicarla no rectifica
ningún número. La operación se ofrece por separado en la pantalla administrativa
de numeración, exige escribir `RECTIFICAR` y nunca se ejecuta al eliminar.
La vista previa utiliza GET `/pozos/numeracion/rectificacion/:desde`; la ejecución
explícita utiliza POST `/pozos/numeracion/rectificacion` con motivo, declaración,
contador esperado e identidades y fechas completas de las reservas. Un error
invalida la vista previa; no hay reintentos automáticos.

Una reserva con referencia de creación offline o histórica se rechaza incluso
si su perforación ya fue eliminada. No se borran claves de idempotencia ni se
modifican PDFs, fotografías, IDs o secuencias de perforaciones. La reutilización
posterior genera una identidad nueva. Un PDF o referencia externa existente
impide usar esta operación aunque la base no pueda detectarlo por sí sola.

Prueba PostgreSQL focalizada (clúster nuevo, datos ficticios, puerto loopback
aleatorio, sin leer `.env`): desde `api`, ejecutar
`node --experimental-strip-types test/rectificacion-numeracion.postgres.local.ts`.
Admite como argumento opcional el directorio de binarios PostgreSQL. Verifica
autorización, conflictos, asignaciones concurrentes, rollback ante fallos,
auditoría, conservación de registros y secuencias. Detiene su propio clúster
al terminar y conserva su directorio temporal; nunca accede al Docker productivo.

Publicar, desplegar y ejecutar una rectificación sobre datos reales requieren
autorización independiente. Ninguno de esos pasos forma parte de estas pruebas.

## Confirmación de eliminación implementada

El listado compartido por web y móvil exige escribir `ELIMINAR`, identifica el
número y el ID, advierte sobre datos, fotografías y reserva, y ofrece cancelar.
Cerrar o retroceder cancela; la petición se envía únicamente después de una
confirmación válida y una nueva comprobación del rol administrativo. Se bloquean
solicitudes simultáneas. La pantalla offline conserva su operación distinta:
elimina borradores o copias locales, nunca la perforación del servidor.
