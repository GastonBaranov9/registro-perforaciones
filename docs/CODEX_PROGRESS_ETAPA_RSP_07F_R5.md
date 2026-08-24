# RSP-07F-R5 — Launcher independiente del CWD y audits preflight no-op

## 1. Alcance y resultado

Se cerraron exclusivamente los dos hallazgos del review global de RSP-07F-R4:

- **P2 launcher de deploy:** `scripts/deploy.sh` ya no depende del directorio actual del caller.
- **P3 audit preflight:** un fallo anterior a la captura de image IDs se valida y llega a `ROLLBACK_NOT_REQUIRED`.

No se cambiaron funciones del producto, migraciones, configuración de seguridad, secretos ni infraestructura externa.

## 2. Causa del P2

El launcher resolvía correctamente la raíz a partir de su propia ubicación, pero ejecutaba `ops/deploy.sh` sin cambiar el working directory. El deploy POSIX usa `docker-compose.production.yaml` como referencia Compose por defecto; Compose la interpretaba respecto del CWD heredado del caller. Una invocación por path absoluto desde systemd, cron, CI u otro directorio fallaba aunque el repositorio estuviera completo.

## 3. Launcher independiente del CWD

`scripts/deploy.sh` ahora:

1. resuelve a ruta absoluta el directorio que contiene el launcher;
2. resuelve la raíz del repositorio desde esa ubicación;
3. comprueba que existan `ops/deploy.sh` y `docker-compose.production.yaml`;
4. cambia de forma explícita y comprobada a la raíz;
5. ejecuta el deploy mediante su ruta absoluta.

Si no puede resolver directorio/raíz, acceder a la raíz o encontrar cualquiera de los dos archivos requeridos, termina antes del deploy con `deploy launcher: ...` y código distinto de cero. No usa el `$PWD` del caller ni rutas hardcodeadas de plataforma.

La auditoría rápida de wrappers no encontró launchers públicos equivalentes bajo `scripts/` para rollback, backup, restore o smoke. Los entrypoints PowerShell correspondientes ya anclan Compose a la raíz obtenida desde `$PSScriptRoot`; no se amplió el cambio a scripts internos ajenos al hallazgo.

## 4. Preservación de argumentos

El salto final continúa siendo:

```sh
exec "$deploy" "$@"
```

Cada argumento conserva su frontera y contenido. El fixture verificó flags y valores separados, espacios, wildcard literal y punto y coma; no hay reconstrucción mediante strings ni evaluación adicional.

## 5. Causa del P3

`ops/deploy.sh` y `ops/deploy.ps1` escriben el audit al entrar en preflight. Si la validación Compose/runtime falla antes de inspeccionar los contenedores anteriores, `previous_api_id` y `previous_front_id` permanecen vacíos. Ese estado es deliberadamente pre-mutation, conserva el deployment state N y el deploy anuncia `ROLLBACK_NOT_REQUIRED`.

Los lectores de audit, sin embargo, exigían ambos IDs antes de calcular `rollback_noop`. Por eso el rollback rechazaba el mismo artefacto no-op que el deploy acababa de producir.

## 6. Clasificación y validación por fase

`ops/deployment-audit.sh` y `ops/deployment-audit.ps1` aplican ahora el mismo orden:

1. cargan todos los campos obligatorios y validan formato, proyecto/state, status, clasificación DB, fases, orden de fases y timestamps;
2. validan que `deployment_state_persisted` sea booleano;
3. clasifican `rollback_noop`, `rollback_requires_full` y evidencia de backup según fase/status;
4. validan siempre refs, versiones, Git SHA y hashes de configuración;
5. exigen los dos image IDs anteriores únicamente cuando el audit requiere rollback;
6. exigen bundle válido cuando backup ya terminó y, explícitamente, para todo `restore_required`.

La relajación se limita a los image IDs legítimamente aún no capturados. Un no-op sigue siendo rechazado por formato, status/fase desconocidos, timestamps, state divergente, refs/identificadores inseguros o hashes incoherentes.

## 7. Contratos resultantes

- **Pre-mutation/no-op:** status distinto de success, DB `not_required`, state no persistido y fase iniciada no posterior a `images`. Puede no contener image IDs y devuelve `ROLLBACK_NOT_REQUIRED` sin Docker, recreación de servicios ni restore.
- **Rollback de aplicación:** sigue exigiendo refs/hashes e IDs `sha256` previos válidos. IDs vacíos provocan rechazo.
- **Restore completo:** conserva los requisitos anteriores y además exige que la fase backup esté completada y que exista un bundle con nombre válido. Los checksums, manifest y contenido se siguen verificando en la herramienta de restore.
- **Audit success:** conserva el comportamiento previo y no se clasifica como no-op.

## 8. Pruebas nuevas

Se agregaron `scripts/test-rsp07f-r5-contracts.ps1` y `scripts/test-rsp07f-r5-posix.sh`. Usan únicamente temporales y dobles controlados; sus recursos se eliminan al terminar.

Cobertura del launcher:

- invocación desde raíz, subdirectorio y directorio externo;
- CWD efectivo de Compose igual a la raíz y compose file por defecto correctamente resuelto;
- repositorio y fixtures con espacios en el path;
- argumentos preservados exactamente;
- error temprano y claro si falta Compose o `ops/deploy.sh`.

Cobertura de audits, idéntica en PowerShell/POSIX:

- preflight fallido con IDs vacíos aceptado como no-op;
- fase desconocida rechazada;
- rollback app sin IDs rechazado y con IDs aceptado;
- restore-required sin backup rechazado y completo aceptado;
- success existente preservado;
- no-op incompleto con ref inválida rechazado.

## 9. Simulacros operativos aislados

**Caso A:** el launcher real inició `ops/deploy.sh` desde tres CWD distintos. Un doble de Docker hizo fallar `compose config --quiet` antes de capturar IDs. El audit resultante quedó `failed/preflight`, el rollback real devolvió `ROLLBACK_NOT_REQUIRED` y una marca de invocación confirmó que rollback no llamó a Docker.

**Caso B:** un audit `failed/services` con IDs válidos recorrió `ops/rollback.sh` con Docker, Compose y smoke simulados. Terminó en `ROLLBACK_OK`, persistió `ROLLBACK_STATUS=success` y no ejecutó restore.

No se inició ni modificó infraestructura real.

## 10. Validación ejecutada

- `scripts/test-rsp07f-r5-contracts.ps1`: OK; launcher root/subdir/external, argumentos, siete contratos audit, no-op sin Docker y paridad PowerShell/POSIX.
- `scripts/test-rsp07f-r2-contracts.ps1`: OK; regresión de audits fallidos/success, restore, hashes y secretos opacos preservada.
- `sh -n scripts/deploy.sh ops/deployment-audit.sh scripts/test-rsp07f-r5-posix.sh`: OK.
- parser PowerShell sobre `ops/deployment-audit.ps1` y el test R5: OK.
- `docker compose -f docker-compose.production.yaml config --quiet` con valores ficticios: OK.
- escaneo del delta para claves privadas y patrones comunes de tokens: sin hallazgos.
- `git diff --check`: OK.

API y frontend no se recompilaron: el review inicial ya los reportó en verde y R5 solo cambia herramientas operativas/tests/docs, sin impacto indirecto en código de aplicación. No se usaron secretos reales.

## 11. Hallazgos cerrados y pendiente fuera de etapa

Los P2/P3 señalados por el review quedan cubiertos por código y regresiones. RSP-07F-R5 no introduce otros cambios de producción web.

**P2-10 autenticación Android** permanece pendiente y fuera de RSP-07F-R5: debe diseñarse el contrato de cookies/CSRF/Origin nativo sin debilitar la aplicación web.

Commits funcionales y de pruebas:

- `9584024` — `fix(ops): independizar deploy del directorio actual`
- `0be771b` — `fix(ops): aceptar audits preflight sin rollback`
- `7b38981` — `test(prod): cubrir launcher y audits no-op`

La documentación se entrega en un commit local separado. No hubo push, merge, rebase, reset, clean, deploy externo ni cambio de rama.
