# ETAPA RSP-07D — Reverse proxy, HTTPS y misma origin

Fecha de cierre técnico: 2026-08-13

Rama: `feature/rsp-07-produccion`

Fuentes: auditoría RSP-07A y cierres RSP-07B/RSP-07C.

## 1. P1-08

El hallazgo histórico exacto era **“P1-08 — Entrada HTTPS incompleta”**: frontend con host histórico, `/ws` sin ruta a API, Nginx frontend sin fallback SPA, ciclo de certificado no reproducible y volúmenes de certbot inconsistentes.

RSP-07B ya había resuelto host histórico, API relativa, fallback SPA y proxy HTTP para `/api`/`/ws`. RSP-07D cierra lo restante:

- entrada HTTPS provider-agnostic;
- redirección 80 → 443;
- certificado/clave montados read-only y fuera de imagen/Git;
- `PUBLIC_HOST`/`PUBLIC_ORIGIN` validados;
- forwarding explícito y no heredado del cliente;
- `trustProxy` de exactamente un salto;
- flujo real de cookie/CSRF/CORS/WebSocket probado sobre HTTPS.

No queda ningún P1 abierto después de esta etapa.

## 2. Topología same-origin

```text
Internet
  │
  ├─ HTTP :80 ── 308 ──┐
  │                     ▼
  └─ HTTPS :443 ── reverse proxy Nginx
                         ├─ /      → frontend Nginx → Angular/Ionic
                         ├─ /api/  → Fastify :3000 interno
                         └─ /ws    → WebSocket Fastify interno

Fastify ── red backend interna ── PostgreSQL :5432
Fastify ── volumen interno ── /var/lib/registro-perforaciones/fotos
Fastify ── HTTPS saliente ── Google Maps Static
```

Solo `proxy` publica puertos. API, frontend y PostgreSQL declaran únicamente puertos internos. El proxy no monta el volumen de fotos.

## 3. Reverse proxy

La configuración canónica es `proxy/https.conf.template`:

- listener 80 devuelve 308 hacia `PUBLIC_ORIGIN`, preservando path/query;
- listener 443 usa TLS 1.2/1.3;
- el virtual host TLS rechaza con 421 cualquier `Host` diferente de `PUBLIC_HOST`;
- `/api/` elimina una sola vez el prefijo mediante `proxy_pass http://api:3000/`;
- `/ws` conserva la ruta interna `/ws` y reenvía Upgrade/Connection con HTTP/1.1;
- `/` se entrega al frontend interno;
- connect timeout 5 s, send 30 s, read API 90 s, frontend 30 s y WebSocket 300 s;
- `client_body_timeout 30s` y `client_max_body_size 7m`.

Forwarding:

```text
Host              = host público recibido
X-Real-IP         = $remote_addr
X-Forwarded-For   = $remote_addr
X-Forwarded-Proto = https
X-Forwarded-Host  = $host
```

`X-Forwarded-For` se sobrescribe, no se concatena con una cabecera arbitraria aportada desde Internet.

## 4. Rutas públicas e internas

| Pública | Interna | Nota |
|---|---|---|
| `/` y rutas Angular | `front:80` | fallback SPA en frontend Nginx |
| `/api/health` | `api:3000/health` | liveness mínima |
| `/api/ready` | `api:3000/ready` | consulta liviana PostgreSQL |
| `/api/*` | `api:3000/*` | un único strip de `/api/` |
| `/ws` | `api:3000/ws` | WebSocket autenticado real |

`/api/ruta-inexistente` devuelve el 404 de Fastify y nunca `index.html`. `/pozos/123` devuelve `index.html` para que Angular resuelva la navegación.

## 5. TLS

Compose exige rutas host absolutas conceptuales mediante:

```dotenv
TLS_CERT_FILE=/ruta/fuera/repositorio/fullchain.pem
TLS_KEY_FILE=/ruta/fuera/repositorio/privkey.pem
```

Se montan read-only como `/etc/nginx/tls/tls.crt` y `/etc/nginx/tls/tls.key`. No se copian certificados a ninguna imagen. La clave del host debe quedar legible solo por el operador/root y el proceso que inicia Docker; no debe almacenarse en `.env`, backup de aplicación ni Git.

El test usa un leaf autofirmado de un día creado en `%TEMP%`, `curl -k` únicamente dentro del arnés y eliminación final. No instala una CA ni modifica el archivo hosts.

## 6. `PUBLIC_HOST` y `PUBLIC_ORIGIN`

Producción requiere ambos:

```dotenv
PUBLIC_HOST=perforaciones.example.com
PUBLIC_ORIGIN=https://perforaciones.example.com
```

Los valores usan dominios reservados de documentación. La API rechaza hostname vacío, mayúsculas, wildcard, localhost, formato no DNS, origin HTTP, path/query/fragment, credenciales embebidas o host incoherente. Un puerto explícito es admisible en `PUBLIC_ORIGIN` para el test aislado, manteniendo el hostname.

Development conserva sus origins localhost y no exige estas variables.

## 7. Cookies

La topología conserva el contrato existente:

| Cookie | HttpOnly | Secure PROD | SameSite | Path | Vida |
|---|---:|---:|---|---|---:|
| `rsp_session` | Sí | Sí | Lax | `/` | 10 h |
| `rsp_csrf` | No | Sí | Lax | `/` | 10 h |

No se configura `Domain`: ambas son host-only. No se usa `SameSite=None`. `version_sesion`, comprobación de cuenta activa y revocaciones existentes no cambiaron.

## 8. CSRF

Se conserva double-submit cookie/header con comparación timing-safe. Además, en producción:

- toda mutación requiere `Origin` igual a `PUBLIC_ORIGIN`;
- login también queda protegido contra login-CSRF;
- WebSocket exige el mismo Origin;
- un Origin distinto obtiene el mismo 403 genérico de protección CSRF;
- development no recibe este requisito de dominio.

La prueba real confirmó mutación legítima 201, falta de token 403 y Origin ajeno 403.

## 9. CORS

`PUBLIC_ORIGIN` siempre es el primer origin autorizado de producción. `CORS_ORIGINS` vacío no abre CORS: solo conserva el origin canónico. Origins adicionales deben declararse completos, HTTPS y no localhost; no se admite wildcard ni reflexión abierta.

El navegador same-origin no depende de CORS para su operación normal. No se agregó ninguna excepción anticipada para Android/Capacitor.

## 10. Trust proxy

Fastify usa `trustProxy: 1` exclusivamente en producción. Esto coincide con la red real: API sin publicación host y un único Nginx en `edge`. La prueba unitaria confirmó que toma el protocolo y la dirección del salto derecho confiable, no una cadena izquierda arbitraria. Development mantiene `trustProxy: false`.

## 11. SPA

El frontend productivo mantiene `try_files $uri $uri/ /index.html`. El proxy envía solo `/` al frontend; `/api/` y `/ws` tienen locations anteriores y específicas. Se probaron raíz, refresh profundo y 404 API separado.

El build productivo usa `/api/` y WebSocket derivado de `location.protocol/location.host`. No necesita rebuild por dominio y el test buscó `localhost:3000`, `localhost:4200` y la key Maps dentro de los artefactos sin hallazgos.

## 12. WebSocket

Sí existe WebSocket: Fastify registra `/ws`, el frontend lo usa para notificaciones y la autenticación llega por cookie. El proxy configura HTTP/1.1, Upgrade, Connection y read timeout 300 s. El handshake real HTTPS devolvió 101.

## 13. Límites y timeouts

Se preserva exactamente RSP-07B:

- binario: 5.000.000 bytes;
- base64: 6.666.668 caracteres;
- JSON: 6.922.668 bytes;
- multipart: 5.000.000 bytes y un archivo;
- proxy: 7 MiB.

La prueba subió 5.000.000 bytes a través de TLS y recibió 413 con 5.000.001. API read timeout de 90 s cubre PDF y el timeout interno corto de Maps sin dejar conexiones infinitas.

## 14. Fotos y Maps

Nginx no monta ni sirve `/var/lib/registro-perforaciones/fotos`. Sin cookie, la lectura probada devolvió 401; con autorización devolvió el archivo de 5.000.000 bytes. El PDF continuó leyendo el volumen desde la API.

Maps conserva el flujo frontend → `/api` → backend → proveedor HTTPS. La key no apareció en respuesta ni build frontend y el test no efectuó una solicitud real a Google.

## 15. PostgreSQL

PostgreSQL continúa únicamente en la red `backend` marcada `internal: true`, sin `ports`. API usa `postgres:5432`. La inspección del contenedor aislado confirmó cero bindings host.

## 16. Prueba HTTPS local

Comando:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-https-runtime.ps1
```

Evidencia final:

```json
{"http_redirect":308,"https":true,"canonical_host":421,"spa":true,"health":"ok","ready":"ok","login":true,"secure_cookie":true,"csrf_valid":201,"csrf_missing":403,"wrong_origin":403,"websocket":101,"upload_valid":5000000,"upload_rejected":5000001,"photo_protected":true,"pdf_bytes":65511,"api_public":false,"postgres_public":false,"front_public":false,"map_key_exposed":false}
```

El arnés ejecuta migraciones/bootstrap sobre un project name `rsp07d-https-*`, usa puertos loopback, certificados/credenciales aleatorios y elimina contenedores, redes, volúmenes y `%TEMP%` en `finally`.

## 17. Certificados futuros

### A. TLS termina en nuestro Nginx — recomendado para el primer piloto

El operador/proceso externo obtiene y renueva un certificado legítimo, actualiza los archivos montados y recarga/recrea únicamente `proxy`. La aplicación no conoce al proveedor ACME. Es la opción más simple para un único servidor Docker y coincide con el runtime probado.

HSTS se activa solo después de comprobar certificado público y renovación automática:

```dotenv
HSTS_HEADER=max-age=31536000
```

No usar `includeSubDomains` ni `preload` sin una decisión de dominio independiente.

### B. TLS termina en un load balancer/proxy externo

Es posible conceptualmente, pero no se implementa en RSP-07D. El salto externo debe ser confiable, sobrescribir forwarding, limitar acceso al Nginx interno y mantener HTTPS o red privada autenticada hasta el servidor. Requerirá una variante Compose explícita y revisar el número/red de proxies confiables; no se debe cambiar `trustProxy` a `true` indiscriminadamente.

## 18. DNS futuro

El despliegue necesitará un hostname estable, registro A y opcional AAAA si el hosting/operador soporta IPv6 correctamente, TTL razonable, `PUBLIC_HOST`/`PUBLIC_ORIGIN` coincidentes y renovación TLS monitorizada. Un CNAME es válido solo cuando la plataforma destino lo requiera. No se compró dominio, no se modificó DNS y no se solicitó certificado público.

## 19. Estado P1

| ID | Estado |
|---|---|
| P1-08 | Resuelto por RSP-07D. |
| P1 restantes | Ninguno. |

## 20. P2 pendientes para RSP-07E

- P2-01 rate limiting para login/PDF/mapas.
- P2-02 restante: CSP compatible con Ionic, Permissions-Policy y activación HSTS tras TLS público; ya existen nosniff, Referrer-Policy y DENY framing.
- P2-03 deshabilitar/proteger Swagger en producción.
- P2-04 revocación inmediata en logout.
- P2-05 logging/redacción/rotación.
- P2-06 timeouts PostgreSQL y shutdown ordenado.
- P2-07 concurrencia/memoria de PDF.
- P2-08 reconciliación periódica DB/fotos (revalidar contra mejoras posteriores a la auditoría).
- P2-09 deploy sin downtime, smoke y rollback por digest.
- P2-10 spike de autenticación Android sin debilitar la web.

CSP avanzada, observabilidad externa, S3, Android y CI/CD completo siguen fuera de RSP-07D.

## 21. Requisitos preliminares del hosting

### Mínimo técnico

- CPU `amd64/x86_64`; `arm64` solo después de validar todos los digests/builds y PDF en esa arquitectura.
- 2 vCPU compartidas y 2 GiB RAM para runtime; construir imágenes en el servidor con 2 GiB puede requerir swap y no es recomendable.
- SSD persistente de 40 GiB: reservar sistema/imágenes, DB, fotos y staging operacional.
- Docker Engine y Compose v2 con soporte de health conditions/profiles.
- publicación TCP 80/443; ningún requisito de publicar 3000/5432.
- volúmenes persistentes, mounts read-only de certificados y directorio de backup independiente.
- acceso SSH con claves y capacidad de transferir bundles off-server.
- salida HTTPS 443 para Google Maps, registry y renovación TLS; no se requiere correo hoy.
- hostname DNS controlable y posibilidad de automatizar renovación/recarga de certificados.

### Recomendado para piloto

- 2 vCPU dedicadas o de rendimiento estable, 4 GiB RAM y swap de emergencia moderado.
- SSD de 80 GiB o más, con alertas de uso; dimensionar fotos a hasta 5 MB por pozo y conservar margen para imágenes/logs.
- destino de backup en otro sistema físico con capacidad inicial equivalente al menos a DB+fotos por las ventanas 14/8/6.
- IPv4 pública estable; IPv6 solo si firewall, DNS y monitoreo cubren ambos protocolos.
- firewall que permita 22 desde IPs administrativas y 80/443 públicos; SSH con password deshabilitada.
- snapshots del servidor como complemento, nunca sustituto del bundle PostgreSQL+fotos probado.
- CPU con margen para generación PDF y build fuera de horario; si aumenta concurrencia, separar build y limitar PDF antes de escalar réplicas.
- monitoreo básico de renovación TLS, salud, disco, RAM y PostgreSQL en RSP-07E.

No existe funcionalidad de correo actual. Si se agrega posteriormente, debe usarse un relay autenticado y secreto externo; no se debe abrir un MTA público como parte del piloto.
