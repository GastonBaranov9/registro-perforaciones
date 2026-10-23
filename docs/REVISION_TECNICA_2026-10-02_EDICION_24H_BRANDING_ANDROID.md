# Revisión técnica — edición durante 24 horas y branding Android

Fecha: 2026-10-02 (America/Montevideo).
Base: rama `feature/rsp-10-pilot-apk`, commit `b9d9666402ce53dafc7a7c71f7d7302b1ba568fa`.
Estado: cambios locales para revisión, sin commit ni push.

## Alcance y decisiones

- Perforador: conserva la creación; solo puede modificar pozos cuyo `creado_por` persistido coincide con la identidad autenticada y cuya antigüedad está en `[0, 24 horas)`. A las 24 horas exactas se rechaza con HTTP 403. No se usa `id_perforador` como sustituto del creador.
- El backend consulta `creado_por` y `fecha_creado` de la base. No toma estos valores del body ni del identificador de usuario de la URL. Fechas inválidas, futuras o creador ausente no habilitan edición.
- Administración mantiene prioridad, incluso con varios roles: edición sin límite temporal y operaciones administrativas existentes.
- DELETE del pozo completo exige administración. El perforador puede corregir o retirar intervalos y foto de un pozo propio dentro del plazo; esas operaciones también quedan bloqueadas al vencer.
- La validación central del guard `pozoIsFromUser` cubre PUT simple/completo, POST/DELETE foto y altas/ediciones/bajas de litologías, diámetros, filtros y aportes. La edición de ubicación exige que TODOS sus pozos vinculados sean propios y recientes; no basta con encontrar uno editable.
- El POST de vista previa del perfil es explícitamente de solo lectura mediante configuración interna de la ruta; conserva sus permisos anteriores sin exigir la ventana temporal. Esa marca no procede de la petición del cliente.
- Autenticación web/nativa, cuentas inactivas, revocación, creación atómica, propietarios provisionales, numeración global e inmutabilidad de número en edición habitual se conservan. No se agregaron migraciones.
- Frontend: helper temporal, servicio de permisos, guard para acceso directo, estado de solo lectura en lista/detalle/editor y bloqueo de acciones técnicas y ubicaciones. El reloj se vuelve a comprobar al guardar y los controles se actualizan cada segundo; el temporizador corre fuera de NgZone para no impedir la estabilización de Angular. El editor principal conserva su borrador en memoria cuando vence y permite pasar al detalle.
- Se corrigió la recarga recursiva preexistente del listado de aportes, que relanzaba su propia carga indefinidamente.

## Branding Android

Se conservaron los originales entregados en `front/branding/rs_icono_piloto.png` y `rs_splash_piloto.png`.

`npm run generate:android-branding` genera de forma reproducible en Windows, con System.Drawing, 15 PNG de ícono (launcher, round y foreground en cinco densidades) y 11 PNG de splash (portrait/landscape y fallback). Conserva proporciones, centra sobre blanco y reserva margen para las máscaras adaptativas. No se modifican los originales ni se incorporan dependencias npm.

`branding/android-assets.json` registra SHA-256 de los 2 originales y 26 derivados. `verify:android-branding` valida inventario, hashes, PNG y referencias XML. `verify:native-assets` incluye esa validación, exige el splash original copiado al bundle y comprueba su referencia en el índice nativo, además de comparar todos los assets web/Android.

El tema AndroidX de arranque usa el nuevo ícono. El índice exclusivo del build nativo muestra el splash completo mientras Angular arranca, con `object-fit: contain`; Angular lo reemplaza al montar la aplicación, sin espera artificial ni cambios al home. En horizontal quedan márgenes blancos para evitar recortar la imagen vertical. No cambia el índice web ni el home animado.

Android 12+ limita la pantalla inicial del sistema al ícono y fondo. La imagen completa corresponde a la fase de carga de la aplicación y puede verse brevemente en dispositivos rápidos. Referencia oficial: [Splash screens](https://developer.android.com/develop/ui/views/launch/splash-screen).

## Verificaciones ejecutadas

| Verificación | Resultado |
| --- | --- |
| API: `npm test` | PASS, 326 tests |
| API: `npm run build` | PASS |
| Frontend: `npm test -- --watch=false --browsers=ChromeHeadless` | PASS, 401 tests |
| Formularios afectados, comprobación posterior del modo solo lectura | PASS, 36 tests |
| `npm run test:config` | PASS, 47 tests |
| `npm run check:utf8` | PASS |
| `npm run build:production` | PASS |
| `NATIVE_BACKEND_ORIGIN=https://api.raulsilvaperforaciones.com npm run build:native:production` | PASS, contrato CSS nativo validado |
| `npx cap sync android` | PASS, 7 plugins conservados |
| `npm run verify:native-assets` | PASS, 223 assets idénticos por SHA-256; branding validado |
| `NATIVE_BACKEND_ORIGIN=https://api.raulsilvaperforaciones.com npm run check:native-release-readiness` | READY; 46 tests internos PASS; branding físico MANUAL_CHECK |
| Gradle `:app:compileReleaseJavaWithJavac :app:processReleaseResources` | BUILD SUCCESSFUL, 133 tareas; sin empaquetar ni firmar APK |
| Inspección visual local de originales, foreground adaptativo y splash horizontal derivados | Correcta; arte completo y proporciones conservadas |
| `git diff --check` | Limpio, salida vacía y código 0 |

La prueba nueva de API ejecuta los hooks reales de autenticación y autorización sobre 17 rutas de escritura, con seis escenarios por ruta: propio reciente, vencido, ajeno, administración, roles múltiples e inactivo. Intercepta después de los hooks y antes de persistir; usa una base simulada y no conecta al piloto. Incluye frontera exacta al milisegundo con reloj explícito, metadatos inválidos, sitio compartido/vencido y compatibilidad de vista previa de pozos viejos. Las suites existentes de numeración, propietarios provisionales e intervalos también pasan. En frontend se verifican acciones visibles por rol, prohibición de eliminar, conservación del borrador y vencimiento con reloj controlado.

Algunas primeras ejecuciones fallaron por restricciones locales del sandbox (esbuild, escritura de fixture PDF, consulta de usuario por Capacitor y probes Gradle); se repitieron con permisos de ejecución y pasaron. Se corrigieron además los tests antiguos que intentaban guardar sin una identidad con permisos, y la tarea periódica que impedía `whenStable`. Los resultados de la tabla son los finales.

Advertencias no bloqueantes: glob vacío de Stencil/Ionic al compilar, avisos habituales de íconos Ionic en Karma y APIs Gradle obsoletas para una futura migración a Gradle 9. No se cambiaron versiones del pipeline.

## Límites conocidos

- No se probó un dispositivo Android físico ni se ejecutaron pruebas PostgreSQL que requieren infraestructura local/Docker. Las pruebas nuevas de rutas aíslan autorización de persistencia; no equivalen a una prueba de extremo a extremo contra PostgreSQL.
- El frontend usa el reloj del dispositivo para anticipar la UX; el servidor es la autoridad. Un reloj desajustado puede producir un rechazo al guardar aunque un control estuviera habilitado. No permite eludir la API.
- La ventana se evalúa al autorizar la petición. Una operación admitida antes del vencimiento puede finalizar después; no se añadió cancelación de transacciones ya admitidas.
- Los permisos visuales de ubicación se calculan sobre los pozos visibles para la sesión. Si una ubicación histórica es compartida con un pozo no visible, la API comprueba todos los vínculos y puede rechazar una acción que la interfaz permitía iniciar.
- Se mantiene la precedencia histórica de propietario en las consultas de lectura cuando una cuenta tiene simultáneamente propietario/perforador. Administración conserva prioridad. No se amplió el alcance de lectura ni se refactorizó el modelo de roles.
- Los registros históricos sin creador no se atribuyen automáticamente a su perforador asignado: administración sigue pudiendo corregirlos.
- La regeneración de PNG usa PowerShell/System.Drawing en Windows. Los derivados quedan versionables y la verificación SHA-256 corre con Node. Tras cambiar originales o regenerar con otro motor, revisar y actualizar el manifiesto de hashes.

## Próxima validación en Android físico

1. Revisar y aprobar estos cambios. En una intervención separada y autorizada, preparar backend y distribución Android siguiendo el pipeline vigente.
2. Con datos de prueba: crear como perforador con propietario provisional y número empresarial; guardar pozo, ubicación, foto, litologías/autocompletado, diámetros, filtros y aportes.
3. Preparar registros propios recientes, propios mayores a 24 horas y ajenos en un entorno de prueba. Verificar lista, detalle, URL directa y cada familia técnica. Comprobar frontera exacta con reloj controlado del entorno; no alterar el reloj del teléfono como prueba de seguridad del backend.
4. Dejar el editor abierto hasta vencer; comprobar solo lectura, ausencia de borrado de pozo y rechazo HTTP 403 si se intenta enviar por fuera de la interfaz. Confirmar que administración puede editar el registro viejo.
5. Verificar cuenta inactiva y revocación de sesión. Probar ubicación compartida con un pozo antiguo o ajeno y confirmar rechazo.
6. Inspeccionar ícono en launcher circular y cuadrado, arranque frío en Android 12+ y versión anterior soportada, orientación vertical/horizontal y modo claro/oscuro. Confirmar transición al home/login sin recortes ni distorsión; en arranque rápido el splash completo puede ser fugaz.
7. Revalidar numeración global, propietario provisional/vinculación administrativa, home animado y generación/lectura de informe.

## Restricciones respetadas

Sin commit, push, Docker, migraciones, firma ni instalación de APK. `.env.pilot.local` permanece sin cambios. Los builds y recursos sincronizados quedan disponibles localmente; los directorios de salida ignorados no forman parte del inventario Git.

## Inventario completo para revisión

Se listan a continuación archivos modificados y nuevos; los dos originales de branding ya estaban presentes sin seguimiento al iniciar la intervención.

Total: **81 archivos** (68 modificados y 13 nuevos/sin seguimiento). No se ejecutó git add.

### Modificados

- `api/src/plugins/jwt.ts`
- `api/src/routes/informes.ts`
- `api/src/routes/pozos.ts`
- `api/src/routes/sitios.ts`
- `front/android/app/src/main/res/drawable-land-hdpi/splash.png`
- `front/android/app/src/main/res/drawable-land-mdpi/splash.png`
- `front/android/app/src/main/res/drawable-land-xhdpi/splash.png`
- `front/android/app/src/main/res/drawable-land-xxhdpi/splash.png`
- `front/android/app/src/main/res/drawable-land-xxxhdpi/splash.png`
- `front/android/app/src/main/res/drawable-port-hdpi/splash.png`
- `front/android/app/src/main/res/drawable-port-mdpi/splash.png`
- `front/android/app/src/main/res/drawable-port-xhdpi/splash.png`
- `front/android/app/src/main/res/drawable-port-xxhdpi/splash.png`
- `front/android/app/src/main/res/drawable-port-xxxhdpi/splash.png`
- `front/android/app/src/main/res/drawable/splash.png`
- `front/android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- `front/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png`
- `front/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png`
- `front/android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- `front/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png`
- `front/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png`
- `front/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- `front/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png`
- `front/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png`
- `front/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- `front/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png`
- `front/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png`
- `front/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
- `front/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png`
- `front/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png`
- `front/android/app/src/main/res/values/styles.xml`
- `front/angular.json`
- `front/package.json`
- `front/scripts/build-native.mjs`
- `front/scripts/verify-native-assets.mjs`
- `front/src/app/app.routes.ts`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html`
- `front/src/app/routes/pozos/components/pozos-form/pozos-form.component.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.html`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.spec.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.ts`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-create/aportes-create.page.html`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-create/aportes-create.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-edit/aportes-edit.page.html`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-edit/aportes-edit.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-list/aportes-list.page.html`
- `front/src/app/routes/pozos/pages/tecnica/aportes/aportes-list/aportes-list.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-create/intervalos-diametros-create.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-create/intervalos-diametros-create.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-edit/intervalos-diametros-edit.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-edit/intervalos-diametros-edit.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-list/intervalos-diametros-list.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-list/intervalos-diametros-list.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-create/intervalos-litologicos-create.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-create/intervalos-litologicos-create.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-edit/intervalos-litologicos-edit.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-edit/intervalos-litologicos-edit.page.ts`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-list/intervalos-litologicos-list.page.html`
- `front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-list/intervalos-litologicos-list.page.ts`
- `front/src/app/routes/sitios/pages/sitios-edit/sitios-edit.page.html`
- `front/src/app/routes/sitios/pages/sitios-edit/sitios-edit.page.ts`
- `front/src/app/routes/sitios/pages/sitios-list/sitios-list.page.html`
- `front/src/app/routes/sitios/pages/sitios-list/sitios-list.page.ts`

### Nuevos o sin seguimiento

- `api/src/services/edicion-pozo.ts`
- `api/test/edicion-pozo.test.ts`
- `front/branding/android-assets.json`
- `front/branding/rs_icono_piloto.png`
- `front/branding/rs_splash_piloto.png`
- `front/scripts/generate-android-branding.ps1`
- `front/scripts/verify-android-branding.mjs`
- `front/src/app/core/guards/edicion-pozo.guard.ts`
- `front/src/app/shared/services/edicion-pozo.service.spec.ts`
- `front/src/app/shared/services/edicion-pozo.service.ts`
- `front/src/app/shared/services/permisos-sitio.service.ts`
- `front/src/app/shared/services/permisos-tecnicos.service.ts`
- `docs/REVISION_TECNICA_2026-10-02_EDICION_24H_BRANDING_ANDROID.md`
