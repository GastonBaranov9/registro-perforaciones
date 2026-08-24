# ETAPA RSP-07F-R11 - imagenes inmutables y shutdown graceful

## Alcance y causas

Se corrigieron exclusivamente los dos P1 del review posterior a R10.

1. `deployment_state_validate_image` y `Assert-DeploymentImageRef` solo comprobaban caracteres y el sufijo literal `:latest`. Una referencia sin tag, incluida una con puerto de registry, pasaba la validacion y Docker la resolvia implicitamente como el tag mutable `latest`.
2. `docker compose stop api` no tenia un grace configurado y heredaba aproximadamente 10 s. Ese plazo era menor que una query permitida por defecto (35 s) y podia enviar SIGKILL mientras una request todavia debia hacer rollback SQL y compensar una foto aislada en `.trash`.

## Contrato de referencias de imagen

Los validadores POSIX (`ops/deployment-state.sh`) y PowerShell (`ops/deployment-state.ps1`) aplican la misma regla:

- se exige un repository que empiece por un caracter alfanumerico y conserve el conjunto de caracteres seguro previo;
- sin digest, el componente final debe contener un tag explicito;
- el puerto del registry no se interpreta como tag (`registry:5000/team/api` se rechaza);
- el tag cumple `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`;
- `latest`, con cualquier combinacion de mayusculas/minusculas, se rechaza;
- un digest admitido es exactamente `sha256:` seguido por 64 hexadecimales minusculos;
- se admite repository con digest y tambien tag mas digest; no se admiten multiples `@`, digest corto, vacio o de otro formato.

Ejemplos aceptados: `repo:v1`, `registry.example:5000/team/repo:release-42`, `repo@sha256:<64hex>` y `repo:v1@sha256:<64hex>`. Ejemplos rechazados: `repo`, `registry.example/repo`, `registry.example:5000/team/repo`, `repo:latest`, `repo:Latest`, `repo:`, `repo@sha256:` y un SHA-256 incompleto.

La validacion de los targets se ejecuta al comienzo de ambos deploys, antes de resolver archivos, crear directorios, escribir audit/state o invocar Docker. Los lectores de deployment state y audit reutilizan los mismos validadores, por lo que rollback, restore y backup tambien rechazan referencias no reproducibles. Un `deployment.env` historico sin tag/digest se conserva intacto y aborta con error: no se inventa `:latest` ni un tag. La comprobacion separada del image ID registrado durante rollback permanece obligatoria.

## Limites auditados y grace elegido

Los defaults productivos son: conexion PostgreSQL 5 s, statement 30 s, idle transaction 15 s, query 35 s y espera en cola PDF 15 s. La configuracion valida admite como maximos 60 s, 300 s, 300 s, 310 s y 120 s respectivamente. El proxy acota lectura general a 90 s y PDF a 180 s; la descarga de mapa usa abort de 3 s. La cola PDF es finita y el heartbeat WebSocket usa un timer `unref` que se cancela en `onClose`.

Se configuro `stop_grace_period: 360s` en el servicio `api`. El valor supera el maximo soportado de query (310 s) por 50 s para permitir rollback SQL, compensacion filesystem, hooks de cierre y cierre del pool. Sigue siendo finito: Docker conserva SIGKILL como defensa final a los 360 s y el tiempo maximo de una operacion coordinada continua siendo predecible.

Fastify declara explicitamente `return503OnClosing: true` y `forceCloseConnections: "idle"`. Al recibir SIGTERM deja de aceptar trabajo nuevo, cierra conexiones idle, espera requests activas, ejecuta `onClose` (detiene heartbeat y cierra WebSockets con 1001), termina el pool y sale sin `process.exit` forzado. La maintenance actual se instala antes de detener el API en deploy y rollback. Backup, restore, deploy y rollback usan `docker compose stop api` sin `-t`/`--timeout`, por lo que todos respetan el valor del servicio.

## Pruebas y fault injection

`scripts/test-deployment-state.ps1` y su fixture POSIX cubren la matriz de tags, puerto de registry, digests, `latest` case-insensitive, estado historico y preflight sin efectos para API y frontend. Tambien preservan paridad de canonical/hash y escritura atomica.

`scripts/test-rsp07f-r11-shutdown.ps1` levanta un Compose aislado con el API de produccion, PostgreSQL y volumen de fotos. El fixture mueve una foto real a `.trash`, abre una transaccion y recibe SIGTERM mediante `docker compose stop api`:

- request valida de mas de 10 s: completa COMMIT y eliminacion, HTTP 204, exit 0 y DB/filesystem consistentes;
- fallo controlado despues de mas de 10 s: ejecuta ROLLBACK, restaura la foto con el mismo SHA-256, HTTP 500 y exit 0;
- `pg_sleep(20)` bloqueado: `statement_timeout` de prueba lo corta antes del grace, compensa foto y DB y sale limpio.

La prueba comprueba ademas el `stop_grace_period` renderizado por `docker compose config`, ausencia de overrides cortos en scripts ops, marcador SIGTERM, marcador de salida limpia, `OOMKilled=false`, path DB, ausencia de residuo `.trash` y SHA-256 del archivo compensado. Los proyectos, redes, containers, volumenes, imagen y archivos temporales se eliminan al finalizar.

## Integracion deploy, backup y rollback

No se cambio el orden funcional de deploy/backup/rollback. Todos sus stops del API pasan por Compose y heredan 360 s. La maintenance existente evita trabajo nuevo en deploy/rollback; Fastify cubre la carrera restante y backup coordinado. Los audits, config hashes, IDs de imagen, restore recuperable R10 y criterios `ROLLBACK_OK` permanecen sin cambios.

## Resultados finales

Se ejecutaron build y suite del API, pruebas contractuales POSIX/PowerShell, render de Compose, sintaxis shell/PowerShell, integracion Docker de shutdown y los contratos productivos relevantes. Los resultados exactos y commits quedan consignados en el reporte final de la etapa.

## Pendiente fuera de alcance

Permanece pendiente el P2 Android ya registrado en etapas anteriores; R11 no modifica frontend ni reglas funcionales del producto.
