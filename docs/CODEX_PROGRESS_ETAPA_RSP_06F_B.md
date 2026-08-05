# ETAPA RSP-06F-B — Perfil y refresco web

## Causa raíz y refresco

Ionic conserva la instancia de `PozosDetailPage` mediante `IonicRouteStrategy`. Al regresar desde `PozoEditPage`, `ionViewWillEnter` volvía a consultar pozo, litología, diámetros, filtros y aportes, pero `PerfilLitologicoComponent` solo consultaba su endpoint en `ngOnInit`. Como el hijo reutilizado no se reconstruía, mantenía el modelo anterior. No se encontró `shareReplay`, caché HTTP ni caché de servidor: el endpoint llama a `getReportePozo` en cada petición.

El detalle ahora incrementa una versión tipada en cada `ionViewWillEnter`. Esa entrada invalida el hijo, que limpia inmediatamente el modelo anterior y consulta de nuevo `GET /usuarios/:id_usuario/pozos/:id_pozo/perfil-litologico`. Cada carga recibe un número de solicitud; una respuesta anterior no puede reemplazar a la vigente. Durante la consulta se muestra carga. Un fallo deja el perfil vacío, muestra error y ofrece **Reintentar**, sin `window.location.reload`, temporizadores ni estado optimista. También se eliminó la doble carga inicial `ngOnInit`/`ionViewWillEnter` del detalle.

## Modelo visual canónico

`crearPerfilLitologico` genera ahora `etiquetas` para litología, tubería, filtro y aporte. Cada etiqueta contiene texto ya derivado de datos reales, profundidad de anclaje, rango de página, posición vertical normalizada, carril semántico y anclaje horizontal normalizado. Los carriles son: litología `0`, tubería `1`, filtro `2` y aporte `3`.

`resolverColisionesEtiquetas` es pura, no modifica la entrada, ordena determinísticamente y distribuye las posiciones verticales con margen y separación automática. Angular y `pdf-lib` consumen esas posiciones; ninguno vuelve a decidir la altura de las etiquetas. Los renderers solo convierten coordenadas normalizadas a su lienzo.

Formatos constructivos:

- `Tubería PVC · Ø 8 pulg · 0-25 m`;
- `Tubería Acero · Ø 6 pulg · 25-100 m`;
- `Tubería material no especificado · Ø 6 pulg · 0-25 m` para históricos;
- `Filtro ranurado PVC · Ø 6 pulg · 50-70 m`.

## Escala, guías y accesibilidad

Se retiró en web y PDF la cuadrícula horizontal punteada de ancho completo. La escala conserva números y marcas sólidas cortas junto al eje. Los límites reales de capas y elementos constructivos permanecen. Las líneas de etiquetas son sólidas, parten del tramo real y se dibujan antes de todos los textos.

La tabla accesible litológica conserva `caption`, tabla semántica y encabezados `scope="col"`, pero presenta únicamente **Intervalo** y **Material**. El campo interno `descripcion` no cambia; solo se retiró la columna que mostraba siempre “Sin descripción registrada”. No hubo migración ni cambio PostgreSQL.

## Archivos principales

- `front/src/app/routes/pozos/pages/pozos-detail/*`: invalidación al volver a la vista, estado de error y reintento.
- `front/src/app/shared/components/perfil-litologico/*`: recarga versionada, descarte de respuestas antiguas, escala, etiquetas y tabla.
- `front/src/app/shared/types/schemas.ts`: contrato tipado de etiquetas.
- `api/src/pdf/perfil-litologico.ts`: layout puro, textos constructivos, coordenadas canónicas y PDF sin cuadrícula.
- `api/test/rsp06fb.visual.ts`: casos visuales reproducibles A-D.
- specs del perfil, detalle y edición; pruebas API del modelo y PDF.

## Pruebas y evidencia visual

El script visual genera en `%TEMP%/rsp06fb-evidencias`:

- `caso-a-tuberias.{html,pdf}`: PVC 0-25 m y Acero 25-100 m;
- `caso-b-filtro-aporte.{html,pdf}`: filtro 50-70 m, aporte a 60 m y límite litológico cercano;
- `caso-c-refresco.html`: estado confirmado tras cambiar PVC por Acero sin recarga manual;
- `caso-d-multipagina.{html,pdf}`: capas finas y seis páginas PDF.

La inspección de A y B confirmó materiales, pulgadas, conectores sólidos, ausencia de cuadrícula y textos separados. C queda respaldado además por specs que fuerzan cambio de versión, reconsulta, cambio de material/diámetro, reintento y descarte de una respuesta antigua. D confirmó segmentación en seis páginas; los tests PDF ejercen el mismo modelo compartido.

## Seguridad, limitaciones y rollback

No cambiaron rutas, consultas SQL, autenticación, CSRF, cookies, `version_sesion`, autorización, archivos ni generación autorizada del PDF. No se añadieron dependencias, migraciones, `any`, `SELECT *`, Bearer ni almacenamiento de JWT. La paleta litológica permanece intacta.

Las evidencias HTML son artefactos locales reproducibles del modelo canónico, no una segunda implementación de producción. El visor PDF headless del equipo produjo una captura negra aunque los PDF fueron generados, abiertos estructuralmente por las pruebas y conservaron sus páginas; no se incorporó una dependencia de rasterización por esta limitación del entorno. El rollback consiste en revertir los commits de RSP-06F-B en orden inverso.
