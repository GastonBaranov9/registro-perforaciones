# RSP-07A — Auditoría de preparación para producción

- Fecha de auditoría: 2026-08-13
- Rama auditada: `feature/rsp-07-produccion`
- HEAD base: `da85f7ff6d021aad5ab4808c81027eec0ddc8aa0`

## 1. Resumen ejecutivo

El sistema conserva una base funcional razonable para producción: frontend Angular/Ionic, API Fastify/TypeScript, PostgreSQL 16, sesiones JWT en cookie HttpOnly, CSRF de doble envío, roles con `version_sesion`, validación real de imágenes, PDF generado íntegramente en Node y Google Maps Static consultado solo por el backend. No se encontró evidencia de un hallazgo P0 en el repositorio auditado.

El repositorio **todavía no es desplegable de forma real, repetible y segura**. Hay 10 bloqueos P1: artefactos de contenedor no trazables entre build y deploy; fotos no persistentes y probablemente no escribibles; límites de upload incompatibles; PostgreSQL publicado; ausencia de un ejecutor de migraciones; ausencia de backups/restauración; falta de health/readiness y política uniforme de reinicio; proxy/TLS/SPA/WebSocket incompletos junto con URLs frontend fijadas a un host anterior; bootstrap admin repetible de forma peligrosa; y contrato de variables/secrets incompleto.

La arquitectura recomendada para el piloto es una única origin:

```text
Internet (HTTPS)
        |
        v
Reverse proxy: https://app.dominio
        |-- /, assets, rutas SPA ------> frontend Nginx (Angular/Ionic/PWA)
        |-- /api/* --------------------> API Node/Fastify :3000
        `-- /ws -----------------------> API WebSocket
                                             |
                        +--------------------+-------------------+
                        |                    |                   |
                        v                    v                   v
                  PostgreSQL          volumen de fotos    Google Maps Static
                  red interna         persistente         HTTPS, backend-only
```

Esta topología evita CORS en el navegador, mantiene funcional el CSRF actual y permite cookies host-only, `Secure` y `SameSite=Lax`. PostgreSQL y el volumen de fotos no deben publicarse a Internet.

Para el primer piloto se recomienda **volumen persistente local para fotos**, con permisos explícitos para el UID/GID de la API, backup coordinado con PostgreSQL y una sola réplica escritora. Object storage compatible con S3 es la opción robusta posterior para múltiples réplicas, durabilidad y escalado, pero requiere abstraer el almacenamiento y cambiar las operaciones transaccionales actuales.

Alcance y límites: fue una auditoría estática del repositorio y de sus artefactos de build. No se consultó Google, no se levantó ni alteró una base de datos y no se verificaron firewall, DNS, certificados, imágenes remotas ni backups externos reales.

## 2. Arquitectura actual

### 2.1 Flujo efectivo del repositorio

```text
Internet
  -> Nginx proxy (`proxy/https.conf.template`, puertos 80/443)
     -> Nginx del contenedor `front` para Angular/Ionic
     -> Fastify `api:3000` bajo `/api/`
        -> PostgreSQL `postgres:5432`
        -> `/api/public` dentro del filesystem del contenedor para fotos
        -> `maps.googleapis.com` por HTTPS para mapa estático
```

El proxy histórico sirve frontend y API en el mismo host. Es una decisión favorable para la seguridad actual. El frontend de producción compila, sin embargo, URLs absolutas a `grupo5.brazilsouth.cloudapp.azure.com`; no recibe configuración en runtime.

### 2.2 Estado por componente

| Componente | Estado actual | Evaluación |
|---|---|---|
| Frontend Angular/Ionic | Build production con hashing, service worker y sin sourcemaps observados | Base lista; dominio, SPA fallback, WS y política de actualización pendientes |
| API Fastify/TypeScript | Compila; usuario `node`; logging Fastify; auth y autorización presentes | Base lista; health, cierre ordenado, límites, headers y configuración production pendientes |
| PostgreSQL | Esquema fresco y migraciones 001..005 presentes; volumen de datos | Datos modelados; automatización de upgrades, aislamiento de red y recuperación pendientes |
| Fotos | JPEG/PNG, firma, 5 MB, rutas generadas, acceso autenticado y reemplazo con compensación | No aptas tal como está desplegado; aptas para piloto con volumen, permisos y backups |
| PDF | `pdf-lib`, fuentes estándar embebidas, foto y mapa opcionales | Runtime suficiente al construir la imagen correcta; faltan límites de concurrencia/memoria |
| Google Maps Static | Solo backend, HTTPS, host exacto, timeout, MIME/firma/tamaño y redirect manual | Implementación lista; falta key PROD separada y operación segura de secretos |
| Reverse proxy/TLS | Plantilla Nginx y forwarding headers parciales | Incompleto para alta inicial, uploads, SPA, WS, headers y renovación de certificados |

## 3. Qué ya está listo

- API y frontend compilan desde el checkout auditado.
- La cookie de sesión es HttpOnly, host-only, `Path=/`, `SameSite=Lax`, expira a las 10 horas y pasa a `Secure` con `NODE_ENV=production`.
- El token y la cookie comparten expiración de 10 horas.
- El CSRF usa 32 bytes aleatorios, cookie legible por el frontend, header `X-CSRF-Token` y comparación constante.
- `version_sesion` se comprueba contra DB en cada request autenticada; inactividad, cambio de contraseña y cambios de rol revocan tokens anteriores.
- No hay endpoint de self-registration. La creación de usuarios está protegida por rol administrador.
- Las consultas SQL revisadas usan parámetros; las interpolaciones halladas para columnas de litología son constantes internas, no entrada del usuario.
- Las fotos usan nombres derivados del ID (`pozo-<id>.jpg|png`), no del filename del usuario; se valida MIME declarado, firma binaria y tamaño.
- Lectura, escritura y eliminación de fotos pasan por autenticación, roles y pertenencia del pozo.
- Reemplazo/eliminación de fotos usa lock transaccional, staging y restauración compensatoria.
- Maps mantiene la key en backend, exige HTTPS y hostname exacto, rechaza credenciales en URL y redirects, limita a 2 MB, valida MIME/firma y aplica timeout de 3 s.
- Preview y mapa persistido están autenticados/autorizados y responden `Cache-Control: private, no-store`.
- El PDF usa `pdf-lib` y Helvetica estándar; no necesita Chromium, binarios, fonts del SO ni escritura temporal en la ruta HTTP.
- El layout PDF y sus gaps técnicos aprobados de 20/7 permanecen intactos.
- API Dockerfile usa multi-stage y ejecuta la aplicación como usuario no-root.
- El frontend genera nombres con hash, activa service worker en producción y no contiene key de Google.
- `.env` está ignorado; no se hallaron certificados, keystores ni `.env` reales versionados.

## 4. Bloqueadores P0/P1

### P0

No se encontró evidencia de P0 crítico en el estado estático auditado. Esto no sustituye pruebas de penetración, revisión de infraestructura ni verificación de las imágenes remotas.

### P1

1. **P1-01 — Artefactos no reproducibles.** `docker-compose.build.yaml` construye `${DOCKER_USER}/api`, pero producción ejecuta `gastonbaranov9/proyecto-api:foto-fix`. El frontend tampoco fija tag/digest. El deploy no garantiza que el código probado sea el desplegado ni permite rollback confiable.
2. **P1-02 — Fotos efímeras/no escribibles.** Se guardan en `/api/public`, sin volumen en producción. Recrear el contenedor las elimina. Además, el Dockerfile declara `USER node:node` antes de copiar `public` sin `--chown`, por lo que la carpeta queda normalmente propiedad de root y el proceso no puede crear archivos.
3. **P1-03 — Upload inconsistente.** La aplicación promete 5 MB, los bodies JSON permiten aproximadamente 7,5 MB, pero `@fastify/multipart` conserva el límite por defecto de 1 MiB y Nginx no define `client_max_body_size` (también 1 MiB por defecto). Fotografías válidas fallarán según la ruta usada.
4. **P1-04 — PostgreSQL público.** Producción publica `5432:5432`; debe quedar solo en la red interna o ligado explícitamente a loopback si se justifica mantenimiento local.
5. **P1-05 — Migraciones no automatizadas.** No existe ledger ni comando que aplique 001..005 una sola vez y en orden. `scripts.sql` empieza eliminando tablas y no es una herramienta de upgrade. Ejecutarlo manualmente sobre una DB existente destruiría datos.
6. **P1-06 — Sin recuperación.** No hay backup/retención/restore documentado ni para PostgreSQL ni para fotos, ni prueba de pérdida total.
7. **P1-07 — Sin health/readiness operativo.** API, frontend y PostgreSQL carecen de healthchecks en producción; API y PostgreSQL tampoco tienen `restart` explícito. `depends_on` solo ordena inicio y no comprueba disponibilidad.
8. **P1-08 — Entrada HTTPS incompleta.** El frontend compila un host histórico, `/ws` no se enruta a la API, el Nginx del frontend no configura fallback de SPA, el ciclo inicial/renovación de certificado no es reproducible y los volúmenes de certbot no coinciden con el bind usado por proxy.
9. **P1-09 — Bootstrap admin inseguro para operación.** El script existe y usa variables, hash y transacción, pero hace upsert: repetirlo reactiva la cuenta, reemplaza su contraseña e incrementa la sesión. No verifica que sea la primera cuenta admin ni tiene guardia explícita contra repetición accidental.
10. **P1-10 — Contrato de configuración incompleto.** Faltan variables de CORS/dominio/URLs/puerto/directorio de fotos; `.env.example` no documenta bootstrap ni deploy; Compose acepta vacíos con warnings; no hay validación central de PG/Maps/entorno al arrancar.

## 5. P2 antes del piloto

- **P2-01:** agregar rate limiting, especialmente a `POST /login`, generación PDF y mapas.
- **P2-02:** definir headers HTTP: HSTS solo tras validar HTTPS, CSP del frontend, `X-Content-Type-Options`, política de framing, Referrer-Policy y Permissions-Policy.
- **P2-03:** proteger o deshabilitar `/docs` en producción; hoy Swagger UI es público.
- **P2-04:** decidir revocación de logout. Hoy elimina cookies del navegador, pero una copia del JWT continúa válida hasta 10 horas porque logout no incrementa `version_sesion`.
- **P2-05:** normalizar logs, eliminar `console.log`, no registrar objetos de negocio ni mensajes crudos del frontend y establecer rotación local.
- **P2-06:** configurar timeout de conexión/queries PostgreSQL y cierre ordenado del pool en SIGTERM. `connectionTimeoutMillis: 0` espera indefinidamente.
- **P2-07:** limitar concurrencia/tiempo/tamaño de PDF; cada request acumula foto, mapa y documento completo en memoria.
- **P2-08:** eliminar el archivo de foto al borrar un pozo y reconciliar periódicamente DB/volumen; hoy `DELETE pozo` deja un huérfano.
- **P2-09:** hacer deploy sin `down` previo, con smoke test y rollback por digest; el script actual provoca indisponibilidad y no ejecuta migraciones.
- **P2-10:** resolver autenticación/CORS/CSRF para Android antes de una app nativa; la combinación actual depende de JavaScript leyendo una cookie en la misma origin web.

## 6. P3 posteriores

- **P3-01:** abstraer fotos y migrar a object storage cuando haya más de una réplica, crecimiento o exigencia mayor de durabilidad.
- **P3-02:** observabilidad central, métricas, trazas y alertas gestionadas cuando el piloto justifique el costo.
- **P3-03:** revisar índices de foreign keys/consultas, constraints de rangos adicionales y dimensionamiento del pool con carga real.
- **P3-04:** automatizar SBOM, escaneo de dependencias/imágenes, actualización de bases y política de retención de releases.
- **P3-05:** diseño offline/sincronización Android, reintentos idempotentes y UX de conectividad intermitente.

## 7. Variables de entorno y secretos

Clasificación: A = obligatoria en producción; B = opcional o de uso puntual; C = solo desarrollo, test o herramienta de entrega. D = secreta; E = pública. “Privada” significa dato operativo/PII que no es credencial pero tampoco debe publicarse innecesariamente.

### 7.1 Runtime de aplicación

| Variable | Clase | Sensibilidad | Uso real / observación |
|---|---:|---:|---|
| `PGUSER` | A | E | Usuario PostgreSQL; no usar superusuario para la API |
| `PGPASSWORD` | A | D | Password PostgreSQL; `.env.example` contiene solo placeholder |
| `PGHOST` | A | E | Código la consume; producción la fuerza a `postgres` |
| `PGPORT` | A | E | Código la consume; dentro de Compose debe ser 5432 aunque el puerto host de desarrollo cambie |
| `PGDATABASE` | A | E | Nombre de DB |
| `FASTIFY_SECRET` | A | D | Firma JWT; debe ser aleatoria, larga, distinta por entorno y rotada con procedimiento |
| `NODE_ENV` | A | E | Activa `Secure`; producción ya la fija en Compose. Un valor incorrecto degrada cookies |
| `MAP_STATIC_URL_TEMPLATE` | A para conservar mapas | E, si solo contiene placeholder | Plantilla canónica; debe usar HTTPS y no contener una key literal |
| `MAP_STATIC_ALLOWED_HOST` | A para conservar mapas | E | Allowlist exacta, no wildcard |
| `MAP_STATIC_API_KEY` | A para conservar mapas | D | Key backend-only, separada para PROD |
| `MAP_STATIC_ATTRIBUTION` | A para conservar mapas | E | Texto visible en PDF/UI |
| `PDF_MAP_STATIC_URL_TEMPLATE` | B | E | Fallback legacy; documentado y usado solo si falta el canónico |
| `PDF_MAP_ALLOWED_HOST` | B | E | Fallback legacy |
| `PDF_MAP_STATIC_API_KEY` | B | D | Fallback legacy; retirar luego de migrar configuración |
| `PDF_MAP_ATTRIBUTION` | B | E | Fallback legacy |

No se usa `DATABASE_URL`. Tampoco existen variables para `CORS_ORIGINS`, cookie domain, cookie path, expiración, public URL, API URL runtime, WebSocket URL, puerto API o directorio de fotos. El puerto API está fijado a 3000 y el directorio de fotos se deriva de `dist/public`.

No existe secret CSRF global: se genera un token aleatorio por login. No existe un segundo JWT/session secret; `FASTIFY_SECRET` es el secreto de firma.

### 7.2 Bootstrap, build y deploy

| Variable | Clase | Sensibilidad | Uso real / observación |
|---|---:|---:|---|
| `ADMIN_EMAIL` | B, bootstrap | Privada | Requerida por el script de alta inicial; no documentada |
| `ADMIN_NAME` | B, bootstrap | Privada | Requerida por el script; no documentada |
| `ADMIN_PASSWORD` | B, bootstrap | D | One-shot; nunca persistirla en Git ni historial del shell |
| `DOCKER_USER` | C | E | Nombre de imágenes/build; falta en `.env.example` |
| `DOCKER_REGISTRY` | C | E | Usada por `scripts/push.sh`; falta en `.env.example` |
| `DOCKER_PASS` | C | D | Usada en CLI con `--password`, susceptible a exposición en proceso/historial; usar password-stdin/credential helper |
| `REMOTE_HOST` | C | E | Host de deploy y template TLS; falta en `.env.example` |
| `REMOTE_USER` | C | Privada | Usuario SSH; falta en `.env.example` |

### 7.3 Test/evidencia

`RSP06I_API_URL`, `RSP06I_EVIDENCE_DIR`, `RSP06I_R6_R1_PDF_PATH`, `RSP06J_API_URL`, `RSP06K_API_URL` y `RSP06K_R1_API_URL` son C, solo test/evidencia. Algunos tests también leen `FASTIFY_SECRET`. No pertenecen al contrato runtime de producción.

### 7.4 Diferencias y acciones

- `.env.example` documenta PG, `FASTIFY_SECRET`, Maps canónico y fallback legacy, pero omite bootstrap y entrega.
- El ejemplo usa `PGHOST=localhost`; producción lo reemplaza por el DNS interno `postgres`.
- La API no acepta `DATABASE_URL`; cualquier plataforma que solo lo entregue requerirá adaptación explícita.
- Los defaults de Maps (timeout 3 s, máximo 2 MB, cache 5 min/32 entradas) son seguros pero no configurables por entorno.
- `change_me` y `change_this...` son placeholders, no defaults de código; deben rechazarse por validación de startup si llegan a producción.
- No imprimir valores en diagnósticos, Compose renderizado, logs, CI o comandos. Los secretos deberían llegar por archivos/secret manager del runtime o variables protegidas, no dentro de la imagen.

## 8. PostgreSQL

### 8.1 Instalación limpia

`docker-compose.*` monta `api/db` en `/docker-entrypoint-initdb.d`. El entrypoint ejecuta `scripts.sql` en un volumen nuevo; no ejecuta automáticamente los SQL dentro de `migrations/`, pero `scripts.sql` incluye de forma relativa 003 y 004. El esquema fresco ya incorpora semánticamente 001, 002 y 005 en sus `CREATE TABLE`.

`scripts.sql` comienza con `DROP TABLE ... CASCADE`. Es aceptable únicamente como inicializador de un cluster vacío controlado. Debe renombrarse/aislarse o protegerse para que nadie lo confunda con una migración de actualización. La instalación completa tampoco está envuelta en una única transacción propia.

| Archivo | Propósito | Reejecución / riesgo |
|---|---|---|
| `001_add_version_sesion.sql` | Agrega versión y constraint positivo | Parcialmente idempotente; no tiene transacción explícita |
| `002_add_tuberia_filtros.sql` | Material de tubería y tabla filtro | Transaccional, pero el constraint agregado no usa guardia de existencia |
| `003_catalogo_litologias.sql` | Catálogo, seed, FK y backfill | Transaccional, no idempotente; requiere orden y registro |
| `004_propietario_operativo.sql` | Email/password opcionales y `cuenta_acceso` | Transaccional y simple |
| `005_intervalo_filtro_ranura.sql` | Ranura y constraint | Mayormente idempotente |

### 8.2 Actualización de DB existente

No hay tabla `schema_migrations`, runner, lock global de migración ni comando de release. Hace falta un job one-shot que:

1. espere DB ready con timeout;
2. tome advisory lock de migración;
3. lea una tabla de versiones;
4. aplique pendientes en orden y con `ON_ERROR_STOP`;
5. registre checksum/fecha/versión;
6. falle el deploy antes de iniciar la nueva API;
7. use migraciones compatibles hacia atrás y rollback de aplicación por digest.

### 8.3 Constraints, pool y operación

Hay PK/FK, uniqueness de emails/roles/catálogos, cascadas en tablas hijas y checks de rangos importantes. `TIMESTAMPTZ` se usa para timestamps; fechas calendario usan `DATE`. Encoding, locale y timezone del cluster no se fijan en Compose: deben declararse o verificarse en el runbook, con UTF-8 y zona operativa acordada (recomendado almacenar timestamps en UTC y presentar `America/Montevideo`).

El pool usa máximo 10 conexiones e idle 10 s; las operaciones complejas revisadas usan transacciones y liberan clientes. Faltan timeout de conexión finito, `statement_timeout`, cierre de `myPool` en SIGTERM y dimensionamiento conjunto API/DB. El tráfico interno Docker puede ir sin TLS en un único host aislado; una DB externa requeriría `sslmode`/CA explícitos.

## 9. Fotos y archivos persistentes

### 9.1 Comportamiento exacto

- Directorio: `/api/public` en la imagen de producción, calculado desde `dist/routes`/`dist/pdf`.
- Nombre: `pozo-<id_pozo>.jpg` o `.png`; staging y papelera usan UUID.
- Referencia DB: `pozo.foto_url`; las respuestas reconstruyen una ruta API protegida, no exponen una ruta física.
- Tamaño deseado: 1 byte a 5.000.000 bytes. Base64 limita texto a 7.000.000 caracteres y body de rutas completas a 7.500.000 bytes.
- Límite multipart efectivo actual: 1 MiB por default del plugin, antes de la validación de 5 MB.
- MIME: solo JPEG/PNG, con comparación del MIME y firma binaria.
- Autorización: sesión vigente, rol permitido y pertenencia/gestión del pozo.
- Traversal: no se usa el nombre aportado por el cliente; no se encontró ruta controlada por usuario.
- Concurrencia: reemplazo/eliminación usa row lock y advisory lock por pozo, staging, commit y compensación.
- Eliminación explícita: limpia DB y archivo. Eliminación del pozo: borra DB pero hoy no borra el archivo.
- Recreate: sin volumen, desaparecen todas las fotos; con más de una réplica, cada réplica tendría archivos distintos.

Clasificación: **la solución actual requiere cambios P1; después de montar y asegurar un volumen es apta para un piloto de una sola réplica.** No requiere object storage para el piloto, pero sí para una evolución robusta multi-instancia.

### 9.2 Opciones de primera producción

| Aspecto | A. Volumen persistente del servidor | B. Object storage compatible S3 |
|---|---|---|
| Simplicidad piloto | Mayor; cambios pequeños | Menor; exige cliente, credenciales y abstracción |
| Réplicas API | Una escritora o filesystem compartido | Naturalmente varias |
| Atomicidad actual DB/archivo | Se conserva mejor el flujo existente | Requiere diseñar estados, compensación y consistencia eventual |
| Durabilidad | Depende de disco, snapshots y backup off-host | Puede ofrecer versionado/replicación, según implementación |
| Backup | Tar/snapshot coordinado | Versionado/lifecycle/export, según servicio |
| Permisos | UID/GID y mount read-write | IAM mínimo por bucket/prefix |
| Recomendación | **Piloto** | **Largo plazo** |

Para volumen: montar una ruta dedicada (no todo `/api`), `chown`/`--chown` al UID de Node, no servirla como estática, limitar a una réplica, monitorizar espacio/inodos y respaldarla. Para S3: mantener nombres opacos, buckets privados, nunca URLs públicas permanentes, validar antes de subir, cifrar, versionar y descargar/streaming solo tras autorización.

## 10. Cookies, CORS y CSRF

### 10.1 Estado real

| Control | Estado |
|---|---|
| HttpOnly | `rsp_session=true`; `rsp_csrf=false` para que Angular lo lea |
| Secure | Solo si `NODE_ENV === "production"` |
| SameSite | `Lax` para ambas |
| Domain | No configurado: cookies host-only |
| Path | `/` |
| Expiración | Cookie 10 h; JWT 10 h |
| CSRF | Header/cookie constant-time; login exento; métodos seguros exentos |
| CORS | Credenciales habilitadas; solo tres origins localhost hardcodeadas |
| Inactividad | `authenticate` consulta DB y rechaza usuarios inactivos |
| Revocación | Password, desactivación y roles incrementan `version_sesion` |
| Logout | Borra ambas cookies; no revoca la copia server-side del JWT |

### 10.2 Topologías

1. **Misma origin (`https://app.dominio`, API `/api`) — recomendada.** No necesita CORS para tráfico normal; Angular puede leer `rsp_csrf`; host-only, Lax y Secure funcionan sin ampliar Domain.
2. **Subdominios (`app.dominio` y `api.dominio`).** La sesión host-only se enviaría a la API, pero JavaScript en `app` no puede leer la cookie CSRF de `api`; además hay que allowlistear exactamente el origin y mantener credenciales. Requiere cambiar cómo se entrega/lee CSRF o el scope de esa cookie, sin ampliar innecesariamente la cookie de sesión.
3. **Dominios completamente distintos.** `SameSite=Lax` no acompaña los `fetch` cross-site autenticados. Exigiría `SameSite=None; Secure`, CORS exacto y rediseño del canal CSRF; aumenta complejidad y superficie.

En HTTPS real: asegurar `NODE_ENV=production`, no configurar `Domain` salvo necesidad demostrada, conservar `Secure`, `HttpOnly`, Lax y Path. El reverse proxy debe preservar Host y `X-Forwarded-Proto`, y Fastify debe confiar solo en el proxy conocido para IP/protocolo; hoy recibe headers pero no configura `trustProxy`.

## 11. Docker y containers

| Control | Estado | Acción |
|---|---|---|
| Build API/frontend | Dockerfiles multi-stage; build local pasa | Unificar nombres, tag por SHA y desplegar digest probado |
| Usuario API | `node:node` | Mantener; corregir ownership del volumen/public |
| Usuario Nginx | Master según imagen estándar; workers de imagen | Endurecer filesystem/capabilities en etapa posterior |
| Healthcheck | Solo PostgreSQL en development | Agregar liveness/readiness y condiciones saludables en production |
| Restart | Solo proxy | `unless-stopped` para servicios stateful/app, con health y límites |
| Volumen DB | Sí | Mantener, proteger y respaldar |
| Volumen fotos | No | Agregar volumen dedicado P1 |
| Puertos | Proxy 80/443 y DB 5432 públicos | Publicar solo 80/443; DB solo red interna |
| Networking | Red bridge compartida | Correcto como base; no exponer API/front directamente |
| Secrets | Environment plana | Evitar imagen/Compose versionado; preferir secrets/files protegidos |
| Logs | Defaults Docker | Rotación por tamaño/cantidad y política de disco |
| Runtime PDF | Node + `pdf-lib`; sin binarios/font del SO | Suficiente si se construye la imagen local correcta |
| Imagen API | Dependencias production; Node 24 Alpine | Pin de versión/digest, provenance y escaneo |
| Imagen front | Nginx Alpine | Agregar config SPA/cache/headers; pin digest |

`PGPORT` no debe confundirse entre puerto host y puerto interno. La API conecta a `postgres:${PGPORT}`; si se cambia el puerto publicado de development, producción podría intentar un puerto interno inexistente. Usar 5432 internamente y una variable distinta solo si se publica en desarrollo.

## 12. HTTPS, reverse proxy y dominio

El repositorio contempla TLS, redirección 80→443, certificados Let's Encrypt montados y headers `Host`, `X-Real-IP`, `X-Forwarded-For` y `X-Forwarded-Proto`. No contempla de forma completa:

- bootstrap automático y renovación comprobada de certificados;
- coherencia entre bind `/etc/letsencrypt` y los named volumes `certs`/`certbot`;
- `trustProxy` controlado en Fastify;
- `client_max_body_size` y timeouts de upload/PDF;
- compresión y cache explícita para assets hash;
- fallback `try_files ... /index.html` en el Nginx del frontend;
- ruta WebSocket `/ws` al backend;
- headers de seguridad;
- página/estado de mantenimiento y rollback.

Topología propuesta: un dominio estable `https://app.dominio`, frontend en `/`, API en `/api/` y WebSocket en `/ws`. La URL API del frontend debe ser relativa (`/api/`) y la de WS derivada de `location.host`, o recibirse mediante config runtime no secreta. Así un mismo artefacto frontend sirve todos los entornos y las cookies existentes no requieren debilitamiento.

## 13. Google Maps Static

### Controles verificados

- Key utilizada solo en el backend; no apareció en el source ni artefacto frontend.
- URL exige `https:` y hostname exactamente igual a `MAP_STATIC_ALLOWED_HOST`.
- Rechaza username/password embebidos.
- Coordenadas se normalizan y los valores de template se codifican.
- `fetch` usa redirect manual; cualquier 3xx se rechaza.
- Timeout 3 s con AbortController.
- Content-Type solo PNG/JPEG, firma binaria coherente y máximo 2 MB anunciado y leído por streaming.
- Cache en memoria: 5 minutos, máximo 32 entradas. La cache key contiene la URL completa con key, pero no se registra.
- Errores devueltos son genéricos y no incluyen URL/key.
- Preview y lectura están autorizados y tienen `private, no-store`.

No se encontró logging explícito de la URL saliente. Debe evitarse agregarla a logs de fetch, tracing o errores porque contiene la key. La key DEV y la key PRODUCTION deben ser diferentes. La key PROD debe habilitar solo Maps Static y restringirse al backend según las capacidades técnicas del proveedor (por ejemplo IP de egreso estable), con cuota/alerta y rotación. No se realizó ninguna llamada a Google durante la auditoría.

Los fallbacks `PDF_MAP_*` mantienen compatibilidad, pero duplican superficie de secreto; migrar a `MAP_STATIC_*` y retirarlos en una etapa posterior controlada.

## 14. PDF

- Runtime: Node 24, `pdf-lib` y fuentes estándar Helvetica/HelveticaBold embebidas. No requiere browser headless, libc adicional, paquetes de fonts ni ejecutables externos.
- Fotos: se leen desde el mismo directorio persistente, máximo 5 MB, y se embeben en memoria.
- Mapa: llamada backend con timeout 3 s, máximo 2 MB y fallback visual si no está disponible.
- Filesystem temporal: la ruta HTTP genera y responde bytes en memoria; no usa temporal. El comando manual `generar:pdf` escribe `./output`, pero no participa en el endpoint.
- Memoria: foto + mapa + PDF completo viven en memoria por request. No existe semaphore/cola, límite de requests ni máximo de páginas/documento.
- Concurrencia: no está regulada; una ráfaga puede consumir CPU/memoria y cuota Maps.
- Limpieza: no hay temporales en HTTP que limpiar. La cache de mapas expira/evicta en memoria.
- Tamaño: no hay límite final documentado ni métrica. Debe medirse con el pozo más grande real.

El Dockerfile construido desde este repositorio contiene todo lo requerido por el motor PDF. El Compose de producción usa una imagen API remota distinta y no permite afirmar que esa imagen tenga exactamente este código/dependencias. La persistencia/permisos de fotos sí bloquea la portada aunque el motor PDF funcione. No se modificó el layout ni los gaps técnicos 20/7.

## 15. Backups y recuperación

### 15.1 Objetivos piloto

- RPO objetivo: 24 horas.
- RTO objetivo: 8 horas para recuperar servicio en un host sustituto.
- Revaluar tras conocer volumen, costo de reingreso y dependencia diaria.

### 15.2 Estrategia

1. PostgreSQL: `pg_dump` formato custom diariamente, con fecha, versión, checksum y log de éxito; conservar 14 diarios, 8 semanales y 6 mensuales.
2. Fotos: snapshot/tar diario del volumen, con lista de archivos y checksum; misma retención lógica que DB.
3. Off-host: copiar ambos conjuntos cifrados fuera del servidor principal. Una copia que comparte disco/host no cubre pérdida total.
4. Consistencia: ejecutar en una ventana breve de mantenimiento o pausar escrituras, capturar dump DB y snapshot de fotos bajo un mismo ID de backup y guardar manifiesto. Si no se pausan escrituras, documentar reconciliación de referencias/archivos.
5. Restauración mensual: restaurar en entorno aislado, aplicar checks, contar entidades/fotos, generar al menos un PDF y registrar tiempo/resultado.
6. Disaster recovery trimestral: host limpio, red privada, secretos nuevos cuando corresponda, restauración DB+fotos, health y smoke test.
7. Rotación: borrar solo backups cuyo checksum/copia off-host/retención hayan sido verificados; nunca borrar el último backup exitoso.

### 15.3 Checklist de restore

- Provisionar PostgreSQL compatible y volumen vacío con permisos correctos.
- Verificar checksum y versión de aplicación/esquema asociados.
- Restaurar DB y ejecutar `ANALYZE`; verificar versión de migraciones.
- Restaurar fotos sin exponerlas estáticamente.
- Ejecutar reconciliación: referencias DB sin archivo, archivos sin referencia, extensión/firma/tamaño.
- Arrancar API con secretos válidos, luego frontend/proxy.
- Comprobar login, roles, usuario inactivo, lectura/subida de foto, mapa fallback/real controlado y PDF.
- Documentar pérdida desde el timestamp del backup (RPO) y tiempo total (RTO).

## 16. Logs y observabilidad

Fastify tiene logger de requests/errores habilitado. No hay formato/política por entorno, redacción explícita, correlation ID documentado, métricas, health endpoint, rotación ni alertas. El código contiene `console.log/error` en frontend y backend; algunos registran IDs, objetos de negocio, resultados de operaciones, mensajes de error y, en el comando manual PDF, el reporte completo. No se encontró logging de cookies/tokens/passwords/key Google, pero la práctica actual no garantiza redacción futura.

Mínimo viable piloto, sin plataforma externa:

- logs JSON de aplicación a stdout con nivel configurable y request ID;
- no registrar headers Cookie/Authorization, passwords, body de login, base64, emails completos ni URL saliente de Maps;
- errores 5xx con stack solo en log servidor, respuesta genérica al cliente;
- rotación Docker por tamaño/cantidad y alerta de espacio/inodos;
- `/health/live` sin dependencias y `/health/ready` con query corta a DB y timeout;
- chequeo host periódico de HTTPS, readiness, uso de disco, estado/espacio PostgreSQL y edad del último backup;
- alerta básica por caída, repetición de 5xx, disco alto, DB no ready o backup vencido;
- runbook con responsables, ubicación de logs y comandos de diagnóstico sin secretos.

## 17. Bootstrap del administrador inicial

Estado actual: `api/src/scripts/bootstrap-admin.ts` toma `ADMIN_EMAIL`, `ADMIN_NAME` y `ADMIN_PASSWORD`, hashea con bcrypt costo 12, crea roles, usa transacción y cierra el pool. El build genera el script en `dist/scripts`, aunque no hay script npm ni runbook para invocarlo. No hay password fija ni self-registration.

Bloqueo: `ON CONFLICT (email) DO UPDATE` cambia nombre/password, reactiva e incrementa `version_sesion`. Una ejecución accidental repetida puede tomar una cuenta existente. Tampoco exige ausencia de otro admin ni diferencia “crear primero” de “rotar credenciales”.

Procedimiento propuesto para RSP-07 posterior:

1. job/CLI one-shot separado del arranque normal;
2. variables/secret file efímero, fuera de Git y eliminado al terminar;
3. advisory lock global;
4. comprobar que no existe ningún admin con acceso; si existe, abortar sin cambios;
5. crear roles idempotentemente y **crear** la cuenta, nunca upsert/reactivar/resetear;
6. transacción y mensaje de éxito sin email/password;
7. comando separado y auditado para recuperación/rotación, con confirmación explícita;
8. verificar login y retirar el secreto de bootstrap.

## 18. Preparación para Android futuro

El repositorio ya contiene configuración Android/Capacitor y dependencias de cámara/geolocalización, pero esta auditoría no implementa ni valida una app nativa.

Riesgos reales de las decisiones de producción:

- Un WebView suele usar una origin como `capacitor://localhost`; será cross-origin respecto de la API. CORS debe permitir exactamente la origin nativa soportada.
- La app actual obtiene CSRF leyendo `document.cookie`. En una origin nativa no puede leer la cookie CSRF host-only de `api.dominio`; `SameSite=Lax` también puede impedir cookies si el contexto resulta cross-site.
- No debe cambiarse ahora a `SameSite=None` ni deshabilitar CSRF. Antes de Android se necesita diseñar y probar un canal nativo seguro manteniendo el mismo backend y revocación.
- El dominio API debe ser estable, HTTPS y versionable; certificados públicos válidos son obligatorios para Android.
- Cámara/fotos necesitan compresión y control del tamaño antes de base64/multipart; 5 MB y conectividad móvil requieren progreso/reintento seguro.
- Geolocalización necesita permisos runtime, precisión y manejo de ausencia/denegación; el backend ya normaliza coordenadas.
- PDF requiere descarga/visualización/compartir mediante APIs nativas y manejo de almacenamiento temporal.
- No hay cola offline, idempotency keys ni sincronización de conflictos; con conectividad intermitente, reintentar escrituras actuales puede duplicar operaciones.

Estas son tareas P2/P3 de compatibilidad futura, no razón para rediseñar auth en RSP-07A ni para retrasar una web piloto con misma origin.

## 19. Orden recomendado de implementación RSP-07B en adelante

1. **RSP-07B — Contrato production y artefactos:** configuración validada, URLs relativas/runtime, secrets, imágenes por SHA/digest, Compose coherente y sin DB pública.
2. **RSP-07C — Entrada segura y salud:** Nginx SPA/WS/uploads, TLS reproducible, headers, trust proxy, health/readiness, restart y cierre ordenado.
3. **RSP-07D — Datos y bootstrap:** runner/ledger de migraciones, prueba de instalación limpia/upgrade y bootstrap admin one-shot seguro.
4. **RSP-07E — Persistencia y recuperación:** volumen de fotos con permisos, limpieza/reconciliación, backups DB+fotos, restore y pérdida total ensayados.
5. **RSP-07F — Seguridad/operación piloto:** rate limits, Swagger, logging/redacción/rotación, límites PDF, monitoreo host y runbooks.
6. **RSP-07G — Flujo de release:** tests, build, migración, deploy, health, smoke y rollback ensayado en staging; checklist go-live.
7. **RSP-07H — Compatibilidad Android:** spike de cookies/CORS/CSRF en Capacitor, uploads móviles, PDFs y estrategia offline, sin cambiar backend hasta medir.

### Flujo de deploy recomendado

```text
main
  -> tests y checks
  -> build único de imágenes, tag SHA, scan y publicación
  -> backup/precheck
  -> job de migraciones con lock
  -> deploy por digest
  -> readiness/healthcheck
  -> smoke: login, sesión, lectura, escritura controlada, foto y PDF
  -> promover release
```

Rollback conceptual: conservar al menos dos digests; volver API/frontend al digest anterior sin borrar volúmenes; usar migraciones expand/contract compatibles; no revertir datos automáticamente. Si una migración destructiva excepcional falla, detener escrituras y restaurar el conjunto DB+fotos coordinado. Invalidar/verificar service worker frontend tras rollback.

## Validaciones ejecutadas

| Validación | Resultado |
|---|---|
| `docker compose --env-file .env -f docker-compose.development.yaml config --quiet` | OK; warning local de acceso a config Docker, sin afectar validación |
| `docker compose --env-file .env -f docker-compose.production.yaml config --quiet` | OK; avisó variables legacy Maps, `REMOTE_HOST` y `DOCKER_USER` ausentes/vacías |
| `npm run build` en `api` | OK (`tsc`) |
| `npm run build` en `front` | OK; 1,12 MB inicial, warnings no bloqueantes de baseline/Stencil |
| Artefacto frontend | Sin `.map`; contiene host histórico; sin `maps.googleapis.com` ni key Maps |
| Requests Google | No ejecutados |
| DB | No levantada ni modificada |

## Priorización consolidada

| ID | Severidad | Área | Problema | Solución propuesta | Etapa sugerida |
|---|---|---|---|---|---|
| P1-01 | P1 | Docker/release | Build y production usan imágenes/nombres distintos y tags mutables | Unificar pipeline, tag SHA y deploy por digest | RSP-07B |
| P1-02 | P1 | Fotos | Filesystem efímero y ownership incompatible con usuario Node | Volumen dedicado, UID/GID, una réplica y backup | RSP-07E |
| P1-03 | P1 | Upload | API 5 MB vs multipart/Nginx 1 MiB | Alinear límites y respuestas 413 en toda la cadena | RSP-07C |
| P1-04 | P1 | PostgreSQL | Puerto 5432 publicado | Quitar `ports`, usar red interna y acceso administrativo seguro | RSP-07B |
| P1-05 | P1 | PostgreSQL | Sin runner/ledger; bootstrap SQL destructivo | Migrador versionado con lock/checksum y pruebas clean/upgrade | RSP-07D |
| P1-06 | P1 | Recuperación | Sin backups ni restore probado | Dump custom + fotos coordinadas + off-host + simulacro | RSP-07E |
| P1-07 | P1 | Operación | Sin health/readiness/restart uniforme | Endpoints, healthchecks, depends healthy y shutdown | RSP-07C |
| P1-08 | P1 | HTTPS/frontend | Dominio histórico, SPA/WS/TLS incompletos | Misma origin, URLs relativas, Nginx completo y cert runbook | RSP-07B/C |
| P1-09 | P1 | Admin | Bootstrap repetible resetea/reactiva cuenta | CLI one-shot que aborta si ya existe admin | RSP-07D |
| P1-10 | P1 | Config/secrets | Contrato incompleto y sin validación | Schema central, documentación y fail-fast sin imprimir secretos | RSP-07B |
| P2-01 | P2 | Seguridad | Sin rate limiting | Límites por IP/cuenta y por operación costosa | RSP-07F |
| P2-02 | P2 | Seguridad HTTP | Headers incompletos | Política Nginx/Fastify probada | RSP-07C/F |
| P2-03 | P2 | Swagger | `/docs` público | Deshabilitar o proteger en PROD | RSP-07F |
| P2-04 | P2 | Auth | Logout no revoca JWT copiado | Incrementar versión o registrar revocación según decisión | RSP-07F |
| P2-05 | P2 | Logs | Consolas, objetos y sin rotación/redacción | Logging JSON, redacción y rotación | RSP-07F |
| P2-06 | P2 | PostgreSQL | Esperas ilimitadas y sin cierre del pool | Timeouts y SIGTERM graceful | RSP-07C/F |
| P2-07 | P2 | PDF/Maps | CPU/memoria/cuota sin control de concurrencia | Semaphore/rate limit, timeout y métricas de tamaño | RSP-07F |
| P2-08 | P2 | Fotos | Borrar pozo deja archivo huérfano | Eliminación coordinada y reconciliación | RSP-07E |
| P2-09 | P2 | Deploy | `down` previo, sin smoke/rollback | Deploy por digest con health y rollback | RSP-07G |
| P2-10 | P2 | Android | Cookie CSRF no accesible desde origin nativa | Spike y contrato auth nativo sin degradar web | RSP-07H |
| P3-01 | P3 | Fotos | Volumen no escala a varias réplicas | Abstracción y object storage privado | Posterior al piloto |
| P3-02 | P3 | Observabilidad | Sin métricas/trazas centralizadas | Incorporar según operación real | Posterior al piloto |
| P3-03 | P3 | PostgreSQL | Índices/constraints/pool sin prueba de carga | Medir y optimizar con datos reales | Posterior al piloto |
| P3-04 | P3 | Supply chain | Sin SBOM/scan/política de upgrades | Automatizar escaneo y renovación | Posterior al piloto |
| P3-05 | P3 | Android | Sin offline/conflict handling | Cola, idempotencia y sincronización | Posterior al piloto |
