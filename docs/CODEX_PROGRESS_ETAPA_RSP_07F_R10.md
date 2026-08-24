# ETAPA RSP-07F-R10 — LF determinista y restore recuperable

## 1. Alcance y resultado

Se corrigieron exclusivamente los dos P1 del review global: line endings operacionales no deterministas y restore PostgreSQL/fotos no recuperable. No se cambiaron reglas funcionales del producto ni se realizó push, merge, rebase, cambio de rama o despliegue externo.

## 2. Causa CRLF y política Git

El repositorio no tenía `.gitattributes`. Con `core.autocrlf=true`, Git podía materializar scripts bind-mounted y migraciones SQL en CRLF. Los scripts podían fallar bajo Alpine `/bin/sh`, y el migrador calculaba SHA-256 sobre bytes crudos, por lo que LF y CRLF del mismo SQL producían ledgers diferentes.

La política mínima agregada fija LF para:

- `.gitattributes`;
- todos los `*.sh`, incluidos `proxy/start.sh`, `ops/*.sh`, `scripts/*.sh` y fixtures shell;
- `api/db/migrations/*.sql` (migraciones reales 000..006).

No se aplicaron reglas globales a imágenes, PDFs ni otros binarios. La normalización del checkout se limitó a esos 26 archivos (19 shell y 7 SQL). Los modos `100755` de `scripts/deploy.sh`, `ops/deploy.sh`, `ops/rollback.sh`, `ops/prepare-photo-storage.sh` y `ops/smoke.sh` permanecen intactos; los entrypoints invocados mediante `/bin/sh`, incluido `proxy/start.sh` y `ops/restore.sh`, conservan `100644`.

## 3. Checkout Windows/Linux

`scripts/test-rsp07f-r10-lf.ps1` crea un repositorio aislado, configura `core.autocrlf=true`, agrega `.gitattributes`, genera un checkout mediante el índice e inspecciona bytes. Resultado:

```json
{"autocrlf_checkout":"lf","shell_linux":"ok","shell_files":19,"migration_files":7,"executable_modes":"preserved"}
```

El fixture shell del checkout se ejecutó correctamente con `/bin/sh` dentro de la imagen Alpine de PostgreSQL usada por producción. Los blobs, el índice y el worktree de los paths cubiertos usan LF.

## 4. Checksum canónico y compatibilidad de ledgers

`api/src/db/migrator.ts` convierte únicamente `CRLF -> LF` y `CR solitario -> LF` antes de calcular SHA-256 y antes de entregar SQL al driver. No hace trim, no modifica espacios, comentarios, Unicode ni contenido SQL. Por eso LF y CRLF del mismo archivo comparten checksum, pero un espacio, comentario o byte lógico editado sigue cambiándolo.

Para bases históricas se calcula además un único candidato legacy: SHA-256 del mismo SQL canónico expresado enteramente como CRLF. Un ledger aplicado se acepta sólo si coincide con el hash canónico o con ese hash CRLF exacto. Un hash arbitrario y cualquier modificación real continúan rechazándose como `Checksum diferente`. Los inserts nuevos y `--adopt-current-schema` escriben siempre el hash canónico.

La matriz Docker modificó explícitamente el ledger 006 al SHA histórico CRLF, verificó rerun no-op, rechazó una migración realmente editada, aplicó 000..006 en fresh DB y mantuvo la adopción de baseline 000..005 más migración 006.

## 5. Causa del restore inconsistente

El flujo anterior hacía `DROP/CREATE` y `pg_restore` sobre la DB activa antes de promover fotos. Si el último `mv` fallaba, PostgreSQL quedaba en N y fotos en M. En EMPTY_TARGET el intento ya había llenado la DB, por lo que el mismo comando no podía reintentarse.

## 6. Protocolo recuperable elegido

El restore ahora usa preparación completa y commit compensable, sin crear un backup técnico gigante:

1. valida manifest, checksums, tamaños, TOC del dump, metadata, identificadores y tar antes de tocar recursos activos;
2. extrae fotos dentro del mismo volumen, rechaza traversal y symlinks, valida la raíz `fotos/`, prepara ownership y marker;
3. crea una DB de staging con owner/encoding/locales esperados;
4. ejecuta `pg_restore --single-transaction` y valida ledger, schemas, extensiones, ownership y privilegios en staging;
5. preserva `fotos` y el marker actuales mediante rename y promueve staging mediante rename en el mismo filesystem;
6. deshabilita conexiones al target y realiza los dos `ALTER DATABASE ... RENAME` dentro de una transacción PostgreSQL: target a previous y staging a target;
7. una vez confirmado DB N + fotos N, purga DB/fotos previous como cleanup separado.

Un lock en el volumen evita dos restores simultáneos. Los traps de `EXIT`, `HUP`, `INT` y `TERM` compensan el switch de fotos y eliminan la DB de staging si el commit DB no ocurrió.

## 7. Fallos y retry

- Antes/durante promoción de fotos: DB activa permanece M; cualquier rename previo de fotos/marker se revierte a M. El mismo bundle puede reintentarse.
- Fallo al restaurar o validar DB staging: no se toca DB activa ni fotos activas; staging se elimina.
- Fallo del swap DB: los renames DB se revierten juntos por la transacción; se reactivan conexiones y se compensan fotos a M.
- EMPTY_TARGET + fallo de fotos: queda DB vacía + fotos vacías; el mismo bundle fue reintentado y terminó N/N.
- Full replace + fallo de fotos/swap: queda M/M; el mismo bundle fue reintentado y terminó N/N.
- Cleanup final fallido: el commit N/N ya es funcional, se emite `RESTORE_CLEANUP_PENDING` con nombres no secretos y luego `RESTORE_OK`; el residuo previous es detectable y el próximo full retry lo purga. No se revierte un restore confirmado.

Los fault points ejercitados fueron `db_restore`, `before_current_move`, `after_current_preserved`, `before_staged_switch`, `after_photo_switch`, `before_db_swap`, `after_target_preserved` y `cleanup`.

## 8. Rollback y paridad POSIX/PowerShell

El motor de datos único sigue siendo `ops/restore.sh`, ejecutado por el one-shot Compose tanto desde `restore.ps1`/`restore-full.ps1` como desde `rollback.ps1`/`rollback.sh`. Por ello staging, compensación, retry y cleanup tienen la misma semántica en ambos entrypoints.

El simulacro real `deploy failure -> rollback Full` inyectó `after_photo_switch`: el primer rollback no emitió `ROLLBACK_OK`, mantuvo maintenance y DB M; el retry del mismo bundle recuperó N/N, ejecutó smoke y recién entonces emitió `ROLLBACK_OK` y persistió deployment state N.

## 9. Verificación

- API build TypeScript: OK.
- API suite completa: 246/246 OK.
- checkout aislado `core.autocrlf=true` + shell Linux: OK.
- sintaxis `sh -n` de restore: OK.
- parser PowerShell de restore, restore-full, rollback y harnesses: OK.
- Compose y builds reales usados por lifecycle/upgrade: OK.
- lifecycle Docker: fresh/rerun/adopt/legacy CRLF/rechazo mismatch, bundle corrupto pre-mutation, EMPTY_TARGET fallo+retry, full faults+retry, cleanup+retry, login/readiness/PDF/foto SHA-256: OK.
- rollback Docker con fallo de promoción+retry: OK.
- recursos temporales de los harnesses: eliminados por `down --volumes --remove-orphans` y cleanup de imágenes etiquetadas.
- no se almacenan secretos en marker, nombres de staging, mensajes de cleanup ni logs nuevos.

## 10. Pendiente fuera de alcance

Permanece pendiente el P2 Android previamente identificado; R10 no lo modifica.
