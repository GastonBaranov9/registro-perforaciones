# Controles operativos antes de reabrir el servicio

Los cambios afectan sólo scripts operativos. No ejecutan un despliegue por sí mismos.

## Secuencia

1. Preflight y preparación de imágenes, como antes.
2. Detener proxy público, publicar mantenimiento y detener API.
3. Respaldo y migraciones según el procedimiento existente.
4. Actualizar API/frontend y esperar sus healthchecks, manteniendo el acceso público bloqueado.
5. Levantar `smoke-proxy` temporal mediante `ops/smoke-proxy.compose.yaml`. Sólo publica `127.0.0.1:18443`; reutiliza la configuración HTTPS, certificados y autenticación normales. No monta base ni fotografías.
6. Ejecutar smoke completo por ese proxy: HTTPS, frontend, readiness, login, CSRF, consultas, PDF, fotos disponibles, WebSocket y logout. No crea perforaciones.
7. Persistir y verificar deployment state. Retirar proxy temporal; sólo entonces retirar mantenimiento y abrir el proxy habitual.
8. Ejecutar comprobaciones del proxy publicado (frontend, health, ready, docs), sin login ni escrituras de negocio. No verifican por sí solas el recorrido externo por Cloudflare.

Cualquier error después de entrar en mantenimiento inicia la contención antes de escribir auditoría o emitir resultados. Ya no se reinicia automáticamente la versión anterior ante un fallo previo a migraciones. Desde mantenimiento se registra `operator_assessment_required`, evitando que la recuperación interprete el fallo como un no-op. Esto no afirma que se haya modificado la base: el operador debe evaluar la fase alcanzada. Nunca se restaura la base automáticamente. Si falla la comprobación posterior a la apertura, debe evaluarse la posibilidad de escrituras durante ese breve intervalo.

## Recuperación ante errores

PowerShell y POSIX identifican los contenedores por las etiquetas exactas de proyecto y servicio, sin depender del archivo de deployment state para detenerlos o inspeccionarlos. Intentan detener el proxy público y, si falla, repiten la detención con timeout cero. Cada intento conserva sus errores sin impedir las demás acciones. Si no pueden verificar el proxy detenido, intentan detener también la API. Después intentan levantar mantenimiento sin recrear ni iniciar dependencias; si ya está activo y saludable, no lo alteran. El proxy temporal se detiene cuando se intentó iniciarlo.

Se vuelve a consultar Docker para confirmar el bloqueo: todos los proxies del proyecto deben estar en estado `exited`, `created` o `dead`, o una consulta válida debe confirmar que no existen. Una respuesta fallida de Docker nunca cuenta como ausencia de contenedores. `RECOVERY_PUBLIC_BLOCKED=true` indica esa evidencia; `RECOVERY_MAINTENANCE_VERIFIED=true` exige además mantenimiento en ejecución y saludable. Son estados observados, no una declaración de despliegue exitoso. La recuperación nunca abre el proxy público ni retira mantenimiento.

Si no puede confirmarse el bloqueo, se informa `RECOVERY_CRITICAL` e **INTERVENCIÓN MANUAL URGENTE**, aunque la detención de la API haya funcionado. La auditoría se intenta después de la contención; sus errores se conservan como secundarios. PowerShell vuelve a lanzar el error original con datos de recuperación adjuntos. POSIX conserva el código original de salida y la fase, además de los diagnósticos en stderr. Ambos terminan con error. Si el almacenamiento o la salida de logs fallan, puede no existir evidencia persistida: eso no debe impedir los intentos de protección.

La comprobación refleja el estado de Docker en ese momento; no sustituye verificar el acceso desde fuera del servidor ni protege frente a reinicios posteriores del daemon o acciones de otros operadores. Una caída total del daemon puede impedir toda contención y requiere intervención manual.

## Destino HTTPS y confianza TLS

- La URL, Host, SNI, Origin y cookies mantienen el dominio lógico de `PUBLIC_ORIGIN`.
- `curl --connect-to` lleva la conexión a loopback. El puerto se toma de `HTTPS_PORT`, o del puerto de la origin si no está definido.
- PowerShell permite `-ConnectPort` en smoke y `-SmokeInternalPort` en deploy (18443 por defecto). POSIX usa `SMOKE_CONNECT_PORT` y `SMOKE_INTERNAL_PORT` respectivamente.
- No se usa `--insecure`. Para una CA privada, proporcionar un archivo de CA de confianza mediante `-TlsCaFile` en smoke, `-SmokeCaFile` en deploy o `SMOKE_CA_FILE` en ambos. No se debe aceptar un certificado desconocido para hacer pasar el control.
- Antes del despliegue real, confirmar puerto privado libre, confianza y vigencia TLS. No modificar túneles ni publicar el puerto privado en interfaces externas.

## Propietarios

Las migraciones 012 y 017 permiten: propietario numérico positivo sin provisional; propietario nulo con nombre provisional no vacío (hasta 160 caracteres); o ambos nulos sólo en históricos. La 019 conserva esta restricción. El smoke rechaza IDs ausentes, booleanos, cadenas, fracciones, cero y combinaciones contradictorias. No cambia datos ni desactiva las FK.

Para un propietario nulo se consulta el contexto administrativo `/usuarios/0/pozos/...`, con autenticación y permisos existentes. El cero es un contexto de ruta, no un propietario asignado. Las fotografías de estos pozos no se omiten por falta de propietario.

## Verificación sin producción

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-rsp07f-r8-smoke.ps1 -RealJqPath C:\ruta\jq.exe
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-deploy-maintenance-mocks.ps1
bash.exe scripts/test-deploy-maintenance-mocks.sh
node scripts/test-smoke-proxy-config.mjs
git diff --check
```

Los smoke y despliegues se ejecutan con Docker/HTTP simulados y datos sintéticos. Los mocks de despliegue cubren fallos posteriores a la apertura, auditoría sin espacio o permisos, fallos de detención, contención alternativa, verificación imposible y mantenimiento ya activo. Comprueban el orden de protección antes de auditoría, el error original, los errores secundarios y la ausencia de reapertura durante la recuperación. El test de configuración sólo ejecuta `docker compose config`, sin contactar el daemon. Sin `RealJqPath`, el test de smoke usa el simulador jq existente; para validar el filtro real debe indicarse jq.

Antes de producción siguen pendientes: respaldo coordinado recuperable, ensayo aislado de restauración y migraciones 018–021, revisión de clientes/borradores offline y aprobación de una ventana de mantenimiento. Estos scripts no sustituyen esas condiciones ni verifican por sí solos que un respaldo pueda restaurarse.
