# RSP-10 — Corrección forward-only de Sello sanitario

01/10/2026. Corrección preparada y validada localmente. No se accedió a la base piloto ni se ejecutaron migraciones sobre bases existentes. No hubo commit, push ni arranque de contenedores. Las migraciones de prueba se ejecutaron exclusivamente sobre un clúster PostgreSQL temporal creado para esta validación.

## Migración 010

[010_sello_sanitario_no_inicial.sql](../api/db/migrations/010_sello_sanitario_no_inicial.sql) contiene:

```sql
UPDATE catalogo_litologia
SET es_inicial = FALSE
WHERE codigo = 'sello_sanitario'
  AND es_inicial = TRUE;
```

El archivo ya estaba presente sin seguimiento al comenzar esta intervención; se conservó su contenido y se verificó como nueva migración real. Actualiza únicamente la clasificación de esa fila. No borra ni recrea la litología, ni cambia su id, nombre, familia, color, patrón, activo, orden, fechas o intervalos. Una repetición afecta cero filas. El runner existente controla la transacción del UPDATE y del registro del checksum en el ledger.

`009` y las migraciones `000..008` permanecen intactas. Tampoco se modificaron el runner, el verificador, código funcional de API ni frontend. El verificador debe seguir exigiendo exactamente las 29 litologías históricas iniciales.

El fallo informado del piloto sucede después de confirmar `009` y su ledger. La verificación final no revierte esas transacciones ya confirmadas. Por ello el runner puede reconocer `000..009`, aplicar únicamente `010` y verificar correctamente el esquema final.

## PostgreSQL aislado

Comando ejecutado desde `api`:

```powershell
node --experimental-strip-types test/sello-sanitario-postgres.local.ts
```

Motor: PostgreSQL **18.4**, instalado localmente. El script acepta como argumento opcional el directorio de binarios. Crea un directorio temporal propio, credenciales aleatorias y un puerto libre en `127.0.0.1`; confirma `data_directory` antes de los escenarios. No carga `.env` ni usa conexiones existentes. El clúster se detuvo y eliminó al terminar.

Los primeros intentos detectaron un problema de herencia de pipes de `pg_ctl` en Windows y de limpieza posterior. Se corrigió el arranque del proceso y se limpiaron sus temporales. La ejecución final terminó con código 0. No se arrancaron contenedores ni se accedió a sus bases.

| Comprobación | Escenario A: instalación limpia | Escenario B: equivalente al piloto |
| --- | --- | --- |
| Preparación | Base vacía en clúster propio | Runner con copia exacta de `000..009` |
| Estado previo | Sin esquema ni ledger | Ledger de 10 entradas hasta `009`; 30 iniciales y Sello sanitario `es_inicial=true`; mismo error de verificación final reproducido |
| Ejecución correctiva | Runner aplica `000..010`: 11 migraciones | Runner aplica sólo `010_sello_sanitario_no_inicial.sql`: 1 migración |
| Ledger final | 11 entradas, máximo `010` | 11 entradas, máximo `010`; prefijo anterior idéntico, incluidas fechas y checksums |
| Catálogo total / iniciales | 30 / 29 | 30 / 29 |
| Sello sanitario | Existe, activo, no inicial, `concrete`, `#999999`, orden 30 | Mismos valores; única diferencia de la fila: `es_inicial=false` |
| Verificación final real | PASS | PASS |
| Segunda ejecución del runner | Sin migraciones aplicadas; «Migraciones al día; no hay cambios pendientes.» | Sin migraciones aplicadas; mismo mensaje |
| Idempotencia SQL | Segunda ejecución de 010 afecta 0 filas | Segunda ejecución de 010 afecta 0 filas |
| Fallo artificial 011 | UPDATE y DDL revertidos; catálogo y ledger idénticos | UPDATE y DDL revertidos; catálogo y ledger idénticos |

También pasaron: conservación exacta de las 29 filas históricas y de los intervalos existentes; selección de Sello sanitario activo e inserción de un intervalo referenciado; independencia del booleano `pozo.sello_sanitario`; CHECK de color/patrón; conservación de código administrativo preexistente; colisiones por nombre exacto, normalizado y doble con SQLSTATE 23505 y rollback del DDL.

La verificación se realizó en PostgreSQL 18.4. No se ejecutó en PostgreSQL 16 del piloto. Los scripts históricos que arrancan contenedores se actualizaron y validaron sintácticamente, pero no se ejecutaron durante esta ventana.

## Tests y comprobaciones

| Comando / comprobación | Resultado |
| --- | --- |
| `npm.cmd test` desde `api` | PASS: 317 tests, 0 fallos |
| `node --test --experimental-strip-types test/migrator.test.ts test/migrator-cleanup-r7.test.ts test/native-auth-migration.test.ts test/sello-sanitario.test.ts` | PASS: 20 tests, 0 fallos; subconjunto de la suite backend |
| Prueba PostgreSQL anterior | PASS: ambos escenarios, cuatro conflictos e idempotencia/rollback |
| `npm.cmd run build` desde `api` | PASS |
| Parser PowerShell sobre los seis scripts modificados | PASS, sin errores de sintaxis |
| `git diff --check` | PASS |
| Diff de migraciones históricas, runner y frontend | Sin cambios |

## Referencias y archivos

`010` queda reservada para la corrección real. El fallo artificial se genera como `011_control_failure.sql` dentro de fixtures temporales; no se agregó una migración 011 al directorio real. Las expectativas de instalación, adopción, concurrencia, restauración y reejecución pasan de 10 a 11 entradas. Las referencias a `009` que permanecen describen el alta original o el estado previo del escenario B.

| Archivo | Objetivo |
| --- | --- |
| `api/db/migrations/010_sello_sanitario_no_inicial.sql` | Corrección puntual, idempotente y forward-only |
| `api/test/sello-sanitario.test.ts` | Descubrimiento de 010, alcance del UPDATE y selección normal del material activo/no inicial |
| `api/test/sello-sanitario-postgres.local.ts` | Escenarios A/B con runner real y PostgreSQL nativo aislado; idempotencia, conservación y rollback 011 |
| `scripts/test-data-lifecycle.ps1` | 11 entradas en fresh/adopción/concurrencia/restore; fallo artificial 011 |
| `scripts/test-development-migrations.ps1` | 11 entradas en instalación y rerun |
| `scripts/test-first-upgrade-from-main.ps1` | 11 entradas tras adopción y restauración |
| `scripts/test-rsp08a-migrations.ps1` | Última 010; upgrade aplica 007,008,009,010 |
| `scripts/test-rsp09b-native-auth.ps1` | Última 010; upgrade aplica 008,009,010 |
| `scripts/test-rsp09d-r6-lock-order.ps1` | Reporte de migraciones 000..010 |
| `docs/RSP10_DISENO_Y_VALIDACION.md` | Estado final no inicial, procedimiento forward-only y referencias 010/011 |
| `docs/RSP10_AJUSTES_FINALES.md` | Distingue validación histórica de 009 y corrección vigente |
| `docs/RSP10_CORRECCION_FORWARD_ONLY.md` | Este reporte |

## Git status al cierre

```text
 M api/test/sello-sanitario-postgres.local.ts
 M api/test/sello-sanitario.test.ts
 M docs/RSP10_AJUSTES_FINALES.md
 M docs/RSP10_DISENO_Y_VALIDACION.md
 M scripts/test-data-lifecycle.ps1
 M scripts/test-development-migrations.ps1
 M scripts/test-first-upgrade-from-main.ps1
 M scripts/test-rsp08a-migrations.ps1
 M scripts/test-rsp09b-native-auth.ps1
 M scripts/test-rsp09d-r6-lock-order.ps1
?? api/db/migrations/010_sello_sanitario_no_inicial.sql
?? docs/RSP10_CORRECCION_FORWARD_ONLY.md
```

Sin archivos staged, commit ni push. La base piloto permanece sin acceso desde esta intervención. La aplicación de 010 en el piloto queda pendiente de una ejecución operativa posterior autorizada.
