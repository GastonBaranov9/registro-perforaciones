# Ajustes finales UI/UX — 2026-10-01

Rama: `feature/rsp-10-pilot-apk`. Cambios pendientes de revisión, sin commit.

## Cambios y criterio

- Home: tarjeta centrada en el espacio disponible. Se mantiene el archivo de fondo, su posición y los colores. Animación CSS de `translateY(0)` a `translateY(-4px)` y regreso, en 8 segundos, con `ease-in-out`. Sólo se activa con `prefers-reduced-motion: no-preference`.
- Menú: texto exacto `ADMINISTRAR LITOLOGÍAS`, dentro de la misma condición de administrador.
- Listado: pozo, empresa, propietario, sitio y fecha. Caudal y profundidad siguen disponibles en filtros y detalle; se retiran del resumen para reducir su altura. Los nombres largos pueden ocupar varias líneas.
- Búsqueda visible por propietario, parcial, sin distinguir mayúsculas ni tildes, con borrado y mensaje sin coincidencias. Se aplica a los resultados autorizados que devuelve el filtro numérico existente. Las recargas conservan los filtros aplicados, sin aplicar borradores cancelados del modal.
- El modelo de sitio no tiene campo nombre. Se muestra localidad y departamento, con padrón como alternativa cuando falta localidad. No se agrega una columna ni una migración.
- API: el listado incorpora `propietario_nombre` y `sitio_nombre` con joins en una sola consulta. Conserva los alcances por rol. Se corrige `profunidad_*` a `profundidad_*` en el contrato de consulta para aceptar los parámetros enviados por el frontend.

La búsqueda es local sobre la lista recibida, que actualmente no está paginada. Si se incorpora paginación futura, habrá que trasladar este filtro al servidor. Para mostrar los nombres reales es necesario actualizar la API junto con el frontend.

## Verificación

| Verificación | Resultado |
| --- | --- |
| Tests frontend: Home, listado, servicio de listado y shell/menú | PASS, 17 tests |
| API: listado con nombres, filtros y combinaciones de roles | PASS, 8 tests |
| Compilación TypeScript de API | PASS |
| Consulta de listado en PostgreSQL local, `EXPLAIN` en transacción de sólo lectura | PASS |
| `npm.cmd run build:production` | PASS |
| `npm.cmd run build:native:development` | PASS |
| Capacitor sync + `verify:native-assets` | PASS, 215 archivos idénticos por SHA-256 |
| Android `gradlew.bat assembleDebug` | PASS |
| Responsive: 320, 360, 390, 430, 768 y 1280 px, altura 740 px | PASS, 24 combinaciones de ruta/ancho |
| Centrado, amplitud/ciclo de animación y movimiento reducido | PASS |
| Búsqueda real desde input, coincidencia parcial, tildes, vacío y borrado | PASS |
| Ojo de contraseña: mouse, teclado y touch | PASS |
| UTF-8 de interfaz y `git diff --check` | PASS |

Auditoría en Chrome headless con datos sintéticos para Home, login, listado y detalle. Capturas revisadas de Home, menú, tarjetas y búsqueda; sin desbordes, texto recortado, filas solapadas ni controles menores de 48 px según la auditoría existente. No se realizó una nueva prueba física en Redmi A2 ni medición de rendimiento en ese dispositivo.

Native se compiló con el origin de prueba `https://api.example.test`, sin instalación ni distribución. El APK debug resultante sirve para validar compilación; no es una actualización conectada al piloto. Los builds mantienen advertencias de Stencil/Gradle; el harness de tests emite advertencias de Ionic sin fallos de tests.

Evidencia local (directorio ignorado por Git): [geometría](evidence/rsp10/ui-polish/geometry.json), [Home](evidence/rsp10/ui-polish/home-390.png), [menú](evidence/rsp10/ui-polish/menu-390.png), [listado](evidence/rsp10/ui-polish/pozos-list-390.png), [búsqueda](evidence/rsp10/ui-polish/owner-search-390.png).

## Archivos modificados

- `front/src/app/routes/home/home.page.css`
- `front/src/app/app.html`
- `front/src/app/app.spec.ts`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.ts`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.html`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.css`
- `front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts`
- `front/src/app/shared/types/schemas.ts`
- `front/scripts/responsive-audit.mjs`
- `api/src/models/schemas.ts`
- `api/src/routes/pozos.ts`
- `api/src/services/pozos-services.ts`
- `api/test/pozos-roles-multiples.test.ts`
- `docs/RSP_10_UI_POLISH.md`
