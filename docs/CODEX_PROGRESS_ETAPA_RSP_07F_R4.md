# ETAPA RSP-07F-R4 — Restore sobre destino limpio y env development

Fecha de cierre: 2026-08-14. Rama: `feature/rsp-07-produccion`. HEAD inicial verificado: `0720070269241149a6615fe86151b66ba1b48cfd`, con árbol limpio.

## 1. Resultado

Los dos hallazgos del review quedaron cerrados:

- **P1 full restore:** resuelto. El modo `replace` recrea la DB objetivo completa antes de ejecutar `pg_restore`.
- **P2 env development:** resuelto. `npm run dev`, ejecutado desde `api`, lee exclusivamente `../.env`.

No se modificaron reglas funcionales ni se usó infraestructura externa.

## 2. Causa y limitación de `pg_restore --clean`

`pg_restore --clean` solo emite DROP para objetos presentes en el archive. Una tabla, view, función, índice, schema o extensión creada por N+1 después del backup no está en el TOC del dump N y podía sobrevivir al rollback completo. El ledger podía coincidir aun cuando la DB real no fuese N.

La aplicación utiliza una sola DB, el schema de aplicación `public` y la extensión DB-local `citext`; `plpgsql` pertenece al template PostgreSQL. No existen otros schemas de aplicación ni objetos externos a la DB. El usuario `POSTGRES_USER` es el owner operativo creado por la imagen oficial y tiene las capacidades necesarias para el procedimiento.

## 3. Estrategia de destino limpio

En `RESTORE_EXISTING_TARGET_FROM_BACKUP`, `restore.sh` realiza:

1. validación completa del bundle;
2. lectura y validación de owner, encoding, collation y ctype;
3. conexión a la DB de mantenimiento `postgres`;
4. `ALTER DATABASE ... ALLOW_CONNECTIONS false` para impedir nuevas conexiones;
5. terminación exclusiva de sesiones cuyo `datname` coincide con el target;
6. `dropdb` del target;
7. `createdb` desde `template0`, con owner, encoding y locales registrados;
8. `pg_restore --single-transaction --no-owner --no-acl` sobre la DB nueva.

Ya no se usa `--clean` en full replace. `RESTORE_EMPTY_TARGET` conserva su semántica: exige una DB y storage vacíos y no recrea la DB.

PowerShell y POSIX comparten el mismo motor dentro del one-shot Compose. `restore.ps1` orquesta empty restore y `restore-full.ps1`, `rollback.ps1` y `rollback.sh` usan el mismo `restore.sh` para full replace; no hay dos implementaciones de limpieza divergentes.

## 4. Guardas antes del DROP

Antes de alterar conexiones o borrar la DB se verifica:

- confirmación exacta `RESTORE_EXISTING_TARGET_FROM_BACKUP`;
- nombre de bundle y path controlados;
- manifest único, formato, estado y bundle ID;
- clasificación de schema y metadata de migraciones con formato estricto;
- nombres permitidos de dump y archivo de fotos;
- SHA-256 y tamaño de ambos artefactos;
- TOC legible mediante `pg_restore --list`;
- tar de fotos sin rutas absolutas ni traversal y con raíz `fotos/`;
- `PGDATABASE` y `PGUSER` como identificadores seguros;
- prohibición expresa de `postgres`, `template0` y `template1` como target;
- owner del backup igual al usuario operativo;
- encoding y locales no vacíos ni malformados.

Un checksum corrupto, manifest inválido o dump faltante falla antes del DROP. La prueba confirmó que los datos y objetos existentes del target permanecen intactos.

## 5. Ownership, permisos y extensions

El backup registra de forma no sensible:

- `DATABASE_OWNER`;
- `DATABASE_ENCODING`;
- `DATABASE_COLLATE`;
- `DATABASE_CTYPE`;
- `SCHEMAS`;
- `EXTENSIONS` con versión.

Los bundles anteriores siguen siendo compatibles: para metadata ausente se conserva la metadata del target previo. Después del restore se comprueba owner de DB, ownership de relaciones `public`, privilegios `CONNECT/CREATE/TEMP`, permisos `USAGE/CREATE` sobre `public`, lista exacta de schemas y lista exacta de extensions.

El fixture agregó `hstore` después del backup; full replace lo eliminó y restauró únicamente las extensiones del manifest N.

## 6. Ledger y estado N exacto

Para backups administrados, `schema_migrations` se restaura desde el dump y se compara byte lógicamente con `MIGRATIONS` del manifest. No se agregan filas N+1 ni se reconstruye el ledger manualmente. El migrador posterior fue no-op y verificó siete filas con versión máxima `006`.

Los backups `legacy-unmanaged` conservan su contrato: el restore no fabrica ledger y la adopción explícita posterior continúa funcionando.

## 7. Fallo y retry

La prueba inyectó un `pg_restore` controlado que:

- delega `--list` al binario real, por lo que el bundle queda validado;
- falla únicamente después de `RESTORE_TARGET_RESET`;
- produce exit no cero y `RESTORE_FAILED`;
- deja API detenida/mantenimiento y no puede producir `ROLLBACK_OK`.

El mismo bundle se reintentó. El proceso volvió a bloquear conexiones, recreó otra vez la DB desde cero y restauró correctamente. No dependió del estado parcial anterior.

## 8. Integración rollback Full

El simulacro N → N+1 → fallo `restore_required` creó una tabla y una view adicionales después del backup del deploy. `rollback Full`:

1. validó audit y bundle;
2. mantuvo proxy de mantenimiento y API detenida;
3. recreó/restauró la DB;
4. volvió a imágenes N;
5. ejecutó health y smoke;
6. persistió deployment state N;
7. emitió `ROLLBACK_OK`.

Los objetos post-backup desaparecieron, las siete migraciones y conteos N coincidieron, la foto conservó SHA-256 `32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af` y el reconciliador quedó limpio.

## 9. Causa y corrección del env development

README creaba `./.env` en la raíz, pero `api/package.json` pedía `--env-file=.env` desde el cwd `api`; Node buscaba `api/.env` y abortaba.

El contrato canónico sigue siendo un único `.env` en la raíz. El script es ahora:

```text
node --watch --env-file=../.env src/server.ts
```

README explicita que Compose se ejecuta desde raíz, API desde `api` y que no debe crearse `api/.env`. Los scripts containerizados `start`, `db:migrate` y `bootstrap:admin` no cambiaron y siguen recibiendo environment de Compose.

## 10. Fresh checkout development

`scripts/test-development-root-env.ps1` creó un checkout equivalente temporal con:

- `.env` controlado solo en la raíz;
- ausencia comprobada de `api/.env`;
- source y package reales de API;
- dependencias locales enlazadas sin copiarlas ni modificarlas;
- PostgreSQL/migrator Compose con project y volumen aislados;
- `npm run dev` desde el directorio `api`.

Resultado:

```json
{"root_env":true,"api_env_absent":true,"npm_run_dev":true,"health":true,"ready":true,"migrator_exit_0":true}
```

El watcher de Node, containers, network, volumen y checkout temporal se eliminaron al finalizar.

## 11. Pruebas

- API build: OK.
- API suite completa: **221/221**.
- frontend production build: OK; no hubo cambio funcional frontend.
- sintaxis PowerShell: OK.
- sintaxis POSIX de backup/restore: OK.
- matriz lifecycle/restore aislada: OK.
- checksum corrupto, manifest inválido y dump faltante: rechazados antes de mutar.
- fallo posterior al reset y retry: OK.
- datos, login, `/ready`, PDF y foto restaurados: OK.
- rollback Full desde audit fallido: OK.
- primer upgrade real desde `main`, bundle `legacy-unmanaged`: OK.
- fresh development root env: OK.
- Compose production/development: ejercitados por los simulacros.
- `git diff --check`: OK.

Resumen de lifecycle:

```json
{"migrations_fresh":7,"checksum_rejected":true,"corrupt_restore_rejected":true,"invalid_manifest_rejected":true,"missing_dump_rejected":true,"corrupt_replace_preserved_target":true,"post_backup_objects_removed":true,"failed_restore_detected":true,"restore_retry":true,"restored_relations":true,"restored_photo_sha256":"32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af","restored_pdf_bytes":71775,"ready":"ok"}
```

## 12. Regresiones preservadas

Se preservan migraciones fresh/production, backup custom, manifest/checksums, rollback desde audits fallidos, deployment state, primer upgrade legacy/fotos, reconciliación, HTTPS, CSP/assets locales, cookies, CSRF, CORS, WebSocket, rate limits, logs redactados, timeouts PostgreSQL, PDF concurrency, bootstrap y Swagger production off.

## 13. Hallazgos cerrados y riesgos residuales

P1 y P2 quedan cerrados. Riesgos operativos deliberados:

- después del DROP, un fallo requiere mantener mantenimiento y reintentar desde el bundle validado;
- full replace necesita que el rol operativo conserve privilegios para DROP/CREATE DATABASE;
- el rollback completo conserva el RPO: datos posteriores al backup se pierden;
- POSIX comparte el motor probado y tiene validación sintáctica; los end-to-end Docker se ejecutaron desde PowerShell en Windows.

## 14. Pendiente fuera de etapa

No quedan P1/P2 web de RSP-07F-R4. **P2-10 autenticación Android** permanece fuera de esta etapa.
