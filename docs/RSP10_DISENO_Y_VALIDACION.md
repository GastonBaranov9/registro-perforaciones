# RSP-10 — Renovación visual, correcciones y Sello sanitario

Fecha: 30/09/2026. Cambios locales preparados para revisión humana.

Actualización posterior: [ajustes finales de Home, login y migración 009](RSP10_AJUSTES_FINALES.md). Ese reporte contiene los resultados y assets más recientes (362 tests frontend y 215 assets); las cifras/capturas siguientes documentan la renovación inicial.

## A. Diagnóstico inicial

- Rama comprobada: `feature/rsp-10-pilot-apk`.
- HEAD comprobado antes de editar: `2f7c80e85d23` (`fix(android): address pilot UX and native file flows`).
- `git status --short` inicial: vacío. No había cambios del usuario que preservar.
- Se inspeccionaron rutas y componentes standalone Angular, estilos globales/Ionic, formularios compartidos, servicios de fotografía/perfil, backend Fastify, migraciones y tests. No se encontraron instrucciones AGENTS.md aplicables.
- Versiones instaladas relevantes: Angular 20.3.30, Ionic 8, Capacitor 8.5.0. Se conservaron las dependencias.

Problemas encontrados:

1. Estilos por pantalla con gradientes, sombras, tamaños y radios distintos; botones sin una jerarquía común.
2. Header con competencia entre nombre completo y marca; Home corregido previamente mediante una escala demasiado pequeña.
3. Filas Ionic con etiqueta y valor dentro de su contenedor flex interno: los correos y las coordenadas compartían un espacio insuficiente. Cambiar solamente el `part(native)` no resolvía esa estructura interna. Se sustituyeron las filas de consulta por listas de definición semánticas.
4. Selector fotográfico dentro de `ion-item` y vista previa con `ion-img` diferida: ancho comprimido y presentación inestable. La plantilla condicionaba parte del contenido a `fotoFile`, una propiedad no reactiva, antes de leer la señal de vista previa, relevante en Angular sin Zone.
5. La ruta de listado comprobaba propietario y perforador antes que administración, por lo que un administrador con más roles recibía un listado restringido.
6. El contrato de patrones sólo incluía doce texturas. La siguiente migración disponible era `009`.
7. Ionic usa sus variables `--ion-safe-area-*`; Capacitor 8 ofrece variables de respaldo para WebViews Android antiguos. Faltaba conectar ambos mecanismos.

## B. Investigación y sistema visual

Documentación oficial consultada:

- [Ionic: variables CSS](https://ionicframework.com/docs/theming/css-variables), [botones](https://ionicframework.com/docs/api/button) y [theming avanzado](https://ionicframework.com/docs/theming/advanced). El sitio actual documenta una versión más reciente; se contrastaron las capacidades utilizadas con Ionic 8 instalado.
- [Material Design 3: botones](https://m3.material.io/components/buttons/overview) y [Material Web: variantes de botón](https://material-web.dev/components/button/). La página de M3 requiere JavaScript; Material Web aportó la documentación textual oficial de las variantes.
- [Android: accesibilidad de controles y objetivos táctiles](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views), [grillas y unidades](https://developer.android.com/design/ui/mobile/guides/layout-and-content/grids-and-units).
- [WCAG 2.2](https://www.w3.org/TR/wcag/), [reflow a 320 CSS px](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- [Capacitor: System Bars y áreas seguras](https://capacitorjs.com/docs/apis/system-bars), contrastado con `SystemBars.java` de Capacitor instalado y el CSS de Ionic.

Se aplicó una composición sobria: superficies claras, marca original, rojo reservado para acciones principales, azul para estructura y acciones secundarias, controles amplios, información técnica apilada en móvil y columnas sólo cuando hay espacio. Sin fuentes remotas, imágenes nuevas, efectos costosos ni librerías de UI adicionales.

Los tokens están en [variables.css](../front/src/theme/variables.css); los patrones comunes, en [styles.css](../front/src/styles.css).

| Uso | Valor | Contraste calculado |
| --- | --- | --- |
| Principal | `#b8202b` | 6,40:1 con blanco |
| Secundario | `#163c68` | 11,17:1 con blanco |
| Acento/foco | `#006b80` | 6,15:1 con blanco |
| Fondo / superficie | `#f3f5f7` / `#ffffff` | — |
| Superficie secundaria | `#eaf0f5` | — |
| Texto principal | `#192b3c` | 14,46:1 sobre blanco |
| Texto secundario | `#526273` | 6,26:1 sobre blanco |
| Borde decorativo / control | `#ccd5df` / `#78899a` | Control: 3,59:1 sobre blanco |
| Error | `#a51d2d` / `#fff1f2` | 6,79:1 |
| Éxito | `#176442` / `#e8f4ee` | 6,33:1 |
| Advertencia | `#805400` / `#fff5df` | 6,08:1 |

Los contrastes se calcularon con luminancia relativa sRGB. No constituyen una certificación WCAG completa de todas las combinaciones y estados.

Reglas reutilizables:

- Fuente del sistema, cuerpo de 16 px, textos auxiliares de 14–15 px, encabezados escalables. Home usa el ancho de su contenedor y tres líneas deliberadas, con «RAÚL SILVA» de al menos 32 px.
- Escala de espacios de 4, 8, 12, 16, 24 y 32 px. Radio de controles 8 px, tarjetas 12 px. Ancho máximo de contenido 72 rem.
- Controles de acción de al menos 48 px; texto de botones puede envolver. Primario sólido; secundario `fill="outline"`; cancelar/volver `fill="clear"`; destructivo `color="danger"` y texto explícito.
- Focus visible, pressed de Ionic, estados disabled, mensajes loading existentes y avisos semánticos de error/estado. No se cambiaron las acciones de los botones por razones estéticas.
- `.data-row` para etiqueta/valor: una columna en móvil, dos desde 600 px. `.action-row` permite envolver acciones. `.status-badge` comunica Activo/Inactivo sin alterar el booleano.
- Grillas de formularios técnicos basadas en contenedor; `minmax(0, 1fr)` y ancho mínimo limitado por el espacio real.
- `viewport-fit=cover` y puente de variables de áreas seguras de Capacitor a Ionic; soporte de movimiento reducido.

Para nuevas pantallas: usar estos tokens, controles Ionic y patrones compartidos; reservar estilos locales para la composición específica. Los colores de materiales geológicos y sus trazos siguen siendo datos del dominio, independientes de la paleta de interfaz.

## C. Cambios implementados

| Área | Componentes y archivos principales |
| --- | --- |
| Base visual y encabezado | `front/src/theme/variables.css`, `styles.css`, `index.html`, `app/app.{css,html,ts}`, `scripts/build-native.mjs` |
| Home y acceso | `routes/home/home.page.*`, `routes/login/login.page.*` |
| Navegación y menús | `components/estilo-paginas/*`, menús de usuarios, sitios y pozos |
| Usuarios y perfil | listado, detalle/perfil y estilos de acciones; los formularios de alta/edición heredan el sistema global |
| Sitios y GPS | listado y detalle con filas semánticas; formulario existente conserva captura y validaciones |
| Pozos | formulario compartido, edición, listado, detalle, filtros, selectores de personas, fotografías y borrador técnico |
| Técnica | listados de litología, diámetros y aportes; altas/ediciones y filtros heredan controles globales |
| Catálogo y perfil | administración, selector litológico, SVG y contrato de patrones compartido con PDF |
| Regresiones | tests de roles/fotos/catálogo/PDF, integración PostgreSQL aislada y auditoría Chrome CDP |

El header conserva acceso a cuenta con nombre accesible completo y texto visual compacto. El perfil conserva el nombre completo. Las tarjetas de menú son enlaces reales, accesibles con teclado. Ubicación presenta localidad/departamento y coordenadas separadas. Las filas de correo pueden usar todo el ancho móvil y romper cadenas largas.

Se actualizaron las expectativas de los scripts históricos de integración a diez migraciones (`000`–`009`); la migración artificial de fallo pasó a `010` para evitar colisión. No se alteró el migrador de producción ni las migraciones históricas.

Lista completa para revisión y futuro commit: [estado Git](evidence/rsp10/git-review.txt). No se agregaron dependencias.

## D. Correcciones funcionales

### Prioridad de roles

[pozos.ts](../api/src/routes/pozos.ts) resuelve primero administración en `GET /usuarios/:id_usuario/pozos`. Conserva filtros, identidad autenticada y restricciones existentes para propietario y perforador. Un usuario propietario+perforador sin administración conserva la prioridad previa de propietario: no se amplió a una unión de ambos listados.

[pozos-roles-multiples.test.ts](../api/test/pozos-roles-multiples.test.ts) realiza ocho solicitudes Fastify con pool simulado: administración sola, perforador solo, propietario solo, administración+perforador, administración+propietario, los tres roles, propietario+perforador y ausencia de permisos. Comprueba consulta completa frente a consulta restringida, filtros, uso del sujeto autenticado aunque el parámetro URL sea otro, y respuesta 403 sin consulta de pozos para quien no tiene permisos.

Se revisaron servicios de pozos y endpoints próximos de sitios, detalle y escritura: ya utilizan administración primero o comprobaciones equivalentes. No se modificaron contratos de autenticación.

### Fotografía pendiente

El formulario lee directamente la señal de vista previa y usa una imagen de carga inmediata con espacio reservado. La selección nueva tiene prioridad sobre la guardada y muestra «Fotografía pendiente de guardar». El usuario puede reemplazarla varias veces o cancelar el cambio; la anterior no se elimina al seleccionar otra.

Se liberan ObjectURL al reemplazar, cancelar, destruir y confirmar guardado. La página limpia el borrador únicamente después de una respuesta satisfactoria; ante fallo conserva la selección y muestra que sigue pendiente. Recargar pide confirmación si hay una foto pendiente. Durante el guardado se bloquea otra selección y se libera una captura tardía.

Regresiones en [pozos-form.component.spec.ts](../front/src/app/routes/pozos/components/pozos-form/pozos-form.component.spec.ts) y [pozo-edit.page.spec.ts](../front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.spec.ts): imagen renderizada, selección más reciente, revocación de URL, guardado exitoso y fallido. Se mantienen los tests existentes de Camera, galería, JPEG/PNG y límite de 5 MB.

Chrome seleccionó un archivo real local y verificó `img.complete`, `naturalWidth > 0`, una única vista previa y el aviso pendiente a los seis anchos. Camera/galería nativas requieren la prueba física indicada abajo.

## E. Sello sanitario y despliegue controlado

Nueva migración: [009_sello_sanitario.sql](../api/db/migrations/009_sello_sanitario.sql).

- Código `sello_sanitario`, nombre `Sello sanitario`, familia `otro`, color `#999999`, patrón nuevo `concrete`, orden 30.
- Extiende el CHECK con `concrete` conservando los doce patrones anteriores. Inserción `ON CONFLICT (codigo) DO NOTHING`: no sobreescribe una entrada preexistente con el mismo código.
- Una colisión de nombre con otro código falla y debe revisarse; no se elimina ni renombra automáticamente un registro administrativo.
- No modifica intervalos, profundidades, reglas de solapamiento ni el booleano `pozo.sello_sanitario`.
- Textura gris con moteado fino y pequeños agregados. SVG y PDF comparten parámetros; contrato frontend/backend comprobado byte a byte.
- El selector ya obtiene el catálogo desde la API: la opción aparece cuando se despliega y aplica la migración. No aparecerá en la base del piloto hasta entonces.
- [PDF sintético de cuatro páginas](evidence/rsp10/sello-sanitario.pdf), con intervalo editable de ejemplo 0–3,5 m.

Prueba PostgreSQL real: contenedor exclusivo `rsp10-catalog-audit`, sin red, sin puertos, sin volúmenes ni bind mounts, almacenamiento tmpfs. Se aplicaron `000`–`008`, se crearon datos sintéticos, se ejecutó `009` dos veces y se comprobaron 30 materiales, 29 históricos idénticos, intervalos conservados, CHECK de color/patrón y booleano independiente. Script: [sello-sanitario-postgres.local.ts](../api/test/sello-sanitario-postgres.local.ts). No usa configuración DB del entorno.

Procedimiento para el operador, después de aprobación humana; **no ejecutado sobre el piloto**:

1. Revisar y respaldar el despliegue vigente mediante el procedimiento operativo existente, incluyendo DB/fotografías y manifiesto de backup. Verificar el respaldo en un entorno de restauración autorizado.
2. En una ventana de mantenimiento, detener escrituras. Confirmar en el destino correcto que el ledger llega a `008`, que los checksums históricos coinciden y que no hay otras migraciones pendientes inesperadas.
3. Consultar posibles colisiones antes de aplicar:

   ```sql
   SELECT version, nombre FROM schema_migrations ORDER BY version;
   SELECT id_litologia, codigo, nombre, color, patron
   FROM catalogo_litologia
   WHERE codigo = 'sello_sanitario'
      OR nombre_normalizado = litologia_normalizar('Sello sanitario');
   ```

4. Preparar el backend/frontend nuevos en conjunto: versiones anteriores pueden desconocer `concrete`. Ejecutar el servicio `migrate` del despliegue aprobado, o el runner equivalente con las variables de conexión ya configuradas de forma segura por el operador. Desde `api`, el runner real es:

   ```powershell
   npm.cmd run build
   if ($LASTEXITCODE -ne 0) { throw 'Build API falló' }
   npm.cmd run db:migrate
   if ($LASTEXITCODE -ne 0) { throw 'Migración falló; revisar antes de continuar' }
   ```

   El runner aplica las pendientes con lock, transacción y registro de checksum. No usar `--adopt-current-schema` para una base que ya tiene ledger. No ejecutar el SQL suelto en el piloto, porque omitiría el registro del runner.

5. Verificar ledger `009`, una sola entrada del material y ausencia de cambios en intervalos históricos. En una instalación semilla sin entradas administrativas extra habrá 30 materiales; no exigir ese total en una base personalizada.
6. Iniciar el conjunto compatible, seleccionar el material, guardar un intervalo de profundidad elegida y comparar vista previa/PDF. Una segunda ejecución del runner debe informar que no hay cambios pendientes.
7. Ante fallo, mantener mantenimiento y revisar el error. El DDL/INSERT de `009` se revierte transaccionalmente. Tras crear intervalos `concrete`, no retirar el patrón ni retroceder sólo el binario a una versión incompatible; usar el procedimiento de restauración aprobado.

## F. Verificación

| Verificación ejecutada | Resultado |
| --- | --- |
| Frontend `npm.cmd test -- --watch=false --browsers=ChromeHeadless --progress=false` | PASS, 359 tests |
| `npm.cmd run test:config` | PASS, 47 tests |
| `npm.cmd run test:native-config` | PASS, 38 tests |
| `npm.cmd run check:utf8` | PASS |
| `npm.cmd run build:production` | PASS |
| `NATIVE_BACKEND_ORIGIN=https://api.raulsilvaperforaciones.com` + `build:native:production` | PASS |
| Capacitor `sync android` | PASS, 7 plugins |
| `npm.cmd run verify:native-assets` | PASS, 214 archivos idénticos por SHA-256 |
| `check:native-release-readiness` con origin explícito | READY, 46 tests; revisión manual de icono/splash pendiente |
| API `npm.cmd test` | PASS, 315 tests, incluyendo roles/catálogo/perfil/PDF |
| API `npm.cmd run build` | PASS; incluye typecheck TypeScript |
| PostgreSQL aislado, migración `009` repetida | PASS |
| Gradle `test lint assembleDebug` | PASS, 631 tareas consideradas |
| Chrome CDP, 27 rutas × 6 anchos | PASS, 162 mediciones |
| Selección de foto, apertura de filtros y menú | PASS a los seis anchos |
| Respaldo CSS de áreas seguras Capacitor | PASS con insets sintéticos de 24/32 px |
| Sintaxis PowerShell de los seis scripts históricos actualizados | PASS |
| `git diff --check` | PASS |

Los logs de ejecución quedan localmente en `docs/evidence/rsp10/*.log` (ignorados por Git). Los resultados resumidos y las mediciones JSON sí forman parte de la evidencia revisable.

Durante las verificaciones, el sandbox impidió inicialmente el acceso de Gradle a su caché; las mismas comprobaciones pasaron con ejecución autorizada. Una invocación de readiness sin `NATIVE_BACKEND_ORIGIN` falló correctamente; se repitió con el valor explícito y pasó. Se corrigió la simulación CORS del navegador antes de aceptar las mediciones con perfil cargado.

Advertencias no bloqueantes: glob interno de Stencil en los builds Angular; APIs Gradle obsoletas para Gradle 9; avisos existentes de Ionic/Zone en tests. No se actualizaron dependencias para resolverlos.

APK debug local: `front/android/app/build/outputs/apk/debug/app-debug.apk`. SHA-256: `C4C2D36202AACA28E38F222DE9552AD82863AC154DD3B6747787DE6318AA3619`. No se instaló. No se generó APK release.

Límites explícitos:

- No se declara validación física Android. Las barras del sistema, teclado real, escala de fuente del sistema, cámara, galería, compartir y recuperación de red deben repetirse en el Redmi.
- Chrome usa fixtures sintéticas y altura de 900 px; comprueba DOM real, Shadow DOM, geometría, imágenes cargadas y capturas. No prueba permisos reales de un dispositivo ni comunicaciones con el servidor piloto.
- No se ejecutaron los scripts Docker históricos de lifecycle/upgrade completos: crean o eliminan volúmenes y exceden las restricciones de esta tarea. Se adaptaron sus expectativas y validó su sintaxis; la migración se ejecutó en tmpfs aislado.
- No se ejecutó una auditoría automática completa WCAG/TalkBack. Los diagramas conservan tabla textual accesible; sus etiquetas SVG se escalan con el gráfico.
- El gate mantiene el `MANUAL_CHECK` previo de icono/splash. La identidad Android, nombre y versión permanecen iguales.

## G. Evidencia visual

[Abrir galería comparativa antes/después](evidence/rsp10/index.html).

Capturas comparables de Home, login, usuarios, listado de pozos y edición a 320, 390 y 1280 px. Capturas adicionales de foto pendiente, filtros y menú a 320, 360, 390, 430, 768 y 1280 px. Los datos son de ejemplo; ninguna captura contiene información recuperada del piloto.

La auditoría cubre login, Home, los tres menús, perfil, usuarios alta/edición/lista, sitios alta/edición/lista/detalle, pozos alta/edición/lista/detalle, administración de litologías y alta/edición/lista de intervalos litológicos, diámetros y aportes. Comprueba bordes fuera del viewport, texto recortado, controles menores de 48 px con tolerancia de redondeo y solapamiento etiqueta/valor. Además abre los filtros, busca personas y selecciona una fotografía real local.

[Resultados geométricos finales](evidence/rsp10/after/geometry.json). Las capturas principales fueron inspeccionadas; el resto de las rutas tiene comprobación estructural y geométrica. Compilar una ruta no se considera validación visual.

Para reproducir: desde `front`, iniciar `node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4206`; en otra terminal ejecutar `node scripts/responsive-audit.mjs after`. Requiere Chrome y Node con soporte TypeScript nativo; no instala dependencias. El script intercepta las solicitudes HTTP ajenas al devserver con fixtures, rechaza rutas redirigidas inesperadamente, exige el perfil cargado y termina con error si encuentra regresiones geométricas.

## H. Próxima prueba física en Redmi A2

Después de revisión humana y distribución autorizada de un APK compatible:

- [ ] Inicio: marca visible, nombre largo compacto, perfil accesible y nombre completo dentro del perfil.
- [ ] Home: tres líneas con presencia y eslogan legible; sin scroll lateral en retrato y paisaje.
- [ ] Login incorrecto: mensaje visible. Login correcto, persistencia al cerrar/reabrir y cambio de contraseña.
- [ ] Teclado abierto en altas/ediciones: campo enfocado visible, botón alcanzable por desplazamiento, barras Android sin tapar controles. Repetir con fuente del sistema aumentada.
- [ ] Usuarios: correo largo envuelto, Activo/Inactivo correcto, Editar/Borrar cómodos. Alta y edición siguen funcionando.
- [ ] Sitios/GPS: localidad y departamento separados de latitud/longitud; captura nativa y edición del sitio.
- [ ] Roles: cuenta administrativa con ambos roles adicionales ve el pozo N.º 1 y todos los autorizados. Perforador/propietario solos no ven pozos ajenos.
- [ ] Foto guardada → cámara → vista previa inmediata con aviso pendiente, antes de guardar.
- [ ] Foto guardada → galería → nueva selección → otra selección: siempre aparece la última. Cancelar conserva la foto anterior.
- [ ] Eliminar foto y cancelar; eliminar y guardar; reemplazar y guardar; salir/reingresar sin imagen obsoleta.
- [ ] Cortar Internet al guardar foto: error visible y selección pendiente; recuperar red y reintentar. Probar JPEG/PNG y rechazo de archivo mayor de 5 MB.
- [ ] Selectores: buscar propietario/perforador con nombres y correos largos; selección y teclado sin superposición.
- [ ] Datos técnicos: litologías, diámetros y aportes sin columnas estrechas; validaciones de intervalos intactas.
- [ ] Tras aplicar `009` autorizadamente: Sello sanitario disponible, profundidad editable distinta de 2 m, gris moteado visible en perfil y PDF; booleano sanitario independiente.
- [ ] PDF: generar, descargar/compartir, abrir y comprobar portada, sitio, técnica, foto y perfil. Verificar error/reintento sin red.
- [ ] WebSocket y recuperación al volver Internet; navegación por menús, filtros y retorno a formularios.
- [ ] Repetir controles principales en otro Android de distinto ancho, además del Redmi A2.

## I. Estado Git y revisión

Se conservan rama y HEAD iniciales. No hubo commit, push, PR ni cambio de rama. No se modificaron `.env`, credenciales, applicationId, nombre ni versión Android. No se accedió a keystores, no se migró el piloto, no se borraron datos del dispositivo ni se destruyeron volúmenes Docker.

[git-review.txt](evidence/rsp10/git-review.txt) contiene `git diff --check`, `git diff --stat`, `git status --short` y la lista completa de archivos nuevos/modificados para un futuro commit. Incluye código, nueva migración, pruebas, documentación, galería, capturas y mediciones. Los logs, builds, APK y caches permanecen fuera del commit según las reglas existentes de Git.
