# ETAPA RSP-07F-R1 — Estado de deploy, origins y migraciones development

Fecha de cierre: 2026-08-14. Rama: `feature/rsp-07-produccion`. HEAD inicial verificado: `d1278e31e2d3e1461c91a90bf0db50bf7224b6b1`, con árbol limpio.

## 1. Resultado del review

Los tres hallazgos quedaron cerrados:

- **P1 deploy-state:** resuelto. Un deploy exitoso persiste las refs exactas y rollback vuelve a persistir N.
- **P2 Origins:** resuelto. HTTP comparte la allowlist canónica de `PUBLIC_ORIGIN` + `CORS_ORIGINS`; CSRF y WebSocket conservan sus políticas.
- **P2 fresh development DB:** resuelto. Compose development ejecuta el migrador canónico 000–006 automáticamente y falla visiblemente si no completa.

No se modificaron funcionalidades de negocio ni infraestructura real.

## 2. Causa del P1 y fuente de verdad

RSP-07F aplicaba `API_IMAGE_REF`, `FRONT_IMAGE_REF`, `APP_VERSION` y `GIT_SHA` solo como variables del proceso de `deploy.ps1`. Al terminar el proceso, el env base seguía señalando N y un `compose up` posterior podía recrear N.

La fuente de verdad actual es un archivo operacional no secreto, normalmente `deployment.env`, independiente del env privado de producción. Su formato fijo es:

```text
DEPLOYMENT_STATE_FORMAT=1
API_IMAGE_REF=<tag inmutable o digest>
FRONT_IMAGE_REF=<tag inmutable o digest>
APP_VERSION=<version>
GIT_SHA=<sha>
DEPLOY_CONFIG_SHA256=<sha256 canonico>
```

El hash cubre, en orden y UTF-8/LF, las primeras cinco claves. No cubre ni imprime secretos porque estos no forman parte del archivo. El parser rechaza claves extra, duplicadas o vacías, checksum incorrecto, `latest` y caracteres inseguros. `.gitignore` excluye `deployment.env` y `*.deployment.env`; `ops/deployment.env.example` solo documenta el formato.

El env privado conserva passwords, `FASTIFY_SECRET`, Google key, rutas TLS y configuración sensible. El deployment state conserva exclusivamente identidad recreable del build. El orden normal es siempre:

```text
docker compose --env-file <production-secrets.env> --env-file <deployment.env> -f docker-compose.production.yaml ...
```

El segundo archivo prevalece sobre refs antiguas que aún existan en el env base.

## 3. Inicialización y actualización atómica

PowerShell y POSIX generan el mismo contenido y checksum:

```powershell
. ./ops/deployment-state.ps1
Write-DeploymentStateAtomic <deployment.env> <api-ref> <front-ref> <version> <git-sha>
```

```sh
. ./ops/deployment-state.sh
deployment_state_write_atomic <deployment.env> <api-ref> <front-ref> <version> <git-sha>
```

La escritura ocurre en un archivo temporal del mismo directorio, se valida y se reemplaza mediante `File.Replace`/rename en PowerShell o `mv` en POSIX. El temporal usa permisos `0600` en POSIX. Un target inválido no altera el estado anterior.

`deploy.ps1`/`deploy.sh` siguen esta secuencia:

1. leen y validan N persistido;
2. verifican que los contenedores activos corresponden a N;
3. activan mantenimiento y backup coordinado;
4. aplican N+1 temporalmente;
5. build/pull, migrate, health y smoke;
6. solo después de `SMOKE_OK`, reemplazan atómicamente el deployment state;
7. limpian los overrides y verifican que Compose renderiza N+1 solo desde ambos archivos;
8. recién entonces emiten `DEPLOY_OK`.

Un fallo previo al paso 6 deja persistido N, activa mantenimiento, emite `DEPLOY_FAILED` y exige rollback. El audit JSON/env es evidencia operativa, no la fuente de verdad de Compose.

Ejemplo PowerShell:

```powershell
./ops/deploy.ps1 -EnvFile <production-secrets.env> `
  -DeploymentStateFile <deployment.env> -ProjectName <project> `
  -BackupDir <backups> -StateDir <audit-dir> `
  -TargetApiImage <api-ref-n1> -TargetFrontImage <front-ref-n1> `
  -TargetVersion <n1> -GitSha <sha> `
  -SmokeAdminEmail <email> -SmokeAdminPasswordFile <password-file>
```

POSIX ofrece el mismo flujo en `ops/deploy.sh`; recibe variables explícitas (`ENV_FILE`, `DEPLOYMENT_STATE_FILE`, `PROJECT_NAME`, `TARGET_API_IMAGE`, `TARGET_FRONT_IMAGE`, `TARGET_VERSION`, `TARGET_GIT_SHA`, `ADMIN_*`) y requiere `curl`/`jq` para smoke. `scripts/deploy.sh` es un lanzador del procedimiento seguro y ya no ejecuta el legado destructivo.

## 4. Rollback y estado persistente

Nivel 1 y nivel 2 conservan la clasificación de RSP-07F. Ambos verifican que la imagen previa aún resuelva al image ID auditado, mantienen escrituras detenidas y ejecutan health + smoke. Solo después de `SMOKE_OK` reemplazan el estado por N, limpian overrides, verifican Compose desde un proceso limpio y emiten `ROLLBACK_OK`.

```powershell
./ops/rollback.ps1 -EnvFile <production-secrets.env> `
  -DeploymentStateFile <deployment.env> -ProjectName <project> `
  -StateFile <deploy-audit.json> -Level Application `
  -Confirm DATABASE_BACKWARD_COMPATIBLE -BackupDir <backups> `
  -SmokeAdminEmail <email> -SmokeAdminPasswordFile <password-file>
```

Para `Full`, se usa `RESTORE_EXISTING_TARGET_FROM_BACKUP`. Si rollback o su smoke fallan, no se emite `ROLLBACK_OK`, no se persiste una versión no validada y se vuelve a mantenimiento. `ops/rollback.sh` aplica el contrato equivalente al audit POSIX.

## 5. Regresión N → N+1 → proceso limpio → N

`scripts/test-deployment-state.ps1` demuestra sin runtime:

- env base en N y deployment state en N+1;
- proceso sin overrides renderiza imágenes/versión N+1;
- fallo de validación conserva N byte a byte;
- PowerShell y POSIX leen el mismo hash;
- rollback del archivo hace que Compose vuelva a renderizar N.

`scripts/test-production-upgrade.ps1` demuestra con contenedores reales aislados:

- deploy N+1 y persistencia N+1;
- recreación `--force-recreate` posterior sin variables heredadas mantiene N+1;
- fallo controlado detectado;
- rollback de aplicación persiste N;
- otra recreación limpia mantiene N;
- restore completo conserva datos, migraciones y foto.

Evidencia final: `persisted_n1=true`, `clean_process_n1=true`, `persisted_n=true`, `clean_process_n=true`.

## 6. CORS y Origin HTTP

`normalizarOriginsPermitidos` en `api/src/config/runtime.ts` es el parser canónico. Valida origins HTTP(S) exactas, normaliza slash final y whitespace, elimina duplicados, incluye siempre `PUBLIC_ORIGIN` y rechaza wildcard, entradas vacías y URL/origin malformada.

El plugin CORS y el hook general HTTP consumen `runtime.httpOrigins`. Por tanto:

```text
PUBLIC_ORIGIN=https://app.example.com
CORS_ORIGINS=https://cliente.example.com
```

autoriza HTTP desde ambos origins y sigue rechazando cualquier origin desconocido con 403. OPTIONS y GET del origin adicional ya no divergen entre capas.

## 7. HTTP, CSRF, cookies y WebSocket

Autorizar un origin HTTP no sustituye CSRF. Una mutación desde el origin adicional sin cookie/token double-submit coincidente sigue recibiendo 403; con el contrato CSRF válido llega a la ruta. No se cambiaron `Secure`, `HttpOnly` ni `SameSite=Lax`, por lo que la utilidad efectiva cross-site con cookies continúa dependiendo de una topología compatible con esas cookies.

WebSocket permanece deliberadamente más estricto: exige `PUBLIC_ORIGIN` exacto. `CORS_ORIGINS` autoriza HTTP, no amplía automáticamente WS. Login y requests browser HTTP atraviesan la misma allowlist; producción no acepta wildcard.

Pruebas: origin público permitido; adicional permitido en preflight/GET; desconocido 403; mutación adicional sin CSRF 403 y con CSRF válida aceptada; WS adicional rechazado; duplicados/whitespace normalizados; wildcard/malformed fail-fast.

## 8. Fresh development migrations

`docker-compose.development.yaml` reutiliza la imagen/código API y el runner RSP-07C. No restaura `scripts.sql`, no usa `--adopt-current-schema` y no crea una segunda fuente de schema.

Flujo automático:

```text
postgres healthy
  → migrate: npm run db:migrate (one-shot, restart: no)
  → database-ready (solo inicia tras exit 0)
```

El migrador container usa `postgres:5432`; el API ejecutado en host conserva `127.0.0.1:${PGPORT}`. `database-ready` impide que el comando normal anuncie disponibilidad antes de completar migraciones y vuelve visible un fallo de migración.

## 9. Flujo diario development

```text
docker compose --env-file .env -f docker-compose.development.yaml up -d
```

PostgreSQL arranca, el migrador toma advisory lock, verifica checksums y aplica solo pendientes; después aparece `database-ready`. Diagnóstico:

```text
docker compose --env-file .env -f docker-compose.development.yaml ps --all migrate database-ready
```

Luego el API host continúa con `node --watch --env-file=../.env src/server.ts`. El comando manual `npm run db:migrate` sigue disponible para diagnóstico; adopción legacy continúa siendo explícita.

## 10. Evidencia fresh/existing/failure

`scripts/test-development-migrations.ps1` creó project, volumen, puerto, credenciales e imagen aislados. Resultado:

```json
{"fresh_tables":true,"migrations":7,"rerun_noop":true,"data_preserved":true,"api_status":"200,200,401","migration_failure_visible":true}
```

La primera ejecución partió con cero tablas públicas, aplicó 000–006 y creó tablas principales/ledger. La segunda ejecución fue no-op y preservó un sitio de control. `api-check` obtuvo `/health=200`, `/ready=200` y una ruta DB normal devolvió 401, no 500. Un directorio de migraciones inexistente produjo exit no cero. El cleanup eliminó containers, network, volume, imagen y env temporal.

## 11. Pruebas y regresiones

- API build: OK.
- API suite completa: 218/218.
- tests runtime/ops focalizados: 6/6.
- deployment state rápido: atomicidad, paridad POSIX, proceso limpio y rollback OK.
- POSIX `sh -n`: `deployment-state.sh`, `smoke.sh`, `deploy.sh`, `rollback.sh` y lanzador OK.
- development Docker fresh/rerun/failure: OK.
- simulacro production N/N+1/fallo/rollback/restore: OK, aproximadamente 179 s.
- restore: conteos `3,1,1,1,1`, ledger intacto, foto SHA-256 `32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af`.
- reconciliación final: cero referencias faltantes, huérfanos y trash.
- no quedaron containers, networks, volumes, imágenes, certificados, backups ni env temporales de los proyectos R1.

## 12. Regresiones RSP-07 preservadas

Production mantiene PostgreSQL/API internos, fotos persistentes, checksum/lock de migraciones, backup/restore, bootstrap explícito, HTTPS same-origin, CSRF/cookies, Origin/CORS restrictivos, WebSocket same-origin, headers, rate limiting, logout revocado, logs redactados, DB timeouts, límite PDF, Swagger off, mantenimiento, smoke, rollback y reconciliación de fotos.

## 13. Riesgos residuales

- El operador debe decidir compatibilidad DB para rollback nivel 1; migraciones siguen siendo forward-only.
- Restore nivel 2 pierde todo dato posterior al backup, conforme al RPO documentado.
- Los scripts POSIX tienen paridad de formato y validación sintáctica; el simulacro Docker integral se ejecutó con la variante PowerShell disponible en este host Windows.
- Los avisos `npm audit` de dependencias existentes no pertenecen a estos tres hallazgos y requieren una etapa separada antes de exposición pública.

## 14. Cierre y pendientes

Los tres comentarios del review quedan cerrados. RSP-07F vuelve a quedar listo para trasladar el runbook a un servidor piloto real cuando existan hosting, registry, dominio, TLS público y secretos operativos.

No quedan P1/P2 de producción web en esta etapa. **P2-10 autenticación Android** permanece fuera de RSP-07F-R1.
