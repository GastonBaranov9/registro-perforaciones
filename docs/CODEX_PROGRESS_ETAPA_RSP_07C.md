# ETAPA RSP-07C — Migraciones, backups, restauración y bootstrap admin

Fecha de cierre técnico: 2026-08-13

Rama: `feature/rsp-07-produccion`

Fuentes de verdad: `docs/CODEX_AUDITORIA_RSP_07A_PRODUCCION.md` y `docs/CODEX_PROGRESS_ETAPA_RSP_07B.md`.

## 1. P1-05 — Migraciones

P1-05 queda resuelto. El repositorio ahora tiene un runner Node/TypeScript explícito, ledger, checksums SHA-256, advisory lock y transacción por migración. La API normal no ejecuta migraciones al arrancar.

La auditoría del estado anterior determinó:

- `api/db/scripts.sql` era un inicializador destructivo: comenzaba con `DROP TABLE ... CASCADE`.
- El mismo archivo creaba un esquema casi actual, incorporaba semánticamente 001, 002 y 005 y ejecutaba 003/004 mediante `\ir`.
- PostgreSQL ejecutaba `scripts.sql` únicamente al crear un volumen vacío porque `api/db` estaba montado en `/docker-entrypoint-initdb.d`.
- Una DB existente no recibía upgrades; no había tabla de tracking, lock ni comando operativo.
- Ejecutar `scripts.sql` y luego 001..005 habría duplicado cambios, y hacerlo sobre datos existentes habría sido destructivo.

RSP-07C retiró `scripts.sql` del flujo: conserva solo un mensaje de error y termina con código 3. También se retiró el montaje `/docker-entrypoint-initdb.d` de Compose.

## 2. Estrategia canónica de migraciones

La fuente de verdad es `api/db/migrations/`:

```text
000_initial_schema.sql
001_add_version_sesion.sql
002_add_tuberia_filtros.sql
003_catalogo_litologias.sql
004_propietario_operativo.sql
005_intervalo_filtro_ranura.sql
006_roles_base.sql
```

`000` representa el esquema histórico anterior a 001. De esta forma una instalación vacía recorre exactamente el mismo historial que una actualización. Se eliminaron los `BEGIN`/`COMMIT` internos de 002–004 porque el runner es el único dueño de la transacción.

El runner:

- admite únicamente nombres `NNN_nombre_en_snake_case.sql`;
- ordena por nombre y rechaza versiones duplicadas;
- calcula SHA-256 sobre los bytes del SQL;
- toma `pg_try_advisory_lock(707,3)` con timeout;
- crea `schema_migrations(version,nombre,checksum_sha256,aplicada_en)`;
- valida nombre y checksum de toda migración ya aplicada;
- aplica cada pendiente con `BEGIN`, SQL, registro de ledger y `COMMIT`;
- hace `ROLLBACK` y devuelve exit code no-cero ante fallo;
- verifica el esquema baseline después de ejecutar;
- en una segunda ejecución informa no-op.

Comando dentro de la imagen:

```powershell
docker compose --env-file <env-prod> -f docker-compose.production.yaml --profile ops run --rm migrate
```

El servicio `migrate` tiene `restart: "no"` y no está activo fuera del perfil `ops`.

### Convención futura

La próxima migración será `007_descripcion_breve.sql`, después `008_...`, siempre ascendente y sin saltos ambiguos. Una migración que haya sido aplicada en cualquier entorno compartido no se edita, renombra ni reordena: se crea otra migración. El SQL no debe contener `BEGIN`, `COMMIT`, `ROLLBACK` ni comandos `psql` porque el runner controla transacción y protocolo.

Cada cambio futuro debe probar:

1. instalación vacía 000..N;
2. actualización N-1 → N con datos;
3. segunda ejecución no-op;
4. rollback de la migración ante fixture fallido;
5. compatibilidad hacia atrás con la imagen anterior cuando forme parte de un deploy expand/contract.

## 3. Fresh install

Procedimiento canónico para servidor vacío:

```powershell
docker compose --env-file <env-prod> -f docker-compose.production.yaml up -d postgres
docker compose --env-file <env-prod> -f docker-compose.production.yaml --profile ops run --rm migrate
```

Después se ejecuta el bootstrap admin una vez y recién entonces se inicia el resto del stack. No se copia SQL manualmente y PostgreSQL no interpreta automáticamente archivos del repositorio.

La prueba aislada creó un volumen nuevo, aplicó 000..006, verificó siete filas de ledger, ejecutó nuevamente el runner y confirmó cero pendientes.

## 4. Adopción de una DB existente

Una base con tablas pero sin `schema_migrations` se rechaza por defecto. La adopción requiere el argumento explícito:

```powershell
docker compose --env-file <env-prod> -f docker-compose.production.yaml --profile ops run --rm migrate npm run db:migrate -- --adopt-current-schema
```

La adopción verifica antes de registrar 000..005:

- conjunto de tablas actual;
- columnas y nullability de `usuario`;
- `cuenta_acceso` y `version_sesion` con defaults/constraints;
- tubería, filtro/ranura e `id_litologia`;
- FK e índices del catálogo/filtros;
- función de normalización;
- las 29 litologías iniciales por código.

Si una comprobación falla no crea ledger. Si coincide, registra explícitamente 000..005 con los checksums actuales y luego el runner aplica 006 normalmente. Se probó una adopción compatible y el rechazo de un esquema incompatible. No se modificó la DB real de desarrollo.

## 5. P1-06 — Backup y recuperación

P1-06 queda resuelto en herramientas y ensayo local. El destino se configura mediante `BACKUP_DIR`; debe ser persistente e independiente de los volúmenes DB/fotos.

El wrapper `ops/backup.ps1` detecta si API está operando, la detiene, ejecuta el one-shot `backup` y la vuelve a iniciar en `finally`, incluso si el backup falla. PostgreSQL permanece online y `pg_dump` obtiene su snapshot consistente. Como la API es la única escritora de DB/fotos, la ventana sin API impide cambios entre dump y archivo de fotos.

No se usa `docker compose down` ni se detiene PostgreSQL.

Comando:

```powershell
powershell -ExecutionPolicy Bypass -File ops/backup.ps1 `
  -EnvFile <env-prod> `
  -ProjectName <proyecto-compose> `
  -BackupDir <ruta-absoluta-independiente>
```

## 6. Formato del backup

Cada bundle terminado es un directorio `rsp-backup-YYYYMMDDTHHMMSSZ`. Se construye primero como directorio oculto temporal con `umask 077` y solo se renombra al nombre definitivo después de completar y sincronizar todos sus archivos.

Contenido:

```text
rsp-backup-YYYYMMDDTHHMMSSZ/
  database.dump
  photos.tar.gz
  manifest.txt
```

- `database.dump`: `pg_dump --format=custom --no-owner --no-acl`.
- `photos.tar.gz`: raíz canónica `fotos/`, incluida `.trash` si existe.
- `manifest.txt`: formato 1, estado `complete`, ID/timestamp UTC, versión app, nombres, tamaños, SHA-256 y ledger completo versión/nombre/checksum.

No incluye `.env`, password PostgreSQL, `FASTIFY_SECRET`, key Maps, cookies, tokens ni password bootstrap. Un bundle incompleto permanece oculto y se elimina mediante trap; no se presenta como válido.

## 7. Consistencia DB/fotos

La estrategia del piloto es una breve ventana de mantenimiento de escrituras:

```text
detener API
→ pg_dump online
→ archivar volumen de fotos read-only
→ escribir/verificar manifest
→ publicar bundle por rename
→ reanudar API en finally
```

Se prioriza consistencia sobre disponibilidad durante los segundos del backup. Esto es válido para la única réplica escritora prevista por RSP-07B. Si aparecen otros escritores deberán integrarse a la misma barrera de mantenimiento.

## 8. Restore

`ops/restore.ps1` y el one-shot `restore` requieren simultáneamente:

- bundle explícito con nombre reconocido;
- confirmación exacta `RESTORE_EMPTY_TARGET`;
- API detenida/no operativa;
- DB destino sin tablas públicas;
- volumen de fotos vacío, permitiendo solo `.trash` vacío.

Antes de mutar verifican manifest, formato, estado, ID, nombres permitidos, tamaños, ambos SHA-256 y rutas seguras del tar. Después:

1. extraen fotos a staging;
2. ejecutan `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`;
3. comparan el ledger restaurado con el manifest;
4. ejecutan `ANALYZE`;
5. promueven `fotos/` y fijan UID/GID 1000;
6. arrancan API, esperan salud y comprueban `/ready`.

Comando:

```powershell
powershell -ExecutionPolicy Bypass -File ops/restore.ps1 `
  -EnvFile <env-prod-destino> `
  -ProjectName <proyecto-compose-destino> `
  -BackupDir <ruta-backups> `
  -Bundle rsp-backup-YYYYMMDDTHHMMSSZ `
  -Confirm RESTORE_EMPTY_TARGET
```

No restaura silenciosamente sobre una DB activa. Si una restauración excepcional debe reemplazar una DB existente, se provisiona primero una DB/volumen vacío y se cambia a ella después del smoke test.

## 9. Retención y offsite

`ops/prune-backups.ps1` implementa la política 14 diarios, 8 semanales y 6 mensuales. Es dry-run por defecto; `-Apply` habilita eliminación. Solo considera directorios hijos directos con nombre propio, manifest completo y checksums válidos. Siempre preserva el backup válido más reciente y valida nuevamente la ruta exacta antes de `Remove-Item`.

```powershell
# Vista previa
powershell -ExecutionPolicy Bypass -File ops/prune-backups.ps1 -BackupDir <ruta>

# Aplicar después de revisar la salida
powershell -ExecutionPolicy Bypass -File ops/prune-backups.ps1 -BackupDir <ruta> -Apply
```

El scheduling queda para deployment. También queda como requisito operacional copiar bundles completos y verificados fuera del servidor principal, con transporte y almacenamiento cifrados. Un `BACKUP_DIR` en el mismo disco físico no cubre pérdida total y no satisface recuperación real.

Objetivos razonables para el piloto: **RPO de 24 horas** (más un backup obligatorio antes de cada actualización) y **RTO de 4 horas** ante pérdida total. La restauración se ensaya al menos mensualmente durante el piloto y el simulacro de pérdida total, trimestralmente. Estos objetivos dependen de configurar el scheduling y la copia off-server en el despliegue real.

## 10. P1-09 — Bootstrap admin

P1-09 queda resuelto. `npm run bootstrap:admin` es un comando one-shot sin endpoint HTTP ni ejecución al arrancar API. El upsert inseguro fue eliminado.

Comportamiento:

- valida email, nombre y política de password existente;
- calcula bcrypt con costo 12 mediante el servicio canónico;
- toma advisory transaction lock;
- aborta si existe cualquier usuario con rol `administracion`, activo o inactivo;
- exige que migraciones hayan creado el rol;
- inserta una cuenta nueva, activa y `cuenta_acceso=TRUE`;
- asigna el rol dentro de la misma transacción;
- ante email usado o fallo de rol ejecuta rollback;
- nunca actualiza, reactiva ni resetea un administrador;
- muestra únicamente éxito o un error sanitizado.

El servicio Compose `bootstrap-admin` usa perfil `ops`, `restart: "no"` y no entrega la password a la API normal.

## 11. Entrega del secreto bootstrap

La vía recomendada es un archivo temporal montado read-only:

```powershell
docker compose --env-file <env-prod> -f docker-compose.production.yaml --profile ops run --rm `
  -e ADMIN_EMAIL=<email> `
  -e "ADMIN_NAME=<nombre>" `
  -e ADMIN_PASSWORD_FILE=/run/secrets/admin-password `
  -v <ruta-absoluta-secreto>:/run/secrets/admin-password:ro `
  bootstrap-admin
```

También se admite `--password-stdin`. `ADMIN_PASSWORD` directo queda restringido a development/tests y se rechaza en `NODE_ENV=production`. La password no se guarda en `.env.example`, argumentos, manifest ni logs. Después del alta se elimina el archivo temporal de forma segura y se verifica login.

## 12. Prueba de desastre aislada

`scripts/test-data-lifecycle.ps1` usa dos project names con prefijo `rsp07c-data-*`, credenciales aleatorias en el temp del sistema y volúmenes propios. El flujo real probado fue:

```text
origen vacío
→ migrate 000..006
→ rerun no-op
→ rollback/checksum/lock/adopción
→ bootstrap + login
→ propietario + perforador + sitio + pozo
→ litología + diámetro + filtro 0,75 + aporte + foto
→ backup coordinado
→ destino totalmente vacío
→ rechazo de copia corrupta antes de mutar
→ restore válido
→ relaciones + login + SHA foto + readiness + PDF
```

Evidencia final:

```json
{"migrations_fresh":7,"rerun_noop":true,"checksum_rejected":true,"rollback_ok":true,"concurrent_lock":true,"adoption_ok":true,"adoption_rejected":true,"bootstrap_login":true,"bootstrap_second_rejected":true,"corrupt_restore_rejected":true,"restored_relations":true,"restored_photo_sha256":"32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af","restored_pdf_bytes":71776,"ready":"ok"}
```

Los stacks, redes, volúmenes, bundle y secretos temporales se eliminaron en `finally`. No se consultó Google ni se tocó la DB/volúmenes normales.

## 13. Instalación y actualización operativa

### Instalación nueva

1. Crear el archivo de entorno production sin versionarlo.
2. Preparar `BACKUP_DIR` persistente e independiente.
3. Levantar solo PostgreSQL.
4. Ejecutar `migrate` one-shot.
5. Ejecutar `bootstrap-admin` una sola vez mediante archivo/stdin.
6. Eliminar el secreto temporal.
7. Levantar API/frontend/proxy.
8. Comprobar `/api/health`, `/api/ready` y login admin.

### Update futuro

1. Ejecutar backup coordinado y comprobar bundle/manifest.
2. Obtener las nuevas referencias inmutables de imagen.
3. Ejecutar `migrate` una vez; abortar el rollout si falla.
4. Actualizar API/frontend.
5. Esperar health/readiness.
6. Ejecutar smoke de login, lectura, escritura controlada, foto y PDF.

Las migraciones se diseñan expand/contract. Un rollback de aplicación vuelve al digest anterior sin deshacer automáticamente datos; una migración destructiva excepcional requiere ventana de mantenimiento y restore del bundle coordinado.

## 14. P1 restantes

| ID | Estado |
|---|---|
| P1-05 | Resuelto en RSP-07C. |
| P1-06 | Resuelto en herramientas y restore real aislado; la copia off-server debe configurarse al desplegar. |
| P1-09 | Resuelto en RSP-07C. |
| P1-08 | Continúa abierto exclusivamente para TLS, dominio y reverse proxy HTTPS final en RSP-07D. |

## 15. Riesgos residuales

- `BACKUP_DIR` sin copia off-host no protege pérdida física total.
- Los bundles contienen datos personales y hashes de contraseña: el destino off-server debe cifrarlos en tránsito y reposo y limitar el acceso operativo.
- La automatización horaria de backup/prune queda para deployment; las herramientas son invocables y verificables.
- La ventana breve de mantenimiento presupone una sola API escritora.
- `pg_restore` exige destino vacío; no existe restore in-place deliberadamente.
- Cambiar migraciones 000..006 a partir de este cierre provocará correctamente un rechazo de checksum en bases ya adoptadas/aplicadas.
- El volumen local y una réplica continúan siendo decisión de piloto; S3 y múltiples réplicas están fuera de alcance.
- TLS/dominio/P1-08 permanece sin abordar por instrucción expresa.

## 16. Validaciones de cierre

- DB vacía 000..006 y rerun no-op.
- Migración fixture fallida sin DDL parcial ni ledger.
- Checksum modificado rechazado.
- Dos runners concurrentes: uno aplica y el otro espera/no-op.
- Adopción compatible aceptada e incompatible rechazada sin ledger.
- Bootstrap, bcrypt, rol, cuenta activa, login y segunda ejecución rechazada.
- Backup custom + fotos + manifest + checksums.
- Bundle corrupto rechazado antes de mutar destino.
- Restore en DB/volumen vacío, relaciones, foto, login, readiness y PDF.
- API: `npm run build` y suite completa, **196/196** pruebas.
- Frontend: build Angular production correcto; no hubo cambio funcional frontend.
- Docker/Compose: build y dos stacks aislados en la prueba de desastre; config production con perfil `ops` y development válidas.
- Operación: sintaxis POSIX de `backup.sh`/`restore.sh` dentro de PostgreSQL 16.14 y sintaxis de cinco scripts PowerShell correctas.
- Higiene: `git diff --check` y búsqueda focalizada de claves privadas, API keys, URLs PostgreSQL con password y asignaciones de password sin hallazgos.
- Limpieza: sin contenedores ni volúmenes `rsp07c-data-*` remanentes.
