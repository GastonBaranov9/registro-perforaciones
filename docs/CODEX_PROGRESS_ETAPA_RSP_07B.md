# ETAPA RSP-07B — Runtime de producción y persistencia

Fecha de cierre técnico: 2026-08-13

Rama: `feature/rsp-07-produccion`

Fuente de verdad: `docs/CODEX_AUDITORIA_RSP_07A_PRODUCCION.md`

## 1. Resultado y P1 de RSP-07A abordados

RSP-07B deja una base de producción local durable y comprobable. El stack construye API y frontend, mantiene PostgreSQL en una red interna, ejecuta la API sin privilegios, conserva las fotos en un volumen dedicado y expone liveness/readiness reales. No configura TLS ni servicios externos.

| ID de RSP-07A | Nombre exacto del problema | Estado después de RSP-07B |
|---|---|---|
| P1-01 | Build y production usan imágenes/nombres distintos y tags mutables | Resuelto en el contrato del repositorio: build y production comparten referencias completas, las imágenes base tienen versión y digest, y `API_IMAGE_REF`/`FRONT_IMAGE_REF` admiten tag Git SHA o digest. No se publicó ninguna imagen. |
| P1-02 | Filesystem efímero y ownership incompatible con usuario Node | Resuelto para el piloto de una réplica: volumen `raul_silva_fotos`, ruta canónica y UID/GID 1000. El backup continúa cubierto por P1-06. |
| P1-03 | API 5 MB vs multipart/Nginx 1 MiB | Resuelto: máximo binario 5.000.000 bytes, base64 calculado, JSON acotado, multipart explícito y proxy en 7 MiB. |
| P1-04 | Puerto 5432 publicado | Resuelto: producción no declara `ports` para PostgreSQL y usa la red interna `backend`. |
| P1-07 | Sin health/readiness/restart uniforme | Resuelto en este alcance: endpoints, healthchecks, dependencias condicionadas por salud y `unless-stopped`. El cierre ordenado del pool permanece como P2-06. |
| P1-08 | Dominio histórico, SPA/WS/TLS incompletos | Parcial: se eliminaron el dominio histórico y las URLs absolutas; SPA, `/api` y `/ws` funcionan same-origin por HTTP local. TLS, dominio y proxy HTTPS definitivo permanecen para RSP-07C. |
| P1-10 | Contrato incompleto y sin validación | Resuelto para las variables de runtime incluidas en 07B: contrato documentado y validación fail-fast de API sin revelar valores secretos. |

Los P1-05, P1-06 y P1-09 no se modificaron porque migraciones automáticas, backups/restore y bootstrap admin están excluidos de RSP-07B.

## 2. Persistencia de fotografías

La única raíz de almacenamiento usada por alta completa, actualización, multipart, eliminación, lectura protegida y PDF es `FOTOS_DIR`. En producción Compose su valor es:

```text
/var/lib/registro-perforaciones/fotos
```

El volumen nombrado `raul_silva_fotos` se monta en `/var/lib/registro-perforaciones`. La API crea y verifica al iniciar tanto `fotos` como `fotos/.trash`, incluidos permisos de lectura y escritura. La recreación del contenedor no recrea el volumen.

Las fotos siguen sirviéndose exclusivamente por los endpoints autorizados de la API. No existe montaje del volumen en Nginx ni publicación directa del filesystem. La persistencia elegida es adecuada para el piloto de una sola réplica; object storage sigue fuera de alcance.

## 3. Usuario y permisos

La imagen de API termina con `USER node:node`. En la imagen oficial usada corresponde a UID/GID `1000:1000`, confirmado dentro del stack de prueba. Los artefactos se copian con ownership `node:node` y el directorio inicial del volumen se crea con ese mismo ownership; no se usa `chmod 777`.

La API solo necesita escribir el volumen de fotos y los temporales normales del sistema. `pdf-lib` genera el PDF en memoria; el endpoint de informe no necesita persistir archivos PDF. El comando auxiliar histórico que escribe `./output` no forma parte del runtime HTTP.

## 4. PostgreSQL interno

`postgres` solo pertenece a la red `backend`, marcada `internal: true`. La API accede mediante `postgres:5432`; el servicio declara `expose` para documentación interna pero no `ports`, por lo que 5432 no se publica al host.

Development conserva su acceso local en `127.0.0.1:${PGPORT}:5432`. No se cambió el modelo de inicialización/migraciones ni se ejecutaron operaciones sobre bases existentes.

## 5. Imágenes y versiones

Versiones fijadas sin upgrades mayores:

| Componente | Referencia |
|---|---|
| Node build/runtime | `node:24.18.0-alpine` fijada por digest |
| PostgreSQL | `postgres:16.14-alpine3.24` fijada por digest |
| Nginx frontend/proxy | `nginx:1.30.4-alpine3.24` fijada por digest |

`docker-compose.build.yaml` y `docker-compose.production.yaml` usan las mismas referencias completas de aplicación (`API_IMAGE_REF`, `FRONT_IMAGE_REF`). Es posible usar un tag inmutable basado en commit al construir localmente y un digest de registry al desplegar más adelante. La ausencia de cualquiera de estas referencias impide renderizar el Compose en vez de caer silenciosamente en `latest`.

## 6. Health y readiness

- `GET /health`: liveness, devuelve únicamente `{"status":"ok"}` y no consulta dependencias.
- `GET /ready`: ejecuta `SELECT 1` con timeout de consulta de 2 segundos; devuelve 200/`ok` o 503/`unavailable` sin filtrar el error.
- PostgreSQL: `pg_isready`.
- API: healthcheck sobre `/ready`.
- Frontend: endpoint Nginx local `/health`.
- Proxy: comprueba el liveness de API a través de `/health`.

La API depende de PostgreSQL saludable y el proxy depende de API y frontend saludables. Todos los procesos de larga duración usan `restart: unless-stopped`, con intervalos, timeouts, reintentos y `start_period` no agresivos.

## 7. Límites de upload

La fuente funcional continúa siendo 5.000.000 bytes por fotografía JPEG/PNG validada por firma y MIME:

| Capa | Límite |
|---|---|
| Foto binaria/servicio | 5.000.000 bytes |
| Multipart Fastify | 5.000.000 bytes, 1 archivo, 10 partes |
| Campo base64 | `ceil(5.000.000 / 3) * 4` caracteres |
| Body JSON de pozo completo | base64 máximo + 256.000 bytes para el resto del formulario |
| Proxy HTTP local | 7 MiB |

Superar multipart produce 413 mediante Fastify. Los esquemas/body limits rechazan JSON sobredimensionado antes de que llegue a la lógica de negocio. No se amplió el máximo funcional.

## 8. Variables de entorno

`.env.example` documenta placeholders y no contiene secretos utilizables.

| Variable | Producción | Secreta | Origen/uso |
|---|---|---|---|
| `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Obligatoria | password sí | PostgreSQL y API |
| `PGHOST`, `PGPORT` | Obligatoria para API | No | Compose fija `postgres:5432` internamente |
| `NODE_ENV`, `API_PORT` | Obligatoria para API | No | Compose fija `production` y `3000` |
| `FASTIFY_SECRET` | Obligatoria | Sí | Firma JWT/cookie; mínimo 32 caracteres, sin defaults triviales |
| `CORS_ORIGINS` | Opcional | No | Lista de origins HTTP(S) exactos; vacío conserva same-origin |
| `FOTOS_DIR` | Obligatoria para API | No | Compose fija la ruta canónica del volumen |
| `MAP_STATIC_URL_TEMPLATE` | Obligatoria | No | Debe ser HTTPS, incluir coordenadas y marcador de key |
| `MAP_STATIC_ALLOWED_HOST` | Obligatoria | No | Debe coincidir con el host de la plantilla |
| `MAP_STATIC_API_KEY` | Obligatoria | Sí | Solo backend; una key de producción distinta deberá inyectarse después |
| `MAP_STATIC_ATTRIBUTION` | Obligatoria | No | Atribución del mapa |
| `API_IMAGE_REF`, `FRONT_IMAGE_REF` | Obligatoria para Compose | No | Referencia completa con tag inmutable o digest |
| `HTTP_BIND_ADDRESS`, `HTTP_PORT` | Opcional | No | Defaults locales `127.0.0.1:8080` |

Las variables legacy `PDF_MAP_*` se conservan documentadas solo como fallback fuera del Compose de producción. No se realizó ninguna llamada a Google.

## 9. Validación de startup

`api/src/config/runtime.ts` centraliza el contrato nuevo. En `NODE_ENV=production` valida antes de escuchar:

- presencia de secretos, PostgreSQL, fotos y Maps;
- puertos enteros entre 1 y 65535;
- `FOTOS_DIR` absoluta y escribible, con `.trash` escribible;
- `FASTIFY_SECRET` no trivial y de al menos 32 caracteres;
- origins CORS exactos y sin rutas;
- URL Maps válida, HTTPS, marcadores requeridos y coincidencia con allowlist.

Los errores nombran la variable problemática pero no imprimen su contenido. Development y tests conservan defaults locales y no requieren el contrato completo de producción.

## 10. Prueba de producción local

Se agregó `scripts/test-production-runtime.ps1`. Crea credenciales aleatorias efímeras en el directorio temporal del sistema, elige un puerto loopback libre y usa un project name `rsp07b-runtime-*`. Ejecuta el equivalente a `docker compose up -d --build --wait` y elimina al finalizar únicamente sus contenedores, redes y volúmenes aislados.

Resultado final controlado:

```json
{"postgres_publicado":false,"api_uid":"1000","api_gid":"1000","health":"ok","ready":"ok","fotoPersistente":true,"pdfLeeVolumen":true,"pdfBytes":2998}
```

La prueba validó una foto JPEG mínima mediante el validador de aplicación, la escribió en `FOTOS_DIR`, recreó exclusivamente la API, comparó sus bytes después de la recreación, generó un PDF que la leyó desde el volumen y eliminó la evidencia. No ejecutó requests a Google ni tocó volúmenes ajenos.

## 11. P1 abiertos para RSP-07C/D/E

| ID | Estado pendiente |
|---|---|
| P1-05 | Runner/ledger de migraciones, instalación limpia y actualización segura: RSP-07D. |
| P1-06 | Backup coordinado de PostgreSQL y fotos, copia off-host y restore probado: RSP-07E. |
| P1-08 | TLS, dominio, headers de forwarding/trust proxy y runbook de certificados: RSP-07C. La parte same-origin/SPA/WS quedó preparada. |
| P1-09 | Bootstrap admin one-shot seguro: RSP-07D. |

## 12. Pruebas ejecutadas

| Validación | Resultado |
|---|---|
| API `npm run build` | OK |
| API suite completa | 184/184 OK |
| Frontend build production | OK; solo warnings ya conocidos de baseline/Stencil |
| Compose production/build/development `config --quiet` | OK; solo warnings locales de acceso al `config.json` de Docker, sin afectar el render |
| Build Docker API/frontend | OK |
| Stack aislado con `--wait` | PostgreSQL, API, frontend y proxy healthy |
| Inspección de bindings PostgreSQL | Sin puerto publicado |
| Recreación exclusiva de API | Foto persistente y PDF generado desde el volumen |
| Google Maps | Sin requests reales |
| `git diff --check` | OK en el cierre |

## 13. Riesgos residuales y límites de etapa

- El volumen local exige una sola réplica escritora y todavía no tiene backup; P1-06/P3-01 siguen vigentes.
- El proxy agregado es deliberadamente HTTP y loopback para validación local. No constituye la entrada HTTPS final.
- Migraciones, bootstrap admin, backups, rate limiting, policy Swagger, headers completos, logging avanzado, monitoring, S3 y Android no se abordaron.
- El cierre ordenado del pool/timeouts de conexión continúa como P2-06; readiness ya evita declarar disponible una API sin consulta DB exitosa.
- El build reporta vulnerabilidades de dependencias existentes; no se actualizaron dependencias generales en esta etapa. Deben tratarse mediante la política de supply chain P3-04 y priorización separada.
- Los gaps técnicos PDF 20/7 y el layout aprobado no se modificaron.
