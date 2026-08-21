# ETAPA RSP-07F-R15 — First-upgrade de fotos retry-safe

Fecha: 2026-08-21
Rama: `feature/rsp-07-produccion`
HEAD inicial: `43b255f0e3d315ae40457168419723d482b9e768`

## 1. Causa del P1

R3 trataba una copia ya presente en el volumen como aceptable únicamente si coincidían path, tamaño y SHA-256 con `/api/public` legacy. Si un deploy fallaba después de `photo_storage`, el recovery reactivaba la API legacy. Un reemplazo posterior convertía el snapshot viejo del volumen en un conflicto fatal y un delete dejaba una copia stale. El siguiente deploy no podía converger al estado autoritativo.

## 2. Autoridad y cutover

- Antes de un cutover exitoso, el contenedor legacy sin el mount persistente conserva la autoridad. Cada retry vuelve a exportar `/api/public` con la API detenida y refresca el volumen.
- Después del cutover, el API registrado por `deployment.env` usa `/var/lib/registro-perforaciones` como mount persistente. `prepare-photo-storage` lo clasifica como `not_applicable` y sólo verifica el volumen: nunca vuelve a importar `/api/public`.
- La existencia del volumen o del marker no transfiere autoridad por sí sola. La evidencia de cutover sigue siendo el deployment state persistido después de smoke; el mount del API previo materializa esa decisión en el siguiente run.

## 3. API legacy detenida

Los wrappers POSIX y PowerShell ahora inspeccionan `State.Running` y abortan salvo que sea exactamente `false`. El deploy ya ejecutaba maintenance, detenía proxy y detenía API antes de `photo_storage`; la nueva comprobación convierte esa precondición en un contrato local verificable. El export crea después un snapshot aislado y de sólo lectura para el one-shot.

## 4. Algoritmo mirror con staging

`photo-storage-migrate.sh` realiza el siguiente flujo para una fuente legacy disponible:

1. valida raíz, nombres canónicos `pozo-<id>.jpg|jpeg|png`, `.trash`, archivos regulares y ausencia de symlinks;
2. crea staging dentro del mismo volumen;
3. copia el namespace administrado desde el snapshot legacy, fija owner `1000:1000` y modos `0750/0640`, y verifica tamaño y SHA-256 de cada copia;
4. valida referencias DB: exactamente un candidato por pozo con `foto_url`;
5. genera manifiestos ordenados `path|size|sha256` para fuente y destino, y calcula un hash del snapshot;
6. clasifica `COPIED`, `UPDATED`, `REMOVED` y `UNCHANGED`;
7. sincroniza y promueve mediante renames en el mismo filesystem: activo → previous, staging → activo;
8. vuelve a validar y exige igualdad byte-a-byte de manifiestos;
9. escribe atómicamente el marker verificado y elimina el previous.

El mirror sólo administra fotos canónicas, `.trash` segura y el marker propio. No sigue symlinks, no acepta traversal y no borra otros volúmenes ni paths externos.

## 5. Reemplazos, deletes, extensión y altas

- Mismo path con bytes nuevos: el snapshot staged contiene el SHA nuevo y el resultado informa `UPDATED=1`.
- JPG → PNG: informa un archivo agregado y otro retirado; el árbol final contiene únicamente PNG, sin crear el duplicado que detecta R13.
- Delete legacy acompañado por la referencia DB actualizada: el path stale no aparece en staging y se retira al promover el snapshot.
- Archivo nuevo: aparece como `COPIED`.
- Cambios múltiples convergen por paths y SHA; un pozo sin cambios conserva el mismo contenido y aparece como `UNCHANGED`.

No se usa una heurística destructiva para elegir entre duplicados: dos candidatos para una referencia DB hacen fallar la validación del snapshot.

## 6. Marker

`.rsp-photo-storage-layout` se escribe sólo después de copiar, validar, promover y volver a comparar el snapshot. Contiene layout, SHA-256 del manifiesto y clase de fuente (`legacy` o `persistent`). En un refresh legacy se retira el marker anterior antes de preparar el nuevo snapshot; cualquier fallo deja el destino anterior restaurado pero sin un marker que afirme que el refresh terminó.

El marker prueba integridad/layout, no cutover. `deployment.env`, persistido después del smoke exitoso, sigue siendo la única evidencia de que el nuevo deployment asumió autoridad.

## 7. Orden respecto al backup

Se preservó el orden del deploy:

`maintenance → stop API legacy → mirror/verificación → backup → migrations → runtime → smoke → persist deployment state`

Por eso el backup del retry incluye la DB legacy actual y el snapshot de fotos refrescado, no la copia de un intento anterior. La simulación integral extrajo `photos.tar.gz` y verificó paths y SHA del reemplazo, ausencia del delete y presencia del alta.

## 8. Recuperación y fault injection

Hay fallos controlados, limitados a proyectos aislados `rsp07f-r3-*`, en:

- copia a staging;
- staging ya completo;
- promoción después de apartar el destino;
- snapshot promovido antes de su verificación final.

Si staging falla, el activo no se modifica. Si la promoción falla, el trap aparta el nuevo árbol parcial y renombra `previous` de vuelta a activo. No queda marker final ni directorios temporales. El failure handler del deploy puede reactivar el mismo contenedor legacy y un retry reconstruye staging desde cero.

## 9. Retry integral

La prueba desde un archive real de `main` ejecutó:

1. primer mirror con fotos 1, 2 y 4;
2. fallo controlado después de `photo_storage` y antes de backup;
3. recuperación del mismo API legacy;
4. entre intentos: pozo 1 JPG→PNG con SHA nuevo, pozo 2 eliminado y referencia DB retirada, pozo 3 agregado, pozo 4 sin cambios;
5. segundo deploy completo;
6. verificación del volumen, backup, migrations, runtime, smoke y deployment state;
7. restore del bundle y nuevo smoke.

Resultado: `DEPLOY_OK`, snapshot exacto `pozo-1.png|pozo-3.png|pozo-4.jpg`, backup con el mismo conjunto y restore correcto.

## 10. Post-cutover y rollback

Después del deploy exitoso se agregó deliberadamente un JPG stale a `/api/public` del contenedor. Con el API detenido, el prepare detectó el mount persistente, devolvió `MODE=existing COPIED=0` y no modificó el volumen. Así un fixture legacy viejo no puede sobrescribir datos modernos.

Los contratos de application/full rollback y restore R10 no cambian. La promoción reversible protege el destino previo; el backup se crea únicamente después del refresh verificado.

## 11. POSIX y PowerShell

Ambos wrappers imponen que el API previo esté detenido y llaman al mismo one-shot POSIX `photo-storage-migrate.sh`. PowerShell sólo adapta argumentos/env y export temporal; no existe una segunda implementación del mirror. La fault injection tiene la misma restricción de proyecto en ambos caminos.

## 12. Pruebas y resultados

- `scripts/test-photo-storage-migration.ps1`: first migration, retry idéntico, replace, JPG→PNG, delete, add, cambios múltiples, missing DB, source unavailable, fallo de copia/staging/promoción/post-verificación y no-reimport post-cutover: OK.
- `scripts/test-first-upgrade-from-main.ps1 -ProjectName rsp07f-r3-main-r15`: retry completo, backup refrescado, restore y smoke: OK.
- API `npm run build`: OK.
- API `npm test`: 256/256 OK, incluida reconciliación R13 de duplicate/orphan/missing/trash/unsafe/symlink.
- `test-rsp07f-r5-contracts.ps1`: deploy/rollback POSIX/PowerShell OK.
- `test-rsp07f-r14-timeouts.ps1`: `nginx -t` y Compose renderizado OK; timeouts/grace R14 preservados.
- Shell syntax, `git diff --check`, secret scan y estado Git: registrados en el cierre final.

## 13. Hallazgo cerrado

El first-upgrade ya no exige que una copia parcial anterior sea idéntica. Mientras legacy siga siendo autoritativo, cada intento refresca el volumen a un snapshot exacto y verificable; después del cutover no vuelve a importar legacy automáticamente.

## 14. Pendiente externo

El P2 de autenticación Android continúa pendiente y fuera del alcance exclusivo de RSP-07F-R15.
