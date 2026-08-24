# RSP-07F-R7 — Permisos POSIX, secretos exactos y liberación del migrador

## 1. Alcance y resultado

Se cerraron los tres hallazgos del review global de RSP-07F-R6:

- la cadena POSIX host-invoked queda registrada como ejecutable en Git;
- `PGPASSWORD` llega sin `trim` tanto al migrador como al pool runtime;
- el cliente del migrador se libera aun si falla `pg_advisory_unlock`.

No se cambiaron reglas funcionales, migraciones, frontend, secretos reales ni infraestructura externa.

## 2. Causa del P1 y modos anteriores

Todos los `.sh` estaban registrados como `100644`. En Windows, `core.filemode=false` ocultaba el problema en el filesystem local, pero un checkout Linux respetaba el índice Git: `scripts/deploy.sh` no podía iniciarse mediante `./scripts/deploy.sh` y, aun usando `sh scripts/deploy.sh`, su `exec` hacia `ops/deploy.sh` terminaba en `Permission denied`. Deploy y rollback también llaman directamente a helpers sin prefijar `sh`.

## 3. Clasificación de la cadena POSIX

Se auditaron referencias, shebangs y forma de invocación de todos los scripts operativos:

- ejecución directa y modo requerido `100755`: `scripts/deploy.sh`, `ops/deploy.sh`, `ops/rollback.sh`, `ops/prepare-photo-storage.sh` y `ops/smoke.sh`;
- módulos cargados únicamente mediante `.` y conservados en `100644`: `ops/deployment-state.sh`, `ops/deployment-audit.sh` y `ops/secret-file.sh`;
- entrypoints invocados explícitamente mediante `/bin/sh` y conservados en `100644`: `ops/backup.sh`, `ops/restore.sh`, `ops/photo-storage-migrate.sh` y `proxy/start.sh`.

Los cinco ejecutables usan `#!/bin/sh`; no se cambió el shell objetivo ni se marcaron indiscriminadamente tests u otros scripts no relacionados.

## 4. Modos Git finales y checkout Linux

Los cinco cambios se registraron en el índice mediante `git update-index --chmod=+x`, independientemente de `core.filemode`. `git ls-files -s` confirma `100755` y `git diff --summary` registra cada transición `100644 => 100755`.

`scripts/test-rsp07f-r7-contracts.ps1` genera un tar desde `git archive HEAD` y lo extrae dentro de Linux en un path con espacios. Esto valida los permisos recibidos desde Git, no los permisos artificiales de un bind mount Windows. El checkout ejecuta directamente launcher y rollback, comprueba los helpers, ejecuta `sh -n` y reutiliza RSP-07F-R5 para cubrir raíz, subdirectorio, CWD externo y argumentos con espacios/caracteres especiales. Resultado: `RSP07F_R7_LINUX_CHECKOUT_OK`, sin `Permission denied`.

## 5. Causa del P2 de password

`api/src/db/operaciones-config.ts` obtenía todas las variables mediante `env[nombre]?.trim()`. El helper `valor()` de runtime aplicaba la misma normalización antes de construir `runtime.postgres.password`. Compose, en cambio, entrega `PGPASSWORD` exactamente a PostgreSQL. Una contraseña con whitespace significativo producía credenciales distintas entre servidor, migrador y API.

## 6. Preservación exacta de secretos PostgreSQL

Ambas rutas usan ahora un lector exclusivo para `PGPASSWORD`:

- `undefined` es inválido;
- longitud cero es inválida;
- espacios, tabs y Unicode se conservan exactamente;
- una cadena formada sólo por espacios es válida si ésa es la contraseña configurada;
- no se normaliza Unicode, casing ni extremos.

Host, puerto, usuario, database, origins, paths y demás campos continúan con su normalización previa. Los contratos `PASSWORD_FILE` de RSP-07F-R2 no fueron modificados.

## 7. Prueba PostgreSQL real

`scripts/test-rsp07f-r7-postgres-password.ps1` inicia PostgreSQL 16 en un contenedor/red efímeros con una contraseña fixture que contiene espacios, tabs y Unicode. Después autentica por TCP mediante:

1. `cargarConfigDbOperaciones()` y un `Pool` como el migrador;
2. el `myPool` runtime real.

Ambos clientes autenticaron con el valor exacto. El test no imprime la contraseña y elimina contenedor, red y probes temporales en `finally`.

## 8. Causa del leak del migrador

El `finally` anterior ejecutaba primero `await soltarLock(client)` y después `client.release()`. Una caída de conexión durante `pg_advisory_unlock` rechazaba la primera operación y saltaba la segunda; el CLI podía llegar a `pool.end()` con el cliente aún checked-out y quedar esperando.

## 9. Unlock, release y prioridad de errores

`ejecutarMigraciones()` registra si existe un error principal y usa una liberación anidada:

1. intenta siempre `pg_advisory_unlock` cuando el lock fue adquirido;
2. ejecuta `client.release()` desde el `finally` interior;
3. si unlock falla, pasa ese error a `release(error)` para que `pg` descarte la conexión potencialmente rota;
4. si la migración ya había fallado, conserva y propaga ese error principal y registra sólo un mensaje controlado sobre el unlock;
5. si la migración terminó bien pero unlock falla, propaga el error de unlock después de liberar.

El logger es best effort y tampoco puede impedir `release`. Lock exclusivo, orden, checksums, ledger, adopción y transacciones por migración permanecen intactos.

## 10. Pruebas de cleanup y ausencia de hang

Las regresiones del migrador cubren:

- success: unlock, release y `pool.end()`;
- error de migración: rollback, unlock, release y causa original;
- unlock fallido/conexión caída: release con descarte y `pool.end()` dentro de un timeout corto;
- migración y unlock fallidos: prevalece el error de migración, el fallo de unlock se registra sin detalles y release ocurre;
- un segundo migrador puede completar después de la recuperación;
- la secuencia normal conserva advisory lock antes de unlock/release.

## 11. Validación final

- API build TypeScript: OK.
- API suite completa: 244/244 tests.
- pruebas focalizadas de configuración/migrador: 17/17.
- checkout Linux desde `git archive HEAD`: OK.
- regresión RSP-07F-R5 PowerShell/POSIX: OK; launcher desde tres CWD, argumentos exactos y audits no-op preservados.
- integración PostgreSQL con whitespace/tabs/Unicode: `RSP07F_R7_PASSWORD_EXACT_OK`.
- sintaxis `sh -n` de los 12 scripts operativos clasificados: OK.
- parser PowerShell de los dos tests R7: OK.
- `docker compose -f docker-compose.production.yaml config --quiet` con valores fixture: OK.
- frontend no se recompiló porque R7 no modifica frontend ni contratos consumidos por él.
- escaneo del delta para claves privadas y tokens comunes: sin hallazgos.
- `git diff --check`: OK.
- recursos temporales: sin contenedores, redes, archivos probe ni directorios R7 remanentes.

## 12. Hallazgos cerrados

Quedan cerrados el P1 de permisos POSIX, el P2 de normalización de `PGPASSWORD` y el P2 de cliente checked-out ante unlock fallido. También permanecen verdes el launcher independiente del CWD, audits preflight no-op, restore/backup, login limiter, heartbeat/reconexión WebSocket, Origin estricto y compensación de fotos.

## 13. Pendiente fuera de etapa y commits

**P2-10 autenticación Android** permanece pendiente y fuera de RSP-07F-R7. Requiere diseñar el contrato nativo de cookies/CSRF/Origin sin debilitar la aplicación web.

Commits locales:

- `4d9476e` — `fix(ops): marcar scripts POSIX como ejecutables`
- `5f6938c` — `fix(db): preservar passwords PostgreSQL exactas`
- `a1b1037` — `fix(db): liberar siempre cliente de migraciones`
- `81ff4ab` — `test(prod): cubrir permisos secretos y unlock fallido`

La documentación se entrega en un commit separado. No hubo push, merge, rebase, reset, clean, deploy externo ni cambio de rama.
