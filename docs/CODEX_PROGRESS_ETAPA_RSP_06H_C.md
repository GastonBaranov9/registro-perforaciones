# ETAPA RSP-06H-C — Paleta y patrones litológicos definitivos

## Alcance y referencia

Se completó la representación visual de las 29 entradas iniciales del catálogo sin cambiar la geometría canónica 760x820, columnas, carriles, conectores, fotografías, mapa ni estructura general del informe. La referencia conceptual fue FGDC-STD-013-2006, sección 37 y sus apartados sedimentarios, metamórficos e ígneos, junto con la tradición cartográfica USGS. Los patrones implementados son propios del proyecto: no son símbolos FGDC oficiales y no incorporan EPS, PostScript, imágenes raster ni recursos externos.

## Arquitectura canónica

`recursos/litologia-patrones.ts` es el contrato compartido por API y Angular. Contiene las 12 claves permitidas y, para cada una, forma semántica, paso, tamaño, densidad y contraste. PostgreSQL continúa almacenando exclusivamente `color` y `patron`. `crearPerfilLitologico` conserva el color y la clave catalogada en el modelo canónico; el renderer web usa SVG `pattern` seguro y el renderer PDF usa primitivas vectoriales equivalentes. El PDF aplica clipping al rectángulo de cada intervalo antes de dibujar la trama.

Las entradas históricas inactivas siguen usando su color y patrón del catálogo. Un intervalo sin FK conserva el fallback determinista anterior y no se vincula por coincidencia aproximada.

## Paleta final

Todos los valores son `#RRGGBB` en mayúsculas y son sobrios, minerales y aptos para pantalla/PDF:

| Orden | Litología | Color | Patrón |
|---:|---|---|---|
| 1 | Basalto marrón | `#795548` | basalt |
| 2 | Basalto marrón-rojizo | `#70423A` | basalt |
| 3 | Basalto gris oscuro | `#42464B` | basalt |
| 4 | Basalto negro | `#202124` | basalt |
| 5 | Basalto fracturado | `#555B61` | basalt_fractured |
| 6 | Suelo orgánico | `#4E342E` | organic |
| 7 | Arenisca rosada | `#C98783` | sandstone_medium |
| 8 | Arenisca rojiza | `#A65345` | sandstone_medium |
| 9 | Arenisca blanca | `#E7DDC7` | sandstone_medium |
| 10 | Arenisca fina | `#D7B77A` | sandstone_fine |
| 11 | Arenisca media | `#C9A467` | sandstone_medium |
| 12 | Arenisca gruesa | `#B58B50` | sandstone_coarse |
| 13 | Arcilla roja | `#9E463D` | clay |
| 14 | Arcilla marrón | `#795548` | clay |
| 15 | Arcilla gris | `#777B7E` | clay |
| 16 | Arena arcillosa | `#B89062` | sandy_clay |
| 17 | Arcilla negra | `#292929` | clay |
| 18 | Arcilla rosada | `#C47F7B` | clay |
| 19 | Tosca rosada | `#D29A91` | tosca |
| 20 | Tosca blanca | `#E8E0D0` | tosca |
| 21 | Tosca amarilla | `#D1AF58` | tosca |
| 22 | Tosca marrón | `#846044` | tosca |
| 23 | Tosca rojiza | `#A95747` | tosca |
| 24 | Tosca compacta | `#8C7A62` | tosca |
| 25 | Gravilla fina | `#777D7C` | gravel_fine |
| 26 | Gravilla gruesa | `#756657` | gravel_coarse |
| 27 | Granito rosado | `#C58D8A` | granite |
| 28 | Granito blanco | `#DDDAD0` | granite |
| 29 | Granito gris | `#85898C` | granite |

No hay verde en ninguna litología rosada ni en Tosca rosada; no se usa negro absoluto ni blanco puro.

## Patrones propios

- `basalt`: matriz compacta con marcas angulares moderadas.
- `basalt_fractured`: marcas angulares más fracturas diagonales superpuestas.
- `organic`: trazos irregulares y puntos.
- `sandstone_fine`, `sandstone_medium`, `sandstone_coarse`: granos progresivamente mayores y más separados.
- `clay`: laminación horizontal continua.
- `sandy_clay`: laminación más granos finos dispersos.
- `tosca`: matriz compacta con nódulos.
- `gravel_fine`, `gravel_coarse`: cantos redondeados con escalas distintas.
- `granite`: cruces y ángulos minerales cristalinos.

## Representación

Detalle web, editor, vista previa y perfil reutilizan `PerfilLitologicoComponent`. Cada instancia recibe un prefijo de IDs para evitar colisiones entre perfiles. La administración conserva su diseño y ahora muestra una muestra SVG real del patrón y el nombre de la clave mientras se cambian color o patrón. El PDF dibuja las mismas formas semánticas con líneas, círculos, elipses y cruces; la leyenda compacta de la primera página enumera solo las litologías presentes.

Las etiquetas y la tabla accesible existente se mantienen. La leyenda usa nombre textual además de muestra gráfica; color y patrón no son la única información disponible.

## Rendimiento y seguridad

Los patrones son tiles repetibles. El PDF limita el dibujo al intervalo y la cantidad de primitivas depende del tamaño del tile, no de los píxeles. No se usa `innerHTML`, SVG proporcionado por usuarios ni consulta adicional por intervalo.

## Pruebas y evidencia

La prueba parametrizada de `api/test/catalogo-litologias.test.ts` recorre las 29 seeds, valida colores, patrones permitidos, ausencia de verde en nombres rosados, las 12 especificaciones y la disponibilidad PDF de cada clave. También se conservaron las pruebas del modelo canónico, históricos, fallback, PDF multipágina y vista previa.

La evidencia estructural reproducible se obtiene con `api/test/perfil-litologico.visual.ts` y los scripts visuales existentes. La pasada de esta etapa verifica por código el modelo catalogado, el clipping PDF, el conteo de páginas y la presencia de primitivas vectoriales. No se declara una inspección raster adicional del PDF cuando el rasterizador no está disponible de forma confiable.

## Validación integral

Se ejecutan al cierre: build API, suite API, build y suite frontend, `npm run check:utf8`, prueba focalizada de las 29 litologías, prueba PostgreSQL local controlada reversible, generación perfil/vista previa/PDF y `git diff --check`. No se realizan push, merge, rebase, reset, clean, despliegue ni cambio de rama.

## Riesgos residuales y rollback

El fallback libre sigue siendo necesario para intervalos históricos sin FK; no se puede inferir automáticamente una litología catalogada sin cambiar su semántica. La representación PDF depende de las primitivas de `pdf-lib`, aunque no de rasterización. Si se requiere rollback, se revierten únicamente los commits de esta etapa y se conserva la migración 003 y el catálogo de 06H-A/B; no hay migración nueva ni modificación destructiva de datos.
