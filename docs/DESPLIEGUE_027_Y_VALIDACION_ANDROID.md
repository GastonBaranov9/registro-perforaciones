# Preparación operativa 027 y Android

Estado al 26/10/2026: preparación local, sin despliegue, mantenimiento productivo,
commit ni push. Base funcional: `8534f2fbf5dfc4554406413221cc9e4cbb78dca6`.
La versión productiva 026 informada por el propietario es
`4776a923b54b62590a591bb23393164ac2afb548`; no se ejecutó un preflight sobre
`rsp-pilot` en esta etapa. No se modificaron migraciones ni código funcional,
incluidos los espesores gráficos aprobados de sello y prefiltro (`0.13`).

## Barrera antes de reabrir

El procedimiento productivo Windows sigue siendo `ops/deploy.ps1`. La barrera
026 se conserva para su actualización inicial; no se vuelve a exigir su política
inicial cuando el ledger ya contiene 026. Se añadió una barrera 027 automática,
sin opción para omitirla, para la transición inicial de `rsp-pilot`:

1. Comprobar deployment state, identidad de imágenes anteriores y salud de los
   cuatro servicios. Exigir ledger exactamente 000–026, checksums válidos y 027
   como única migración local pendiente, sin tabla anticipada.
2. Rechazar auditorías pendientes o fallidas después de validar 027. Si la tabla
   ya se migró, exigir un cierre anterior exitoso y coherente con el SHA del
   deployment state. No saltar comprobaciones mediante un reintento.
3. Construir únicamente desde un checkout limpio del SHA autorizado, o usar las
   referencias remotas admitidas por el procedimiento existente. Verificar las
   etiquetas SHA de ambas imágenes y el inventario/checksums 000–027 dentro de
   la imagen API, mediante un contenedor efímero sin red, volúmenes ni secretos.
4. Conservar mantenimiento, contención de escrituras y respaldo integral
   verificado existentes. Capturar el baseline después del respaldo y antes de
   migrar, con API detenida.
5. Aplicar el migrador existente, cuyo inventario ya fue comprobado. Antes de
   iniciar API/frontend, comprobar ledger 027, estructura nueva vacía y
   conservación estricta de todos los datos anteriores.
6. Iniciar servicios y ejecutar `smoke.ps1 -Validate027` por el proxy privado.
   Requiere autenticación administrativa, detalle con
   `prefiltro_constructivo: []`, perfil de un pozo con profundidad conocida,
   PDF válido y los controles existentes de cookies, CSRF, WebSocket, puertos,
   TLS y fotografía cuando esté disponible. No crea perforaciones ni prefiltros.
7. Exigir `SMOKE_027_API_OK` y la identidad del usuario del smoke. Repetir la
   conservación, verificar imágenes en ejecución y comparar la huella del
   inventario de persistencia con `persistence.inventory` del respaldo.
8. Registrar `validation_027 = passed`, persistir deployment state y recién
   entonces reabrir. Ejecutar el smoke público existente. Un fallo conserva
   evidencia y utiliza la contención/recuperación existente, sin restauración
   destructiva ni rollback automático de datos.

La evidencia privada `<bundle>-027.json`, dentro del directorio de estado
configurado, registra SHA anterior/objetivo, bundle, snapshots, checks completados
y huella de persistencia. La auditoría existente registra fase y error. No se
imprimen contenidos de clientes: snapshots contienen estructura, conteos, hashes
y datos técnicos de control. No editar marcas de éxito para desbloquear reintentos.

## Conservación y alcance de las lecturas

`validation-027.sql` se ejecuta en transacción `REPEATABLE READ READ ONLY`, con
`ON_ERROR_STOP`, conexión de solo lectura y timeout. Compara todas las tablas
previas del esquema público, su estructura, funciones y secuencias. Esto incluye
numeración, política/rangos/excepciones tal como existan realmente, reservas,
pozos y texto legado `pre_filtro`, sellos, filtros, litología, documentos,
informes, idempotencia, auditorías, usuarios, roles y permisos. No exige revisión
1 de política, contador 3282 ni identidades particulares de P-3277.

La comprobación inmediatamente posterior a migrar es estricta, incluso para
sesiones. Tras arrancar la API se distingue la actividad técnica existente:
el logout del smoke incrementa exactamente una vez `version_sesion` de su usuario;
los demás campos y usuarios deben permanecer idénticos. Las tablas técnicas
`sesion_nativa` y `ticket_ws_nativo` pueden ser depuradas por el janitor existente.
No se exceptúan tablas empresariales. El smoke no es una transacción global de
solo lectura: realiza login/logout, pero sus consultas empresariales son GET y
no contiene escrituras de numeración, perforaciones ni permisos.

`prefiltro_pozo` debe tener exactamente las columnas y tipos aprobados, PK
`(id_pozo, desde_m)`, FK hacia `pozo` con `ON DELETE CASCADE`, restricciones de
nulabilidad, finitud y orden de profundidades, e índice primario válido. Debe
estar vacía en esta primera actualización. No se cambia la migración 027.

`validation-027-persistence.mjs` reproduce en lectura el inventario de
`ops/persistence.sh`: rutas relativas, tipos, permisos/propietario, tamaños y
SHA-256 de todos los archivos bajo la raíz de persistencia. Incluye archivos
archivados y ocultos; rechaza enlaces/tipos no soportados y restos de restauración.
No sustituye la verificación integral del respaldo que ya realiza `backup.ps1`.

## Ensayos realizados

| Verificación | Resultado |
| --- | --- |
| Migración y snapshots reales en PostgreSQL 16 descartable | 4/4 |
| Validadores contra snapshots sintéticos, contratos y transporte | 43/43 |
| Orden, fallos bloqueantes, recuperación y rechazo de reintentos 027 | 13/13 |
| Smoke autenticado 027 con HTTP simulado | 9/9 |
| Inventario de persistencia y alteraciones inducidas | 6/6 |
| Regresión de mantenimiento/recuperación existente | 24/24 |
| Regresión de barrera 026 | 10/10 |
| Regresión de smoke autenticado 026 | 6/6 |

También se comprobó el catálogo con PostgreSQL 18 local. PostgreSQL 16 usa la
imagen fijada en Compose, pero un contenedor propio `rsp-gate027-lab-*`, puerto
loopback aleatorio, credenciales aleatorias y volumen descartable; no utiliza
redes, rutas ni secretos de producción. Se detiene y elimina únicamente ese
contenedor al terminar. Las pruebas del despliegue y HTTP usan mocks: no equivalen
a un despliegue completo ni a un smoke real de la aplicación productiva.

Comandos de reproducción aislada, solo si es necesario repetirlos:

```powershell
node scripts/test-validation-027-postgres.mjs --docker16
# Usar el directorio de snapshots sintéticos que imprime el comando anterior:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-validation-027.ps1 -SnapshotDirectory <directorio>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-deploy-maintenance-mocks.ps1 -Validation027Only -SnapshotDirectory <directorio>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-rsp07f-r8-smoke.ps1 -Validation027Only
node --test scripts/test-validation-027-persistence.mjs
```

No se repitieron las suites funcionales 027 aprobadas. No se ejecutó el despliegue
real. Antes de autorizarlo faltan revisión y publicación del ajuste operativo,
selección explícita del nuevo SHA autorizado, preflight real, capacidad/espacio,
ventana sin sincronizaciones, respaldo nuevo y las comprobaciones privadas/públicas.
No se debe etiquetar código operativo nuevo como si perteneciera al SHA funcional
anterior. Si no hay un pozo existente con perfil comprobable, falla el smoke y
se requiere revisión; no se crean datos para hacerlo pasar. Un timeout o falta
de permiso al inventariar también bloquea: evaluar capacidad antes del mantenimiento.

## Android: estado comprobado y pendientes

- Capacitor y Gradle usan `uy.com.raulsilva.perforaciones`. No hay variante de
  pruebas con identidad separada. Una APK debug con esa identidad no es apta para
  coexistir con el piloto sin riesgo de sustitución/conflicto.
- Los assets nativos existentes apuntan a `https://api.raulsilvaperforaciones.com`.
  No utilizarlos para probar prefiltro mientras esa API ejecuta 026.
- No se identificó ni se proporcionó un backend HTTPS aislado apto. Los procesos
  locales en 3000/4200 no acreditan HTTPS válido ni accesibilidad desde un teléfono.
- `adb devices` no mostró dispositivos conectados. No se instaló, desinstaló ni
  borró nada. No se construyó APK; no existe ruta/hash de un artefacto de esta etapa.
- El build nativo existente exige `NATIVE_BACKEND_ORIGIN`, configura API y WSS
  para ese origen y genera CSP correspondiente. La autenticación nativa utiliza
  sus endpoints y almacenamiento seguro. La cola y archivos offline se separan
  por origen/backend y usuario; no se deben migrar ni borrar sus datos manualmente.

Para habilitar la prueba falta una URL HTTPS real autorizada con API 027,
PostgreSQL/archivos descartables, secretos independientes y cuentas/datos sintéticos.
Comprobar certificado válido desde Android, acceso de red, autenticación nativa,
roles apropiados y época de datos. No publicar un nuevo servicio ni cambiar
Cloudflare/certificados sin autorización. Para offline usar una cuenta de prueba
con el rol permitido por el flujo existente (`perforador` u `operador_admin`).

Después, aprobar una identidad de prueba distinta en una copia aislada del
proyecto; por ejemplo `uy.com.raulsilva.perforaciones.pruebas027` es solo una
propuesta, no una configuración aplicada. Verificar coherencia Capacitor/Gradle,
sin modificar la identidad piloto ni la firma de release. En esa copia:

1. Configurar `NATIVE_BACKEND_ORIGIN` con la URL aislada verificada.
2. Ejecutar `npm.cmd run build:native:development` desde `front` y
   `npx.cmd cap sync android`; usar las verificaciones de assets existentes.
3. Construir `gradlew.bat assembleDebug` desde `front/android`. Inspeccionar
   package ID del APK, destino de API/WSS/CSP y revisión fuente; registrar ruta
   y SHA-256 (`Get-FileHash -Algorithm SHA256`). No generar release firmada.
4. Conectar el teléfono por USB y autorizar depuración. Comprobar con ADB que
   la identidad del APK difiere de la instalada. Instalar mediante
   `adb install <APK-verificada>`, sin `-r`, desinstalación ni borrado de datos.
   Si hay conflicto, detenerse. Confirmar que ambas aplicaciones permanecen.

No ejecutar esos pasos hasta contar con backend e identidad autorizados. Una
compilación correcta no acredita una prueba física satisfactoria.

## Guía de comprobación física (pendiente del propietario)

1. Abrir solo la app de pruebas y autenticar contra el backend aislado. Confirmar
   con el operador que no contiene clientes reales. Mantener el piloto intacto.
2. En una perforación ficticia, agregar prefiltros 13.5–15.5 y 20–25 m, modificar
   extremos y eliminar uno. Probar negativos, intervalos invertidos y fuera de
   profundidad. Revisar advertencia de solapamiento con sello y prefiltro sin filtro.
3. Ver sello/prefiltro de grosor esquemático `0.13`, filtro ranurado, etiquetas,
   profundidades y preview vertical sin desbordamiento. Guardar, cerrar/reabrir,
   editar/eliminar prefiltro y regenerar PDF comprobando los mismos intervalos.
4. Abrir una perforación ficticia antigua sin prefiltro: colección vacía, sin
   intervalos inventados; sello previo intacto.
5. Tras iniciar sesión online y preparar la cuenta offline, activar modo avión,
   crear/guardar un borrador ficticio con varios intervalos y reabrirlo. Recuperar
   conexión, sincronizar exclusivamente al backend aislado y verificar un único
   registro y estado confirmado; reintentar sin duplicar. No borrar colas ni
   crear claves nuevas para evitar errores. Nunca usar borradores del piloto.
6. Registrar capturas, PDF y resultado de cada paso sin información personal.
   La validación Android físico permanece pendiente hasta realizar esta prueba.
