# ETAPA RSP-07F-R3 — Primer upgrade de fotos y assets locales CSP

Fecha de cierre: 2026-08-14. Rama: `feature/rsp-07-produccion`. HEAD inicial verificado: `b35e0a8fdfe3a320bffb97d58f493a5ad2544537`, con árbol limpio.

## 1. Resultado

Los dos hallazgos del review quedaron cerrados:

- **P1 primer upgrade de fotos:** resuelto. El deploy prepara, copia y valida el storage persistente antes del backup obligatorio y antes de recrear el API legacy.
- **P2 imágenes bloqueadas por CSP:** resuelto. El logo y el fondo originales están dentro del bundle; la CSP same-origin no se amplió.

No se cambiaron reglas funcionales de negocio ni se usó infraestructura externa.

## 2. Storage legacy encontrado

La fuente fue auditada directamente sobre `main`, sin cambiar de rama:

- `main:docker-compose.production.yaml` define el servicio `api` sin bind mount ni volumen de fotos;
- `main:api/Dockerfile` usa `WORKDIR /api` y copia `public` a `/api/public` dentro de la capa writable del contenedor;
- `main:api/src/routes/pozos.ts` y `main:api/src/pdf/pdf-generate.ts` leen y escriben ese directorio;
- los archivos canónicos son `pozo-<id>.jpg|jpeg|png` y el servicio legacy ya puede tener `.trash`;
- la DB relaciona la foto mediante `public.pozo.foto_url`; no existe una tabla separada de fotos.

Por tanto, la fuente real del primer upgrade es `/api/public` del contenedor previo del servicio Compose `api`. Era filesystem efímero del contenedor, no un bind mount.

La DB de `main` también resultó ser un schema baseline sin `schema_migrations`. El primer backup admite explícitamente ese estado como `SCHEMA_STATE=legacy-unmanaged`; después del backup, el migrador canónico adopta el baseline de forma explícita y aplica únicamente las pendientes.

## 3. Fase pre-backup

El orden operacional es ahora:

```text
preflight → maintenance → photo_storage → backup → images → migrate
          → services → health → smoke → persist_state → complete
```

`prepare-photo-storage.ps1` y `prepare-photo-storage.sh` inspeccionan el contenedor API anterior. Si no tiene el mount RSP-07, exportan `/api/public` a un directorio temporal seguro mediante `docker cp`; si la exportación falla, abortan. El one-shot `prepare-photo-storage` ejecuta la migración contra PostgreSQL y el volumen `raul_silva_fotos`.

El contenedor legacy se detiene durante mantenimiento, pero no se recrea antes de copiar y verificar. Si falla esta fase o la construcción posterior antes de mutar DB/runtime, el deploy vuelve a iniciar exactamente los IDs de contenedor anteriores, no intenta recrearlos y emite `ROLLBACK_NOT_REQUIRED`.

## 4. Inicialización del volumen

`photo-storage-migrate.sh` crea la estructura canónica:

```text
/data/fotos
/data/fotos/.trash
/data/.rsp-photo-storage-layout
```

Los directorios quedan en `0750`, los archivos en `0640` y el ownership en `1000:1000`. No se usa `chmod 777`. Se rechazan symlinks, entradas no regulares y nombres fuera del patrón permitido.

El marker `RSP_PHOTO_STORAGE_LAYOUT=1` se escribe atómicamente solo después de copiar y validar todo. No es la única evidencia: cada ejecución vuelve a validar estructura, archivos y referencias DB.

## 5. Migración de fotos y casos A–E

- **A — RSP-07 ya migrado:** el mount persistente se detecta; no se exporta `/api/public`, se revalida el volumen y la operación es no-op.
- **B — legacy con fotos:** cada archivo raíz y entrada segura de `.trash` se copia primero a temporal, se verifica por tamaño y SHA-256 y se promueve con rename.
- **C — legacy sin fotos:** si DB tampoco posee referencias, se inicializa la estructura vacía y el backup continúa.
- **D — DB con referencia sin archivo:** se aborta antes del marker y del backup. Una fuente legacy inaccesible también aborta explícitamente.
- **E — volumen parcial:** un archivo idéntico por path, tamaño y SHA-256 es idempotente; contenido distinto es conflicto y aborta sin sobrescribir.

Los huérfanos presentes en la fuente se copian y reportan; no se borran silenciosamente. El reconciliador RSP-07F mantiene la política operativa posterior.

## 6. Consistencia e idempotencia

Después de copiar se exige exactamente un archivo canónico para cada `id_pozo` con `foto_url`. Se rechazan faltantes, duplicados, traversal, symlinks y archivos inesperados. El matching de extensiones no depende de mayúsculas/minúsculas.

Una copia parcial nunca escribe el marker. Los archivos ya promovidos conservan sus hashes y un retry los reconoce como idénticos, completa los restantes y recién entonces marca el layout. Un deploy que falle después de preparar fotos puede repetir la fase sin duplicar ni pisar contenido.

## 7. Backup y restore del primer upgrade

El backup continúa siendo obligatorio y ocurre después de preparar el volumen. `backup.sh` distingue:

- `managed`: ledger y checksums de migraciones RSP-07;
- `legacy-unmanaged`: schema legacy real con tablas, pero sin ledger.

Una DB realmente vacía sin ledger sigue siendo inválida. `restore.sh` valida manifest, checksums, dump y fotos antes de mutar; para un bundle legacy restaura el schema sin fabricar ledger y elimina un ledger residual del target reemplazado antes de validar el estado legacy.

La foto representativa mantuvo SHA-256 exacto desde el contenedor legacy, el volumen nuevo, el tar del backup y el volumen restaurado:

```text
af5e858109bd46675466bb1c7532f89d4b5a5cdf38074ba7ec2befc810e0461b
```

## 8. Rollback del primer upgrade

Antes del switch, un fallo conserva el contenedor legacy y su filesystem, por lo que se reinicia ese mismo contenedor. El volumen parcial queda detectable y el siguiente intento es seguro.

Después del switch, una imagen anterior a RSP-07 no conoce `FOTOS_DIR` ni el layout del volumen. Por ello un rollback **solo de aplicación a esa imagen legacy no debe clasificarse como compatible**. La ruta segura es restore completo desde el bundle previo y recuperación con un runtime que entienda el storage persistente; no se copian fotos de vuelta al filesystem efímero ni se destruye el volumen. Esta decisión especial debe ser explícita para el operador, igual que la compatibilidad de migraciones forward-only.

## 9. Simulacro real desde `main`

`scripts/test-first-upgrade-from-main.ps1` crea un archive temporal de `main`, sin checkout ni cambio de rama, y levanta un project aislado con PostgreSQL, API legacy y frontend/proxy. La prueba demostró:

1. ausencia inicial del volumen RSP-07;
2. inicialización y backup de una instalación legacy sin fotos;
3. pozo y foto real dentro de `/api/public` con referencia DB;
4. fallo de copia inyectado antes del backup;
5. ausencia de backup falso y conservación del mismo contenedor legacy;
6. retry idempotente, backup legacy, adopción del baseline y migración 006;
7. health, smoke HTTPS, foto protegida y PDF;
8. segundo prepare como no-op;
9. restore del bundle y nueva verificación integral.

Evidencia final:

```json
{"main_archive":true,"photo_volume_absent_before":true,"legacy_empty_initialized":true,"legacy_empty_backup":true,"legacy_source":"/api/public","partial_copy_aborted_before_backup":true,"legacy_container_preserved":true,"retry_safe":true,"photo_storage_phase":true,"legacy_schema_adopted":true,"backup_schema":"legacy-unmanaged","second_prepare_noop":true,"restore_ok":true,"smoke_ok":true,"assets_https":true,"photo_sha256":"af5e858109bd46675466bb1c7532f89d4b5a5cdf38074ba7ec2befc810e0461b"}
```

## 10. Assets locales y causa del P2

El frontend todavía cargaba dos recursos Imgur mientras producción imponía `img-src 'self' data: blob:`. CORS no podía corregirlo: el navegador bloqueaba logo y fondo por CSP.

Se incorporaron los mismos binarios originales:

| Asset | Ruta local | MIME/dimensiones | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Fondo | `/assets/branding/background.jpeg` | JPEG, 3840×2160 | 2.046.485 | `af5e858109bd46675466bb1c7532f89d4b5a5cdf38074ba7ec2befc810e0461b` |
| Logo | `/assets/branding/logo.png` | PNG, 1347×600 | 115.051 | `81d160cd4f4d4953f3f5359339969066708ba81d2af53bc5b254d72ebc5308ef` |

`styles.css` y `app.html` apuntan ahora a rutas same-origin compatibles con desarrollo, SPA y producción. No se cambiaron colores, dimensiones, proporciones ni layout.

## 11. CSP final

La política sigue siendo:

```text
img-src 'self' data: blob:
```

No se agregó Imgur, `https:` genérico ni wildcard. El build productivo contiene ambos assets byte a byte y cero referencias runtime a `imgur.com`. En el stack HTTPS, ambos GET respondieron 200 con `image/jpeg` e `image/png`. Los assets mantienen caching normal del frontend y no son rutas autenticadas.

## 12. Pruebas y regresiones

- matriz de storage: vacío, foto, faltante, fuente inaccesible, no-op, parcial idéntico, conflicto, fallo parcial y retry: OK;
- simulacro real archivado desde `main`: OK, incluido backup/restore y SHA-256;
- regresión upgrade N/N+1/R2: OK;
- backup/restore/migrations/bootstrap RSP-07C: OK;
- API build: OK;
- API suite completa: **220/220**;
- frontend production build: OK;
- frontend suite completa: **178/178**;
- assets en `dist`: hashes iguales y cero referencias Imgur;
- PowerShell: parse de todos los scripts modificados OK;
- POSIX: `sh -n` de todos los scripts modificados OK;
- Compose production: ejercitado por los dos simulacros completos;
- `git diff --check`: OK.

Se preservaron deployment state, rollback desde audits fallidos, backup/restore, migrations checksum/lock, bootstrap, reconciliación de fotos, HTTPS, CSP, Permissions-Policy, HSTS, Swagger off, cookies, CSRF, CORS, WebSocket, rate limits, logging, timeouts DB, PDF concurrency y migración automática de development.

## 13. Cleanup y seguridad

Los scripts usan project names, volúmenes, redes, certificados, env y backups temporales aislados. Sus bloques `finally` eliminaron containers, networks, volumes, imágenes de prueba, archives, certificados y bundles. No se leyó ni versionó `.env`, no se usaron secretos reales y ningún log contiene credenciales.

## 14. Hallazgos cerrados y riesgos residuales

P1 y P2 quedan cerrados. Riesgos operativos residuales:

- una fuente legacy con DB/fotos ya inconsistentes exige intervención; el flujo aborta deliberadamente;
- archivos huérfanos se conservan para reconciliación y consumen espacio hasta decisión operativa;
- el primer rollback posterior al switch no puede tratar una imagen legacy como storage-compatible;
- POSIX tiene paridad de implementación, pruebas contractuales y sintaxis; el Docker end-to-end se ejecutó desde PowerShell en el host Windows.

## 15. Pendiente fuera de etapa

No quedan P1/P2 web de RSP-07F-R3. **P2-10 autenticación Android** permanece fuera de esta etapa.
