# Sello sanitario constructivo: base de datos y backend

## Archivos

Creados:

- `api/db/migrations/020_sello_sanitario_constructivo.sql`
- `api/src/services/sello-sanitario-service.ts`
- `api/test/sello-sanitario-constructivo.test.ts`
- `api/test/sello-sanitario-constructivo.postgres.local.ts`
- `docs/SELLO_SANITARIO_ETAPA_1.md`

Modificados:

- `api/src/models/schemas.ts`
- `api/src/models/historicos.ts`
- `api/src/services/pozo-completo-service.ts`
- `api/src/services/historicos-service.ts`
- `api/src/services/pozos-services.ts`
- `api/src/services/generar-informe-consultas.ts`
- `api/src/services/intervalos-litologicos-services.ts`
- `api/src/services/litologia-provisional.ts`
- `api/src/services/litologias-services.ts`
- `api/src/services/pendientes-service.ts`
- `api/test/historicos.postgres.local.ts`
- `api/test/provisionales.postgres.local.ts`
- `api/test/numeracion-perforacion-postgres.local.ts`

## Datos y contrato

La migración `020_sello_sanitario_constructivo.sql` agrega una tabla opcional
`sello_sanitario_pozo`, con una fila por pozo y límites `NUMERIC` sin precisión
fija, igual que los intervalos técnicos. La FK elimina el sello al borrar el
pozo. Los CHECK locales exigen un rango creciente, no negativo y finito.

El contrato nuevo es `sello_sanitario_constructivo: { desde_m, hasta_m } | null`.
Se envía al mismo nivel que los intervalos en las operaciones completas normales
y como propiedad del cuerpo histórico. En creación, omisión y null no registran
sello. En edición, omisión conserva la fila sin reescribirla, null la elimina y
un objeto la inserta o actualiza. Las respuestas completas, históricas, el detalle
y la consulta técnica exponen el rango o null. El booleano legado
`pozo.sello_sanitario` sigue intacto y nunca genera un intervalo constructivo.

La migración identifica exclusivamente la FK al código `sello_sanitario` y exige
su nombre canónico `Sello sanitario`. No utiliza material libre, provisionales ni
nombres normalizados. Bloquea escrituras, valida candidatos, copia sus valores
NUMERIC directamente, comprueba igualdad y cantidades antes de eliminar sólo las
filas fuente. Duplicados por pozo, rangos inválidos, excesos o nombre inesperado
abortan la transacción completa. Sin candidatos se crea una tabla vacía. Las
migraciones 009 y 010 no cambian. El catálogo canónico queda inactivo y un CHECK
impide reactivarlo; los servicios también rechazan explícitamente su ID.

Se reservan los textos literales `Sello sanitario` y `sello_sanitario`, después de
recortar espacios exteriores. No se aplica coincidencia aproximada. Las
ocurrencias antiguas sin FK no se migran: si contienen esos textos reservados,
deben revisarse explícitamente antes de volver a enviarlas como litología.

No se agrega un trigger entre tablas. Las escrituras permitidas del sello están
dentro de las transacciones de alta/edición normal e histórica. Las ediciones
comparten el advisory lock 606 del pozo y bloquean su fila; validan el sello
efectivo contra la profundidad resultante, incluso si el sello fue omitido. La
edición legada de profundidad adquiere los mismos bloqueos y valida el sello
persistido. También abre una transacción cuando se invoca directamente con el
pool fuera de una sesión HTTP. Un cliente inyectado debe pertenecer a la
transacción del llamador. El SQL manual que saltee los servicios no queda cubierto
por la validación de profundidad entre tablas.

El frontend vigente todavía no permite cargar el nuevo campo. SVG, PDF y
APK/offline quedan para etapas posteriores. Al migrar un estrato ficticio puede
quedar litología desconocida en ese rango: no se reconstruye ni extiende terreno.

## Validación enfocada

Desde `api`, los nuevos tests son:

```
node --test --experimental-strip-types test/sello-sanitario-constructivo.test.ts
node --test --experimental-strip-types test/sello-sanitario-constructivo.postgres.local.ts
```

La integración crea y destruye su propio clúster temporal, con puerto loopback
dinámico y credenciales aleatorias. No lee `.env` ni usa bases existentes. Por
defecto usa PostgreSQL 17 en Windows; `RSP_SELLO_PG_BIN` permite indicar otro
directorio de binarios. Verifica migración, rollback completo, catálogo retirado,
coexistencia con terreno, ambos flujos, lectura y serialización HTTP.
