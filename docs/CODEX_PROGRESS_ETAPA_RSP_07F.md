# ETAPA RSP-07F — Simulacro final de producción y ciclo de vida de fotos

Fecha de cierre: 2026-08-14. Rama: `feature/rsp-07-produccion`. Base inicial verificada: `6470ba77900e008cb03f79182ec059d5b0403bf6`, con árbol limpio.

## 1. P2-08 y P2-09 exactos

La fuente de verdad fue `CODEX_AUDITORIA_RSP_07A_PRODUCCION.md`:

- **P2-08:** eliminar el archivo de foto al borrar un pozo y reconciliar periódicamente DB/volumen; el `DELETE pozo` auditado dejaba un archivo huérfano.
- **P2-09:** desplegar sin el `down` previo del script legado, ejecutar smoke y poder volver a una imagen anterior trazable; el procedimiento auditado no migraba ni tenía rollback.

Evidencia reutilizada, sin duplicar implementaciones:

- RSP-07B: imagen reproducible, volumen persistente `raul_silva_fotos`, `FOTOS_DIR`, UID/GID no-root, health/readiness y PostgreSQL interno.
- RSP-07C: ledger y runner 000..006, lock y checksums de migraciones, bootstrap admin one-shot, bundle coordinado DB+fotos, checksums, restore y objetivos RPO/RTO.
- RSP-07D: HTTPS local, same-origin, SPA profunda, WebSocket, cookies Secure, CSRF/Origin, foto protegida, PDF y puertos internos.
- RSP-07E: rate limiting, headers/CSP, Swagger production off, logout revocado, logging redactado, timeouts DB y capacidad PDF.

## 2. Lifecycle real de fotografías

El modelo actual tiene una referencia `pozo.foto_url` y nombres físicos derivados exclusivamente del ID: `pozo-<id>.jpg|jpeg|png`. No existe una tabla de fotos compartidas ni una relación muchos-a-muchos: cada archivo pertenece inequívocamente a un pozo. Por defensa operacional, el borrado considera todas las variantes válidas del mismo ID, aunque el flujo normal produzca una sola.

La lectura HTTP y el PDF usan ahora el mismo descubrimiento seguro de archivo regular. Alta, reemplazo, borrado individual, actualización completa y borrado del pozo derivan el path desde el ID y trabajan dentro de `FOTOS_DIR`.

Ventanas auditadas:

| Caso | Cuándo puede ocurrir | Tratamiento |
|---|---|---|
| A. Archivo sin fila DB | Caída abrupta después de promover un alta y antes del commit; copia manual o restore incompleto | La compensación lo elimina ante errores capturados; el reconciliador detecta una caída no capturable. |
| B. Fila DB sin archivo | Eliminación externa del volumen, corrupción o restore incompleto | Lectura devuelve 404, PDF omite la foto y el reconciliador informa el ID. No inventa contenido. |
| C. `.trash` abandonado | Caída o error físico después del commit DB y antes/durante la purga | Se registra warning sin secretos y el reconciliador clasifica trash reciente/antiguo. |
| D. Foto de pozo eliminado | Era el comportamiento exacto de `deletePozo`, que solo ejecutaba SQL | Corregido: se aísla antes del DELETE y se purga solo después del commit. |
| E. Borrado físico antes de commit | El código anterior ya movía una foto en borrado individual/reemplazo, pero no cubría DELETE pozo ni variantes múltiples | No se hace borrado irreversible antes del commit. El movimiento reversible a `.trash` es la compensación explícita. |
| F. Fallo entre mover y confirmar | Error DB, constraint, desconexión o fallo del DELETE | Se ejecuta rollback DB y se restauran, en orden inverso, todos los archivos aislados. |

Una terminación no capturable entre DB/filesystem no puede transformarse en una transacción PostgreSQL falsa. Por eso se conservan compensación y reconciliación como capas distintas.

## 3. `.trash` y regla de borrado

Secuencia de borrar foto o pozo:

1. `BEGIN`, advisory lock por `id_pozo` y `SELECT ... FOR UPDATE`;
2. validación de archivos regulares y movimiento de todas las variantes exactas a `.trash`;
3. mutación DB;
4. `COMMIT`;
5. purga física post-commit.

Si 2 o 3 fallan, DB hace rollback y los archivos se restauran. Si 5 falla, la mutación ya confirmada no se presenta falsamente como rollback: se registra `operacion`, `id_pozo`, `etapa=post_commit` y código del filesystem; el archivo aislado queda reconciliable y no reaparece como foto válida.

El reemplazo conserva la foto nueva solo si la actualización DB confirma; ante fallo elimina staging/nueva y restaura todas las anteriores. Una operación normal termina con `.trash` vacío.

## 4. Borrado de pozo e integridad de sitios

`eliminarPozoPersistido` reemplaza al DELETE SQL directo de la ruta. El DELETE de la fila conserva las cascadas de hijos existentes y no agrega ninguna cascade hacia `sitio`. El sitio standalone no es eliminado: continúa vigente la regla RSP-06K/RSP-07E por la cual un perforador no elimina sitios standalone y administración mantiene su integridad.

Los archivos se seleccionan por expresión completa con el ID exacto; borrar A no coincide con B ni con prefijos parecidos. Como el modelo no comparte fotos, no hay un archivo compartido que deba conservarse.

La notificación WebSocket de borrado se emite después de completar DB/filesystem, evitando anunciar una eliminación fallida.

## 5. Reconciliador

El servicio `reconcile-fotos` y `npm run fotos:reconcile` son **siempre dry-run**. `--apply` y cualquier argumento desconocido se rechazan. No se automatiza una decisión destructiva porque ni una referencia sin archivo ni un archivo sin referencia permiten reconstruir con certeza la intención del operador.

Uso operacional:

```powershell
docker compose --project-name <proyecto> --env-file <env> `
  -f docker-compose.production.yaml --profile ops run --rm reconcile-fotos
```

La salida JSON contiene modo, conteos, paths relativos, IDs internos mínimos y hallazgos:

- referencia DB sin archivo;
- archivo canónico sin referencia DB;
- `.trash` reciente o antiguo (umbral default 24 h);
- entrada no permitida.

No imprime usuarios, nombres, correos, credenciales ni contenido de fotos. El contenedor monta el volumen read-only.

## 6. Paths, traversal y symlinks

`rutaContenida` exige raíz absoluta, rechaza rutas absolutas hijas, NUL y cualquier resolución fuera de `FOTOS_DIR`. La raíz y `.trash` deben ser directorios reales, no symlinks. Fotos y entradas reconciliadas se inspeccionan con `lstat`; symlinks y entradas no regulares no se siguen ni se eliminan.

Los nombres aceptados son exclusivamente `pozo-<entero positivo seguro>.jpg|jpeg|png`. Lectura, PDF, staging, restauración y purga usan paths derivados internamente.

## 7. Pruebas de fotos

`api/test/fotos-lifecycle-rsp07f.test.ts` y las suites existentes cubren:

- pozo con una o varias variantes de foto;
- dos pozos y preservación de la foto ajena;
- rollback DB con restauración y `.trash` limpio;
- fallo de purga post-commit registrado y reconciliable;
- reemplazo reversible en escritura, promoción y confirmación DB;
- huérfano físico, referencia faltante y trash abandonado;
- dry-run sin cambios byte a byte;
- traversal, path absoluto y symlink escape rechazados;
- PDF después de eliminar foto.

Resultado final API: **214/214**.

## 8. P2-09: deploy reproducible

`ops/deploy.ps1` exige env, project name, backup/state dirs, referencias API/frontend, versión, SHA y credencial de smoke mediante archivo. Rechaza `latest`, caracteres inseguros y config Compose inválida.

Secuencia efectiva:

1. registra referencia e image ID de API/frontend anteriores;
2. detiene proxy y activa Nginx de mantenimiento 503;
3. detiene API, bloqueando todas las escrituras;
4. ejecuta y valida el backup coordinado RSP-07C;
5. build local controlado para el simulacro o pull de refs explícitas;
6. ejecuta `migrate` one-shot;
7. recrea solo API/frontend y espera health;
8. retira mantenimiento, inicia proxy y espera health;
9. ejecuta smoke completo;
10. declara `DEPLOY_OK` solo si todo pasó.

No usa `docker compose down`, no elimina volúmenes y no repite bootstrap admin. Ante cualquier error guarda estado `failed`, deja/activa mantenimiento, imprime `DEPLOY_FAILED` y `ROLLBACK_REQUIRED=<state>` y termina distinto de cero.

Ejemplo:

```powershell
ops/deploy.ps1 -EnvFile <env> -ProjectName <proyecto> `
  -BackupDir <backups> -StateDir <estado> `
  -TargetApiImage registro/api@sha256:<digest> `
  -TargetFrontImage registro/front@sha256:<digest> `
  -TargetVersion <version> -GitSha <sha> `
  -SmokeAdminEmail <email> -SmokeAdminPasswordFile <archivo>
```

`scripts/deploy.sh`, que hacía `down`, fue deshabilitado y falla cerrado para que no exista un segundo procedimiento peligroso.

## 9. Migrate, health y definición de éxito

La versión N+1 del simulacro usa otra imagen/tag y labels, la misma historia productiva de migraciones y el runner real. No se agregó una migración productiva ficticia. El runner verificó ledger/checksums y completó con cero pendientes.

Un deploy es exitoso exclusivamente con:

- migrador exit 0;
- API/frontend/proxy healthy;
- `/api/ready` con DB disponible;
- smoke exit 0.

`docker compose up` por sí solo no produce `DEPLOY_OK`.

## 10. Smoke operacional reusable

`ops/smoke.ps1` prueba por HTTPS y devuelve `SMOKE_OK` solo si todos pasan:

1. `/` y contenido Angular;
2. ruta Angular profunda;
3. `/api/health`;
4. `/api/ready`;
5. login;
6. request autenticada;
7. mutación sin CSRF rechazada 403;
8. lista de pozos;
9. detalle de pozo;
10. foto 401 sin sesión y 200 autenticada;
11. PDF con firma `%PDF`;
12. WebSocket 101;
13. Swagger 404;
14. PostgreSQL sin binding host;
15. API sin binding host;
16. headers CSP/Permissions/nosniff/referrer/framing;
17. cookies Secure/HttpOnly/SameSite;
18. logout y rechazo 401 de la copia del token.

Los archivos de body/cookies se crean bajo `%TEMP%`, no se imprimen y se eliminan en `finally`. No se llama Google: el fixture carece de coordenadas.

## 11. Versionado e imagen anterior

API y frontend reciben `APP_VERSION`/`GIT_SHA` como build args y labels OCI `version`/`revision`; API también los registra al arrancar sin exponer secretos en health. Compose propaga ambas variables. El manifest de backup sigue registrando `APP_VERSION`.

Antes del update se guardan, para API y frontend:

- referencia configurada;
- image ID inmutable resuelto;
- versión previa;
- revisión OCI.

Rollback verifica que la referencia previa todavía resuelva al mismo image ID. Si no, falla: nunca reconstruye "la misma" imagen desde el checkout ni consulta GitHub en runtime.

## 12. Rollback de aplicación

Nivel 1 se usa solo si un operador determinó que la DB es backward-compatible:

```powershell
ops/rollback.ps1 -EnvFile <env> -ProjectName <proyecto> `
  -StateFile <deploy-state.json> -Level Application `
  -Confirm DATABASE_BACKWARD_COMPATIBLE -BackupDir <backups> `
  -SmokeAdminEmail <email> -SmokeAdminPasswordFile <archivo>
```

Activa mantenimiento, detiene la versión fallida, verifica IDs de imagen previos, recrea API/frontend anteriores, inicia proxy, espera health y ejecuta smoke. Solo entonces imprime `ROLLBACK_OK`.

Clasificación:

- **A.** Fallo antes de aplicar migración: rollback de imagen.
- **B.** Migración aplicada y demostrada backward-compatible: nivel 1 con confirmación humana explícita.
- **C.** Migración incompatible/destructiva o compatibilidad incierta: nivel 2 y restore del backup.

No existen ni se inventan down migrations generales.

## 13. Restore completo

Nivel 2 exige la confirmación exacta `RESTORE_EXISTING_TARGET_FROM_BACKUP`. `restore.sh` valida formato, estado, nombres, checksums, tamaños y paths del tar antes de mutar. En modo replace, `pg_restore --clean --if-exists --single-transaction` recupera DB; las fotos se extraen a staging y se intercambian dentro del mismo volumen con compensación si la promoción falla.

```powershell
ops/rollback.ps1 -EnvFile <env> -ProjectName <proyecto> `
  -StateFile <deploy-state.json> -Level Full `
  -Confirm RESTORE_EXISTING_TARGET_FROM_BACKUP -BackupDir <backups> `
  -SmokeAdminEmail <email> -SmokeAdminPasswordFile <archivo>
```

Las escrituras permanecen detenidas y Nginx responde 503 durante restore. Después se vuelve a la imagen N registrada, health y smoke.

## 14. Modo mantenimiento

`maintenance` es un servicio profile `ops` sin API ni DB. Publica los mismos bindings que proxy, TLS montado read-only, redirect HTTP y respuesta HTTPS 503 JSON con `Retry-After: 120`. El flujo detiene proxy antes de iniciarlo y lo retira antes de volver a iniciar proxy; nunca compiten por los puertos.

Esto evita mutaciones durante backup coordinado, migración incompatible y restore sin desarrollar una pantalla compleja.

## 15. RPO/RTO

Se conserva el objetivo RSP-07C del piloto: RPO 24 h más backup obligatorio inmediatamente antes de actualizar, y RTO 4 h ante pérdida total. El simulacro integral local tardó aproximadamente 157 s incluyendo dos builds, deploy, fallo, dos rollbacks, restore, smokes y cleanup; no representa latencia de registry/disco/hosting real.

Restaurar un bundle elimina **todo dato posterior al backup**. El simulacro creó deliberadamente `POST_BACKUP_DEBE_PERDERSE` y comprobó su ausencia tras restore. La ventana de mantenimiento reduce, pero no oculta, ese costo.

## 16. Evidencia del simulacro final

Comando:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-production-upgrade.ps1
```

Resumen controlado:

```json
{"version_n":"rsp07f-n","version_n1":"rsp07f-n1","backup_bundle":"rsp-backup-20260814T123837Z","deploy_ok":true,"fault_detected":true,"rollback_app":true,"restore_full":true,"counts":"3,1,1,1,1","migrations_ok":true,"photo_sha256":"32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af","post_backup_data_lost":true,"reconcile_clean":true}
```

El ensayo demostró:

- N con PostgreSQL, 7 migraciones, bootstrap admin, propietario, perforador, sitio, pozo, litología, diámetro, filtro/ranura, aporte, foto, HTTPS y PDF;
- backup previo con bundle real;
- dos tags controlados N/N+1 y labels de versión;
- migrador N+1 y deploy exitoso con smoke;
- fallo controlado por config inválida, API unhealthy y no declaración de éxito;
- rollback de aplicación a los image IDs N registrados;
- estado incompatible controlado y dato posterior al backup;
- restore completo y segundo rollback a N;
- mismos conteos, ledger, empresa original y SHA-256 de foto;
- login, foto protegida y PDF funcionales después de cada recuperación;
- reconciliador final con cero faltantes, huérfanos y trash;
- cero contenedores, volúmenes, tags `rsp07f-final-*` y directorios temporales al terminar.

## 17. Validaciones y regresiones RSP-07

- API build: correcto.
- API suite: **214/214**.
- Frontend production build: correcto; no hubo cambio funcional frontend, por lo que no se repitió su suite de 178 ya cerrada en RSP-07E.
- Docker build N y N+1: correcto.
- Compose config: correcto dentro del simulacro.
- Migraciones: fresh 7 y rerun N+1 sin pendientes.
- Backup/manifest/checksums y restore completo: correctos.
- Bootstrap admin: correcto y no repetido durante deploy.
- HTTPS, CSRF, cookies, Origin, headers, WebSocket, logout y Swagger 404: smoke correcto.
- PostgreSQL/API/frontend internos: sin puertos host.
- Rate limiting, logging redactado, DB timeouts y PDF capacity: 214 tests/regresión RSP-07E; health y PDF también ejercitados en stack final.
- Google real: cero requests.
- Cleanup: cero recursos temporales.

## 18. Estado final, riesgos y readiness

| ID | Estado |
|---|---|
| P2-08 | **Cerrado.** DELETE pozo no deja fotos huérfanas en éxito normal, rollback restaura, fallos post-commit quedan reconciliables y dry-run detecta inconsistencias. |
| P2-09 | **Cerrado.** Backup, imagen trazable, migrate, health, smoke, fallo detectado, rollback de app y restore completo fueron demostrados. |
| P2-10 | Abierto y fuera de RSP-07F: autenticación/CSRF/Origin para Android sin debilitar la web. |

Riesgos residuales:

- filesystem local y una sola réplica escritora; S3/múltiples réplicas siguen fuera;
- una muerte no capturable puede dejar archivo/DB/trash divergentes hasta la siguiente reconciliación;
- reconciliación no aplica correcciones automáticas por diseño;
- la clasificación backward-compatible requiere decisión humana;
- backups programados, copia off-server, host, firewall, DNS, certificado público renovable y HSTS deben configurarse en el servidor real;
- vulnerabilidades de dependencias informadas por `npm ci` requieren su ciclo separado de actualización, pruebas y riesgo; no se forzó un upgrade fuera de alcance;
- RTO real depende del tamaño de DB/fotos, disco y descarga de imágenes.

Conclusión: la aplicación web queda **lista a nivel de repositorio y procedimiento para un piloto de un solo servidor**, condicionada a aprovisionar la infraestructura real, refs/digests inmutables, TLS público, scheduling/copia off-server y secretos externos. No se realizó hosting, DNS, certificado público, despliegue externo ni CI/CD cloud.
