# ETAPA RSP-07F-R13 — build local, reconciliación de fotos y ledger prefijo

## Alcance

Se cerraron exclusivamente los tres hallazgos del review global posterior a R12:

- build local opcional del frontend incompatible con Angular CLI 20;
- dos archivos físicos válidos para un mismo pozo sin hallazgo de reconciliación;
- ledger de migraciones con huecos aceptado antes de aplicar migraciones antiguas fuera de orden.

No se modificaron funcionalidades de negocio, migraciones SQL, restore, contratos de autenticación, despliegues externos ni secretos.

## Build local productivo

La causa era `npm run build --prod` en `front/Dockerfile`. El script `build` ejecuta Angular CLI 20.3.6 y esa versión ya no admite `--prod`. Se agregó un target explícito:

```text
npm run build:production
ng build --configuration production
```

El Dockerfile web usa únicamente `build:production`. No invoca `build:native`, no recibe `NATIVE_BACKEND_ORIGIN` y conserva `src/environments/environment.ts`: API `/api` y WebSocket `/ws` derivados del origin del navegador.

La rama `BUILD_IMAGES=true` de ambos deploys continúa construyendo `api` y `front`; la rama falsa continúa haciendo pull. Los comandos de imágenes están antes de la fase de migración y los scripts conservan terminación inmediata (`set -eu` y `$ErrorActionPreference="Stop"`), por lo que un fallo del build no avanza a migraciones ni al arranque de los nuevos servicios.

La construcción aislada equivalente a `BUILD_IMAGES=true` produjo las imágenes locales `rsp07f-r13-api:local` y `rsp07f-r13-front:local`. La inspección del artefacto confirmó `/api/`, `/ws` y ausencia del fixture `native-backend.example`.

## Reconciliación de fotos duplicadas

La causa era que `archivosPorPozo` agrupaba todos los candidatos, pero para una referencia DB sólo se comprobaba que el grupo no estuviera vacío. Como ambos archivos pertenecían a un pozo referenciado, tampoco aparecían como huérfanos.

El reporte dry-run ahora incluye:

- contador `archivos_duplicados`, que cuenta pozos afectados;
- hallazgo `archivos_duplicados` con `id_pozo`, `cantidad` y `paths`;
- nombres relativos al storage canónico, validados y ordenados, sin rutas externas.

`pozo-123.jpg` más `pozo-123.png` genera un solo hallazgo inequívoco con cantidad 2. No se marca además como huérfano y no se elimina ni elige automáticamente ningún candidato. Se preservaron faltantes, huérfanos, `.trash`, entradas inseguras, symlinks y traversal.

`leerFotoPozo` no cambió en R13: hacerlo habría alterado el contrato HTTP más allá del hallazgo solicitado. La detección y decisión de reparación permanecen en el reconciliador operativo; la elección de qué archivo conservar requiere intervención explícita.

## Ledger como prefijo exacto

La causa era una validación fila por fila: comprobaba identidad y checksum de cada versión registrada, pero no que faltara una versión anterior. Después, el cálculo de pendientes podía intentar rellenar el hueco fuera del orden histórico.

Con `N` filas aplicadas, el ledger debe coincidir por versión exactamente con `localMigrations.slice(0, N)`. Son válidos el ledger vacío, cualquier prefijo desde `000` y el ledger completo. Se rechazan, entre otros:

- `[001]`;
- `[000,002]`;
- `[000,001,003]`;
- `[006]`;
- cualquier orden distinto, duplicado, formato inválido o versión local desconocida.

La validación ocurre después de adquirir el advisory lock y antes de abrir una transacción de migración, insertar filas o ejecutar SQL pendiente. El error indica que el ledger no es un prefijo contiguo; no rellena huecos, borra filas ni reordena el estado.

Después de validar el prefijo se siguen comprobando nombre y checksum. R10 se preserva sin cambios: CRLF/CR se canonicaliza a LF, el checksum CRLF legacy sólo se acepta para el mismo SQL y todo cambio real de contenido falla.

`--adopt-current-schema` sigue disponible únicamente cuando no existe ledger y el esquema histórico supera su verificación. Un ledger existente corrupto o no contiguo falla incluso si se pasa el flag, por lo que adoption no puede ocultarlo. Un ledger restaurado con huecos será rechazado en el siguiente run sin reparación automática.

## Pruebas y evidencia

- API `npm run build`: OK.
- API `npm test`: 253/253 OK.
- pruebas focalizadas de fotos, migrador, cleanup y contratos: 35/35 OK;
- frontend `npm run test:config`: 7/7 OK;
- frontend `npm run test:build-targets`: native y web OK; web same-origin; Android auth continúa pendiente;
- frontend ChromeHeadless: 185/185 OK;
- Docker Compose build aislado de API + frontend: OK con Angular production explícito;
- inspección del artefacto Docker web: `WEB_ARTIFACT_SAME_ORIGIN_OK`;
- migraciones PostgreSQL aisladas: base vacía, 7 migraciones, rerun no-op, datos preservados y fallo visible: OK;
- ledger: vacío, prefijos parciales, completo, huecos, sólo `006`, orden inválido, checksum alterado y CRLF legacy cubiertos;
- ledger no-prefix con `--adopt-current-schema`: falla bajo lock antes de `BEGIN`, SQL o `INSERT`;
- fotos: JPG único, PNG único, JPG+PNG, otro pozo, huérfano, faltante, trash, entrada insegura, symlink y no borrado automático cubiertos;
- contratos `BUILD_IMAGES=true/false`, orden previo a migrate, ausencia de `--prod` y separación web/native cubiertos;
- contratos de deployment R2, R5 y modos POSIX R7: OK;
- `git diff --check`: OK.

Los tres hallazgos del review (1 P1 y 2 P2) quedan cerrados. El P2 pendiente de autenticación Android indicado en R12 continúa fuera del alcance de R13.
