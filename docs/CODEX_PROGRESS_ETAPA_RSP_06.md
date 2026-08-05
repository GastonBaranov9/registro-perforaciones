# ETAPA RSP-06 — auditoría final del perfil litológico dinámico

## Resultado

La auditoría detectó que los commits iniciales `89ab80d` y `323db2c` resolvían solamente una página PDF y no la visualización web ni la fuente visual única. La etapa queda completada con un modelo de escena canónico calculado por la API, un adaptador SVG Angular y un adaptador PDF multipágina que consumen ese mismo modelo.

La corrección posterior RSP-06B integra la carga técnica en la creación, normaliza los `NUMERIC` de PostgreSQL que causaban el fallo al generar PDF con capas y añade eliminación segura de fotografías. El detalle completo está en `docs/CODEX_PROGRESS_ETAPA_RSP_06B.md`.

RSP-06C sustituye los IDs manuales por selectores funcionales y extiende el mismo editor técnico a una actualización completa y transaccional. Véase `docs/CODEX_PROGRESS_ETAPA_RSP_06C.md`.

## Matriz de requisitos

Estados: **completo**, **parcial**, **ausente**, **no aplicable por falta real de datos**.

| Área | Requisito | Estado | Evidencia |
|---|---|---:|---|
| Datos | Intervalos desde PostgreSQL | completo | `getReportePozo` consulta `intervalo_litologico` por `id_pozo`; web y PDF parten de ese reporte. |
| Datos | Profundidad oficial | completo | `crearPerfilLitologico` exige `pozo.profundidad_final_m`; rechaza una capa que la exceda y no recorta ni amplía silenciosamente. |
| Datos | Aportes separados del suelo | completo | `nivel_aporte` se consulta aparte; el modelo conserva `aportes[]` fuera de `tramos[]`. |
| Arquitectura | Función pura testeable | completo | `crearPerfilLitologico`, `estiloDeMaterial` y `calcularPasoEscala`. |
| Arquitectura | Renderer SVG determinista o equivalente | completo | Angular dibuja SVG declarativo desde el modelo determinista de API. |
| Arquitectura | Una fuente para web y PDF | completo | `PerfilLitologico` contiene geometría semántica, estilos, patrones, carriles, aportes y rangos; endpoint web y PDF usan la misma función. |
| Arquitectura | Sin dos diseños divergentes | completo | SVG y `pdf-lib` son adaptadores de salida; no recalculan orden, huecos, estilo, carriles ni paginado. |
| Web | Componente reutilizable | completo | `PerfilLitologicoComponent` con entradas `idUsuario` e `idPozo`. |
| Web | Pantalla real del informe | completo | Integrado en `pozos-detail`, junto al botón de generar PDF. |
| Web | Carga, error y ausencia | completo | Estados explícitos y pruebas Angular. |
| Web | Responsive | completo | SVG escalable, contenedor con desplazamiento para anchos pequeños y tabla responsive. |
| Web | Sin `innerHTML` | completo | Plantilla Angular con elementos SVG y bindings seguros. |
| Web | Alternativa accesible | completo | `title`, `desc`, `aria-label`, leyenda y tabla con `caption`/encabezados. |
| Web | Aislamiento | completo | `GET .../perfil-litologico` usa `authenticate`, `pozoIsFromUser` y roles de lectura antes de consultar PostgreSQL. |
| Diseño | Título exacto | completo | “Perfil litológico del pozo” en modelo, web y PDF. |
| Diseño | Escala 0–profundidad final y marcas | completo | Rangos contiguos cubren desde 0 hasta la profundidad oficial; cada sección repite extremos y marcas automáticas. |
| Diseño | Alturas proporcionales | completo | Ambos adaptadores aplican una transformación lineal dentro del mismo rango canónico. |
| Diseño | Intervalo, material y descripción | parcial | Intervalo y material completos; el contrato admite `descripcion`, pero la tabla `intervalo_litologico` no persiste ese campo. Web informa “Sin descripción registrada”; no se inventa contenido. |
| Diseño | Contornos y líneas guía | completo | Bordes oscuros y guías métricas discontinuas en ambos adaptadores. |
| Diseño | Evitar superposición fina | completo | Modelo asigna tres carriles y crea rangos con máximo 18 capas o 100 m; la auditoría visual corrigió la primera versión uniforme. |
| Diseño | Aportes azules | completo | Círculo azul y etiqueta por `nivel_aporte.profundidad_m`. |
| Diseño | Leyenda | completo | Explica patrón/tono, aporte azul y hueco. |
| Diseño | Color más patrones y grises | completo | Seis patrones, color determinista y luminancia `gris`; huecos usan cruz gris. |
| Diseño | Escape SVG | completo | Angular escapa interpolaciones y atributos; el generador visual de auditoría también escapa `&<>"'`. |
| Validación | `desdeM >= 0`, `hastaM > desdeM`, orden | completo | TypeBox, `CHECK` existente y normalizador puro. |
| Validación | Solapamientos bloqueados | completo | Altas/ediciones serializan por pozo con `pg_advisory_xact_lock` y usan consulta de intersección; el modelo también rechaza históricos inválidos. |
| Validación | Huecos explícitos | completo | Se insertan tramos `clase: hueco` “Sin datos”, sin alterar persistencia. |
| Validación | Sin corrección silenciosa | completo | Datos inválidos, profundidad ausente o excedida producen `PerfilLitologicoInvalido` (422). |
| Validación | Tipo desconocido estable | completo | Hash normalizado selecciona estilo completo determinista. |
| PDF | Misma representación | completo | Consume exactamente `PerfilLitologico`; no vuelve a normalizar datos. |
| PDF | Proporciones sin deformar | completo | Cada página usa transformación lineal por rango. |
| PDF | Textos sin cortar | completo | Etiquetas y materiales de tabla se envuelven por ancho de fuente; no se truncan con `slice`. |
| PDF | Multipágina y encabezados | completo | Máximo 100 m/18 capas por rango; título, rango, número de página, escala y leyenda se repiten. |
| PDF | Capas finas legibles | completo | Segmentación por densidad y carriles compartidos. |
| PDF | Resto del informe | completo | Prueba genera informe integral y exige páginas base más todas las páginas del perfil. La tabla litológica se conserva. |
| Pruebas | Mínimo, una capa, submetro | completo | `api/test/perfil-litologico.test.ts`. |
| Pruebas | Muchas finas, profundo, hueco | completo | Pruebas de rangos, carriles y proporciones. |
| Pruebas | Solapamiento y desconocido | completo | Rechazo explícito y estilo determinista. |
| Pruebas | Descripción larga y sin litología | completo | Contrato preservado y estado de ausencia. |
| Pruebas | Uno/varios aportes | completo | Orden y separación respecto de capas. |
| Pruebas | PDF multipágina | completo | Cantidad de páginas igual a cantidad de rangos y prueba del informe completo. |

## Arquitectura final

`getReportePozo` reúne profundidad, litología y aportes desde PostgreSQL después de la autorización. `crearPerfilLitologico` valida y produce un modelo inmutable con tramos reales, huecos, patrones, color, luminancia, carriles, aportes y rangos. `GET .../perfil-litologico` lo entrega a Angular; `crearPDF` entrega el mismo objeto a `dibujarPerfilLitologico`.

Los adaptadores únicamente transforman unidades: SVG usa `viewBox`; PDF usa puntos. La regla de partición vive en el modelo: una sección abarca como máximo 100 metros y, si hay alta densidad, termina en la capa 18. Los rangos son contiguos y cubren exactamente la profundidad oficial.

## Inspección visual reproducible

`api/test/perfil-litologico.visual.ts <directorio>` genera dos HTML/SVG y dos PDF sin base de datos: mínimo, 54 capas finas y PDF multipágina. En la auditoría se generaron en `%TEMP%/rsp06-evidencias`:

- mínimo: una página, capa de 0,6 m, huecos y un aporte azul;
- capas finas: cinco rangos canónicos; la primera sección 0–9 m contiene 18 capas de 0,5 m sin superposición de etiquetas;
- PDF multipágina: cinco páginas y 40.813 bytes;
- Chrome/Edge headless no rasterizaron el plugin PDF (captura oscura), por lo que la comprobación PDF adicional fue estructural: bytes válidos, páginas cargables por `pdf-lib`, una página por rango y generación integral sin excepción. Los HTML/SVG sí fueron rasterizados e inspeccionados.

La primera captura de capas finas reveló etiquetas superpuestas porque se dividía uniformemente por profundidad. Se cambió el algoritmo a límites por densidad real y una segunda captura confirmó capas y etiquetas separadas. Esto evita declarar una validación visual que solo fuese teórica.

## Seguridad conservada

No cambiaron cookies HttpOnly, CSRF, `version_sesion`, WebSocket ni contratos existentes. Se añadió únicamente una ruta GET. Tanto esa ruta como `informe-pdf` autentican y autorizan el pozo antes de ejecutar `getReportePozo`. Las escrituras litológicas mantienen `id_pozo` en SQL y ahora bloquean solapamientos de forma serializada por pozo.

## Validación final

- API: build correcto; 33/33 pruebas.
- Frontend: build correcto; 87/87 pruebas.
- `git diff --check`: correcto.
- Evidencias visuales reproducibles generadas; mínimo y capas finas inspeccionados.
- PDF mínimo y multipágina generados y validados estructuralmente.

Los avisos preexistentes de Ionic/Stencils (iconos, menú/modal, glob vacío y `baseline-browser-mapping`) no causan fallos y no pertenecen a esta etapa.

## Limitaciones reales

- `intervalo_litologico` solo contiene `desde_m`, `hasta_m` y `material`: no existe descripción geológica persistida. El contrato ya admite `descripcion: null` para incorporarla sin rediseñar el perfil cuando exista una fuente real.
- El diseño constructivo se persiste parcialmente en el pozo y en intervalos de diámetro, pero la especificación auditada no define cómo superponerlo al perfil litológico. No se mezcló ni se inventó una convención visual.
- No se añadió una migración de exclusión PostgreSQL. La API serializa escrituras con advisory lock y consulta de solapamiento; cargas realizadas fuera de la API deben respetar la misma regla.
- La rasterización automática del PDF no estuvo disponible en Chrome/Edge headless; queda documentada la validación estructural y el generador deja los PDF listos para apertura manual.

## Despliegue y rollback

Desplegar API y frontend juntos porque el componente web consume la nueva ruta. No hay migraciones ni dependencias nuevas. Para rollback, revertir los commits adicionales de la auditoría en orden inverso y volver a desplegar ambos artefactos.
