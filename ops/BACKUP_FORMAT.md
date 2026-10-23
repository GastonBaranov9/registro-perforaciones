# Respaldo coordinado: formato 2

`backup.ps1` confirma que API está detenida; `deploy.sh` hace la misma
comprobación. El preflight debe haber identificado y bloqueado cualquier otro
escritor, incluidos procesos externos a Docker. La pausa se conserva durante
la captura y verificación; durante deploy permanece hasta superar el smoke.
El respaldo rechaza otras sesiones de cliente y transacciones preparadas en
PostgreSQL. Compara datos, secuencias e inventario del volumen antes/después:
cualquier diferencia o error impide publicar un bundle exitoso.

Cada bundle contiene:

- `database.dump`: PostgreSQL custom; se lee completo con `pg_restore`, incluidos
  los bloques de datos comprimidos, antes de admitirlo.
- `persistent-files.tar.gz`: una sola copia de **todo** `/data`, incluidos `fotos`,
  cuarentenas, archivos ocultos y otros directorios. No se duplica `photos.tar.gz`.
- `persistence.inventory`: rutas, tipos, permisos, propietarios, tamaños y SHA-256
  de todos los archivos; se contrasta con una extracción completa y con el origen.
- `database.state`: conteos y fingerprints de tablas, más valores de secuencias.
- `manifest.txt`: formato, versión, migraciones, metadatos PostgreSQL y ventana
  UTC de captura consistente.
- `SHA256SUMS`: checksums de los cinco archivos anteriores, comprobados al cerrar.

No se admiten enlaces, archivos especiales, nombres con controles/backslash ni
residuos internos de restauraciones. Se detiene el respaldo sin omitirlos. Los
errores de lectura, copia, extracción, checksum o consistencia no producen
`BACKUP_VERIFIED_FULL`. Ambos deploy exigen esa evidencia del mismo bundle antes
de migrar. Los respaldos fallidos no se publican como completos.

El destino debe estar fuera de Git y protegido por permisos del host. En Windows
deben conservarse las ACL privadas del directorio de respaldos: `umask 077` dentro
del contenedor no sustituye las ACL NTFS del bind mount. El inventario también es
privado. Se necesita espacio para el archivo comprimido y su extracción temporal.

## Restauración y compatibilidad

El restaurador actualizado acepta formato 1 (semántica histórica: DB + `fotos`)
y formato 2 (DB + volumen completo). **Los scripts antiguos no restauran formato
2**; conservar junto a los respaldos la versión de estos scripts. Los complementos
externos `persistent-files.tar.gz` de bundles antiguos siguen requiriendo su
procedimiento complementario documentado; no se interpretan automáticamente.

En formato 2 se comprueban checksums y extracción, se restaura PostgreSQL en la
base de staging existente y se comparan datos/secuencias antes del intercambio.
Si falla antes de confirmar el cambio de base, se compensan también las entradas
fuera de `fotos`. Se conservan permisos y propietarios del volumen. Los modos de
confirmación y la prohibición de restaurar automáticamente desde deploy no cambian.
La purga existente ignora formato 2: no elimina estos nuevos respaldos.

## Pruebas focalizadas (sin producción)

`node scripts/test-backup-persistence.mjs` crea PostgreSQL sin red externa, sin
puertos y sin montajes productivos, y conserva su contenedor detenido al terminar.
Prueba captura, restauración real, compensación, formato 1 y fallos de copia,
integridad, omisiones y cambios concurrentes con datos sintéticos.

`test-backup-pause-mocks.ps1` verifica la pausa sin acceder a Docker.
`test-deploy-maintenance-mocks.ps1 -BackupOnly` y
`BACKUP_ONLY=true sh scripts/test-deploy-maintenance-mocks.sh` verifican que los
fallos del respaldo bloqueen las migraciones y conserven mantenimiento/API detenida.
