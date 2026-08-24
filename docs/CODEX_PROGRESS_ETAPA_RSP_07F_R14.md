# ETAPA RSP-07F-R14 — referencias reproducibles y timeouts end-to-end

> Nota R16: la validación native citada en este registro era sólo de routing y quedó retirada. RSP-07 publica exclusivamente producción web; Android productivo requiere primero P2-10 Android Auth.

## Alcance

Se cerraron exclusivamente los dos hallazgos del review global posterior a R13: deployment state aceptaba tags Docker mutables distintos de `latest`, y Nginx cortaba requests HTTP a 90 s aunque PostgreSQL admite queries de hasta 310 s. No se modificaron funcionalidades de negocio, contratos de autenticación, migraciones, restore ni despliegues externos.

## Referencias reproducibles

Cualquier tag de registry puede moverse: `production`, `stable`, `v1` y también un tag que parezca una versión dejan de identificar bytes cuando el registry los reasigna. El image ID auditado detecta esa divergencia durante rollback, pero no garantiza que los bytes anteriores continúen recuperables por la referencia persistida.

La política R14 es diferenciada y equivalente en POSIX y PowerShell:

- `BUILD_IMAGES=false`: API y frontend deben usar un digest explícito `@sha256:<64 hex minúsculos>`. Se admite `repo@sha256:...` y `repo:tag@sha256:...`; el digest hace content-addressed a la referencia y el tag adjunto no necesita coincidir con el commit.
- `BUILD_IMAGES=true`: se admite digest o un tag cuyo componente sea exactamente `TARGET_GIT_SHA`. El SHA se valida como los 40 hexadecimales minúsculos completos. No se aceptan prefijos, sufijos ni coincidencias parciales.
- `production`, `stable`, `release`, `v1`, `latest` en cualquier capitalización, SHA corto, `<sha>-prod`, `prod-<sha>`, referencias sin tag y digests vacíos, cortos, con mayúsculas o múltiples `@` fallan en preflight.

Los callers productivos y las pruebas de upgrade obtienen `TARGET_GIT_SHA` con `git rev-parse HEAD`; `deployment.env` conserva el SHA completo. Los builds locales se etiquetan `repositorio:<TARGET_GIT_SHA>`. Las referencias remotas son más estrictas y exigen digest aun si su tag coincide con el SHA.

La validación ocurre antes de resolver paths, crear directorios, escribir audit/state o invocar Docker. Un `deployment.env` histórico con `app:production` se rechaza y permanece byte a byte intacto; no se inventa digest ni se intenta migrar automáticamente. El reader de audits aplica la misma regla a referencias previas y target.

El deployment state continúa guardando referencias, Git SHA, versión y hash de configuración. El audit continúa guardando los image IDs previos. Rollback sigue resolviendo cada referencia y exige igualdad exacta con el image ID registrado antes de recrear servicios. El digest/tag-SHA se agregó como defensa previa; no reemplazó esa comprobación.

La simulación aislada de mutación cubre el motivo del hallazgo: un tag de canal se rechaza antes de poder originar state; un digest A sigue siendo válido por contenido; un tag SHA sólo es aceptable para build local y debe coincidir exactamente con el SHA objetivo. Un registry aún puede mover técnicamente ese tag local si se publica, por lo que el flujo remoto no lo admite sin digest y rollback conserva la defensa por image ID.

## Timeouts end-to-end

El mapa auditado quedó así:

| Capa | Antes | R14 / máximo |
|---|---:|---:|
| Nginx connect API | 5 s | 5 s |
| Nginx send API | 30 s | 30 s entre escrituras |
| Nginx read API general | 90 s | 450 s |
| Nginx read PDF | 90 s, mismo location | 450 s, mismo location |
| Nginx WebSocket | 180 s | 180 s |
| Nginx frontend | 30 s | 30 s |
| body/upload | 30 s | 30 s |
| PG connection | hasta 60 s | hasta 60 s |
| PG statement | hasta 300 s | hasta 300 s |
| PG query | hasta 310 s | hasta 310 s |
| PG idle transaction | hasta 300 s | hasta 300 s |
| espera cola PDF | hasta 120 s | hasta 120 s |
| fetch de mapa para PDF | 3 s | 3 s |
| generación PDF local | sin timer wall-clock separado | sin cambio; protegida por concurrencia/cola |
| `stop_grace_period` API | 360 s | 480 s |

Fastify no configura un deadline adicional del handler. PostgreSQL aplica `statement_timeout` y `query_timeout`; el gate PDF mantiene concurrencia 2, cola 4 y espera 15 s por defecto, con máximos configurables 16, 100 y 120 s. La saturación sigue devolviendo 503 con `Retry-After`. WebSocket conserva heartbeat de 30 s y timeout Nginx de 180 s; no se mezcló con HTTP.

La cola PDF ocurre antes de consultar/generar. Por eso el presupuesto coordinado usa `120 + 310 + 3 = 433 s`; Nginx espera 450 s, dejando 17 s para composición y entrega de respuesta. El `stop_grace_period` sube coordinadamente a 480 s, 30 s por encima del timeout visible al cliente para cierre Fastify, compensación y `pool.end`. Mantener 360 s habría dejado Docker como primer corte durante una request que el proxy declara válida.

No se agregó cancelación distribuida ni un timer artificial a la generación CPU. El objetivo R14 es que Nginx ya no sea sistemáticamente el primer timeout para operaciones dentro de los límites publicados. Los límites propios de PostgreSQL, mapa y cola siguen fallando antes de 450 s cuando se exceden.

## Pruebas y evidencia

- matriz de referencias PowerShell/POSIX: digest, tag+digest, registry con puerto, tag SHA exacto, SHA parcial, tags de canal, uppercase y digest inválido;
- preflight `BUILD_IMAGES=true/false`: tags mutables y tag SHA remoto fallan antes de crear paths, escribir state o invocar Docker;
- state histórico mutable: rechazado sin modificar bytes;
- contracts R2 y R5, launcher externo, audit, rollback no-op y verificación por image ID: OK;
- build Docker aislado API + frontend con tags iguales al SHA completo: OK;
- artefacto web Docker: `/api` y `/ws` same-origin, sin `NATIVE_BACKEND_ORIGIN`;
- frontend `test:build-targets`: web/native OK; Android auth continúa pendiente como P2;
- API `npm run build`: OK; suite completa: 256/256 OK;
- máximos runtime: statement 300 s, query 310 s y cola PDF 120 s aceptados; un milisegundo adicional rechazado;
- contrato HTTP: 450 s es mayor que 90 s y que el presupuesto 433 s; límites backend permanecen menores;
- configuración renderizada: `nginx -t` y `docker compose config` OK con API 450 s, WebSocket 180 s y grace 480 s;
- regresión SIGTERM R11: success y error de 12 s terminan limpios; timeout backend controlado termina antes; DB/foto permanecen consistentes;
- reconciliación de fotos, ledger prefijo, checksums LF/CRLF, WebSocket heartbeat, PDF capacity y `Retry-After` permanecen cubiertos por la suite;
- secret scan del diff y `git diff --check`: OK.

Los dos hallazgos del review, 1 P1 y 1 P2, quedan cerrados. El P2 de autenticación Android indicado desde R12 permanece fuera del alcance de R14.
