# Informe técnico — formulario de campo, personas, limpieza y splash

Fecha: 2026-10-02. Rama: `feature/rsp-10-pilot-apk`. Base: `774a9781bd6f8`.
Todos los cambios permanecen locales, sin commit, push, despliegue ni APK firmada.

## Flujo de perforador y vinculación

El formulario de creación para una cuenta sólo perforadora muestra, en la sección de propietario, **Propietario pendiente de vinculación**, el campo obligatorio **Nombre del propietario provisional** y su explicación. No ofrece búsqueda, selección, registro ni edición de identidades. El selector y los campos administrativos permanecen disponibles sólo cuando el rol efectivo incluye administración. Una cuenta con ambos roles conserva la precedencia administrativa.

La API rechaza con 403 un `id_propietario` real enviado por un perforador a `POST /usuarios/:id_usuario/pozos/completo`, aunque falsifique el cuerpo o la URL. La base recibe `id_propietario=NULL` y `propietario_provisional` normalizado y obligatorio; el alta no inserta `usuario`, cuenta, contraseña ni rol. El endpoint de candidatos deniega búsquedas de propietarios a no administradores y el detalle de propietario operativo exige administración. La edición técnica de las primeras 24 horas sigue funcionando incluso si Administración ya vinculó un propietario; el cliente no intenta cargar datos privados del propietario para el perforador.

Administración ve el nombre provisional al abrir el pozo, puede buscar un propietario real, crear una ficha sin acceso con todos los datos administrativos y vincularla con `PUT /pozos/:id_pozo/propietario`. Este servicio compara `id_propietario_esperado` bajo bloqueo y modifica sólo `id_propietario` y `propietario_provisional=NULL`. Conserva la restricción `pozo_propietario_real_o_provisional` de la migración 012 y todos los demás campos y archivos del pozo. No se fusionan identidades por nombre.

## Administración → Usuarios y ficha de propietario

La causa de la omisión era `GET /usuarios`: el listado histórico filtra `usuario.cuenta_acceso=TRUE`. Las fichas de propietario sin credenciales están en la misma tabla `usuario`, con rol propietario y `cuenta_acceso=FALSE`. La nueva vista usa `GET /usuarios/personas`, protegido por administración, para buscar ambas categorías por nombre completo o parcial, documento/RUT e ID interno exacto, sin distinguir mayúsculas ni tildes. Muestra explícitamente si cada registro tiene acceso; dos homónimos permanecen como filas distintas por ID. La búsqueda y paginación son cómodas en móvil. La creación de ficha desde la vinculación no crea credenciales.

La nueva ficha administrativa consulta `GET /usuarios/personas/:id_usuario/perforaciones`, también restringido a administración. El total y la página se obtienen con `pozo.id_propietario = id_usuario`, nunca por texto. La carpeta comercial usa **`numero_perforacion`**, que es el campo empresarial real; `id_pozo` sólo se muestra como ID técnico. Un número nulo se presenta como **Pendiente de numeración**. Se muestran ubicación, fecha y enlace al detalle. Los provisionales sin FK real no se cuentan. El índice preparado en la migración 013 sirve el orden y el conteo por identidad, mientras índices trigram aceleran búsqueda parcial normalizada. La migración contiene sólo extensión e índices; no fue aplicada al piloto y se ensayó en PostgreSQL 16 aislado.

No se agregó un botón general de borrado de propietarios. Una baja segura necesita resolver explícitamente relaciones de propietario, autoría, sesiones, fotos y numeración. El listado administrativo ya evita presentar una eliminación directa de cuentas o fichas.

## Diagnóstico específico de Marcelo Bellagamba

Fuente: restauración aislada del bundle `rsp-backup-20261002T180908Z`, verificado por SHA-256, en `postgres:16.14-alpine3.24` sin red. No se consultó ni modificó el PostgreSQL piloto durante esta intervención.

| ID `usuario` | Acceso | Roles | Relaciones observadas |
|---|---|---|---|
| 4 | No | propietario | Propietario del pozo **ID 4**, carpeta **3001**; sitio ID 4; foto `pozo-4.jpg` |
| 5 | No | propietario | Sin pozos ni referencias adicionales |
| 7 | Sí, cuenta activa | propietario | Propietario del pozo **ID 2**, sin carpeta comercial; sitio ID 2; foto `pozo-2.jpg`; sesión nativa ID 16 ya revocada |

Los pozos 2 y 4 tienen creadores y perforadores **distintos** de los tres Marcelo: respectivamente creador 1/perforador 3 y creador 1/perforador 6. Ninguno de los Marcelo figura como perforador o creador de otro pozo. El pozo 2 tiene 3 intervalos litológicos, 2 de diámetro, 1 filtro y 1 aporte; el pozo 4 tiene 4 intervalos litológicos, 2 de diámetro y 2 aportes. No hay documentos, informes, cambios de numeración ni tickets WebSocket relacionados. La reserva permanente `numero_perforacion_reservado(3001)` apunta al ID técnico 4. El contador conserva `proximo=NULL` y `mayor_asignado=3001`.

El ID 7 aparece en el antiguo listado de usuarios porque tiene acceso; los IDs 4 y 5 se omitían por el filtro `cuenta_acceso=TRUE`. Los tres aparecen como propietarios porque tienen tres filas e IDs reales separados y el rol propietario. La coincidencia del nombre no se usó para fusionarlos.

## Limpieza preparada y ensayo completo

Archivo: `api/db/tests/013_bellagamba_cleanup.sql`. El script comprueba nombre, IDs, estados, roles, pozos 2/4 y sus FK, datos técnicos, sitios, sesiones y reserva 3001 antes de ejecutar nada. Borra por ID los hijos técnicos, pozos, sitios, sesión, roles e identidades, en una sola transacción. Verifica después la ausencia de los objetivos y la invariancia de la reserva y el contador. Por defecto termina en `ROLLBACK`; sólo `-v RSP_CLEANUP_COMMIT=true` habilita `COMMIT`. No usa `DELETE CASCADE` indiscriminado ni toca secuencias o reservas.

En la base aislada se ejecutó primero con `ROLLBACK` y luego con `COMMIT` para ensayar también las FK reales. Ambos pases terminaron sin error. Tras el `COMMIT` **sólo en la copia**, quedaron cero usuarios 4/5/7, cero pozos 2/4 y un pozo ajeno intacto; la reserva 3001 siguió apuntando a 4, `mayor_asignado=3001` y `proximo=NULL`. El archivo de fotos del backup se leyó sin extraerlo y contiene `fotos/pozo-2.jpg` y `fotos/pozo-4.jpg`.

### Ejecución futura, sólo con autorización nueva

1. Activar mantenimiento de escritura y crear **un backup coordinado fresco de PostgreSQL y fotos**. Verificar el manifiesto, tamaños y SHA-256; conservar copia independiente y probar su restauración en otro entorno aislado.
2. Volver a ejecutar `api/db/tests/012_propietarios_auditoria.sql` y la consulta de FK del catálogo. Comparar con esta tabla. Si hubo nuevas sesiones, pozos, documentos, informes, fotos, cambios de rol o número, detenerse y actualizar el procedimiento y sus precondiciones; el script actual falla cerrado.
3. Verificar en el volumen de fotos que sólo `pozo-2.jpg` y `pozo-4.jpg` pertenecen a esos IDs. Mover esas dos fotos a una cuarentena de la **misma unidad**, registrando hashes y rutas; no purgarlas antes de confirmar DB y backup. Restaurarlas si el SQL falla.
4. Con la API detenida y destino PostgreSQL confirmado, ejecutar con `psql -X -v ON_ERROR_STOP=1 -v RSP_CLEANUP_COMMIT=true -f api/db/tests/013_bellagamba_cleanup.sql`. La ausencia de esa variable implica ensayo con rollback. Guardar salida y hora. No ejecutar contra el piloto sin autorización expresa.
5. Comprobar que IDs 4/5/7, pozos 2/4, sitios 2/4 y la sesión 16 no existan; que los pozos ajenos y sus fotos sigan disponibles; que la reserva 3001 y el contador sean idénticos al inventario; y que las fotos en cuarentena coincidan con el manifiesto. Mantener la cuarentena durante la ventana de recuperación. No reutilizar 3001 ni cambiar `proximo`.
6. Si hay que recuperar, usar el **bundle coordinado fresco**, incluida la fotografía, siguiendo `ops/restore-full.ps1` y su confirmación explícita; verificar primero un restore aislado. La recuperación completa sustituye cambios posteriores al backup, por lo que requiere ventana de mantenimiento y decisión operativa.

## Splash Android y numeración

El índice nativo generado ya no pinta un fondo blanco debajo de `object-fit:contain`: usa la foto completa, alineada arriba, sobre una extensión desenfocada del mismo fondo que llena las franjas en relaciones de aspecto distintas. Los PNG nativos verticales mantienen el ancho completo del logo, camión y chorro y prolongan sólo la zona de terreno inferior hasta el borde. Los horizontales mantienen la foto completa sobre una extensión del entorno. El tema usa `android:windowBackground`, colores coherentes para barras de estado/navegación y conserva `windowSplashScreenAnimatedIcon` con el ícono RS para Android 12+. No hay temporizador, cambio de login, `applicationId` ni firma.

El error `P1100` se traduce a: «Administración todavía debe habilitar la numeración empresarial. No se pueden guardar perforaciones nuevas hasta que lo haga». No se fijó 3201, no se inventó el último número real, no se alteró el contador ni se liberó la reserva 3001. Hasta que se determine la numeración empresarial, el bloqueo impide la creación real de nuevos pozos.

## Pruebas y verificaciones

| Comprobación | Resultado |
|---|---|
| API `npm.cmd test` | 330/330 aprobadas; incluye seguridad, 24 horas y sesiones |
| Frontend ChromeHeadless | 403/403 aprobadas; incluye formulario, buscador y ficha |
| PostgreSQL 16 aislado: propietario provisional + migración 013 | 9/9 aprobadas, incluida ausencia de nuevas filas `usuario`, homónimos y vinculación íntegra |
| PostgreSQL 16 aislado: escrituras/sesiones/37 operaciones | 85/85 aprobadas |
| Numeración PostgreSQL 18 temporal | 2 escenarios aprobados (fresh y equivalente al piloto) |
| Backup restaurado PostgreSQL 16: limpieza | rollback y commit de ensayo aprobados; sólo copia temporal |
| `npm.cmd run build` API; `npm.cmd run build:production` web | Aprobados |
| `npm.cmd run build:native:production`; `npx.cmd cap sync android` | Aprobados con la URL HTTPS pública |
| `gradlew :app:compileReleaseJavaWithJavac` | Aprobado; no genera APK firmada |
| Assets, branding, readiness, UTF-8, `git diff --check` | Aprobados; readiness mantiene control visual manual |

Pendientes de la revisión final: confirmar visualmente el splash en el Redmi A2 y en otra relación de aspecto; aprobar o descartar la limpieza definitiva con un backup fresco; fijar el último número comercial **real** antes de habilitar `proximo`. La migración 013 requiere el módulo estándar PostgreSQL `pg_trgm` y debe validarse en la planificación del próximo despliegue; no se aplicó al piloto.

## Archivos locales cambiados

- API: `src/routes/pozos.ts`, `src/routes/usuarios.ts`, `src/services/candidatos-pozo-service.ts`, `src/services/numeracion-perforacion-service.ts`, `test/numeracion-perforacion-postgres.local.ts`, `test/propietario-provisional.postgres.local.ts`; nuevos `db/migrations/013_busqueda_personas_admin.sql`, `db/tests/013_bellagamba_cleanup.sql`, `src/services/personas-admin-service.ts` (todos bajo `api/`).
- Frontend: `src/app/app.routes.ts`, `src/app/shared/types/schemas.ts`, `src/app/shared/services/usuarios-list.service.ts`; `src/app/routes/pozos/components/pozos-form/pozos-form.component.html` y su spec; `src/app/routes/pozos/components/vincular-propietario/vincular-propietario.component.ts`; `src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.{ts,html}`; los cuatro archivos `usuarios-list.page.{ts,html,css,spec.ts}`; nuevos `src/app/routes/usuarios/pages/propietario-detail/propietario-detail.page.{ts,html,css,spec.ts}` (todos bajo `front/`).
- Splash y verificación: `front/scripts/build-native.mjs`, `generate-android-branding.ps1`, `verify-android-branding.mjs`, `verify-native-assets.mjs`, `front/branding/android-assets.json`, `front/android/app/src/main/res/values/styles.xml` y los once `splash.png` en `drawable/`, `drawable-port-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/` y `drawable-land-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/`.
- Documento nuevo: este informe.
