# ETAPA RSP-06F-D — Unificación visual del perfil

## Resultado

Edición, detalle y PDF consumen ahora el mismo sistema de coordenadas, las mismas posiciones de etiqueta y las mismas polilíneas de conexión. El tamaño físico cambia según el contenedor o A4, pero no la geometría relativa ni el orden semántico.

## Causa raíz y diferencias encontradas

El modelo anterior compartía profundidades y algunas fracciones constructivas, pero dejaba el lienzo a cada renderer:

| Elemento | Angular anterior | PDF anterior |
| --- | ---: | ---: |
| Lienzo | `760 × 820` | A4 sin transformación canónica |
| Columna | `x=90`, ancho `180`, alto `700` | `x=90`, ancho `120`, alto `650` |
| Carriles | `310 + carril × 60` | `225 + carril × 35` |
| Conector | una línea SVG | una línea pdf-lib recalculada |
| Responsive | `min-width: 620px` y scroll | no aplicable |

Por eso el mismo contrato producía proporciones, longitudes de guía y separación distintas. Vista previa y detalle sí usaban el mismo componente, pero este reconstruía coordenadas que el PDF interpretaba de otra manera.

## Sistema canónico

`GEOMETRIA_CANONICA_PERFIL` define:

- lienzo lógico `760 × 820`;
- columna `x=90`, `y=70`, ancho `180`, alto `700`;
- posición del texto de escala;
- carriles semánticos `310`, `390`, `470`, `550` para litología, tubería, filtro y aporte;
- separación vertical objetivo `0,055` del alto útil;
- salida y llegada de conectores;
- alto lógico de cajas de texto.

Cada etiqueta contiene texto, carril, anclaje geológico, posición desplazada, caja estimada y una polilínea normalizada de cuatro puntos. El conector sale horizontalmente del elemento, resuelve el desplazamiento y llega horizontalmente al texto. El anclaje no cambia aunque la etiqueta se desplace.

La paginación limita a doce capas por rango cuando existen muchas capas finas. Esto deja espacio para etiquetas constructivas y de agua sin ocultar información; los tramos que cruzan páginas se vuelven a representar con el mismo sistema.

## Transformación web

Angular toma `ancho_logico`, `alto_logico`, `columna`, etiquetas y conectores del modelo. El SVG usa el `viewBox` canónico y `width: 100%`, sin ancho mínimo ni recálculo basado en el contenedor. Edición y detalle montan el mismo `PerfilLitologicoComponent`; la vista previa únicamente cambia el origen del modelo (POST no persistente frente a GET persistido).

## Transformación PDF

`transformarPuntoCanonicoPdf` es la única transformación afín:

```text
x_pdf = 45 + x_normalizada × 505
y_pdf = 795 - y_normalizada × 750
```

La inversión vertical responde al origen inferior de pdf-lib. Columna, construcción, aporte, cajas implícitas y todos los segmentos de conectores pasan por esa transformación. El PDF ya no define otros carriles ni reconstruye una diagonal propia.

## Orden de capas

Se conserva en ambos medios:

1. fondo;
2. litología y límites;
3. tubería;
4. filtro ranurado;
5. contornos constructivos;
6. aporte de agua;
7. conectores;
8. textos y marcadores.

El aporte se dibuja después de la construcción y mantiene opacidad/patrón suficientes para que las ranuras sigan siendo interpretables.

## Pruebas

- API: 62/62.
- Frontend: 119/119 en Chrome.
- Builds API y frontend correctos.
- Determinismo: una misma entrada produce modelos idénticos.
- Se verifican lienzo, columna, cuatro carriles, cajas, cuatro puntos por conector y transformación de extremos `(0,0)`/`(1,1)`.
- Filtro y aporte coincidentes a 60 m conservan profundidad real, alturas de texto distintas y puntos de salida distintos.
- PDF genera una página por rango y conserva multipágina.
- Continúan verdes las pruebas de pie ausente, fechas legibles, PVC, Acero, filtro, aporte y tabla accesible.

## Evidencia reproducible

Ejecutar desde `api`:

```powershell
node --experimental-strip-types test/rsp06fd.visual.ts "$env:TEMP\rsp06fd-evidencias"
```

Produce:

- `edicion.html`;
- `detalle.html`;
- `perfil.pdf`;
- `perfil-multipagina.pdf`.

El caso usa Acero `0–10 m`, Acero `10–100 m`, filtro PVC `50–70 m`, aporte `60 m` y un límite litológico `59–61 m`. Edición y detalle se generaron desde el mismo modelo SHA-256 `507111e3b9432ffff2019fc233180667aa9dbdf8bf76e318ad80ee22e9c20f51`; la diferencia observada es exclusivamente el escalado del contenedor. El perfil multipágina produjo cuatro rangos.

La inspección de las capturas HTML confirmó proporciones y orden equivalentes, etiquetas completas y separación visible entre capa fina, filtro y aporte. Edge/Chrome headless no rasterizaron el PDF local y devolvieron una captura gris; el archivo PDF sí se generó correctamente y su equivalencia se comprobó mediante la transformación pura y las pruebas de estructura/paginación. No se presenta la captura gris como evidencia visual válida.

## Seguridad y alcance

No se tocaron autenticación, cookies HttpOnly, CSRF, `version_sesion`, autorización, SQL, archivos o rutas. No se añadieron dependencias, migraciones, `any`, `SELECT *`, Bearer ni JWT en almacenamiento. Tampoco se cambió la paleta litológica, portada, mapas, tablas generales o modelo PostgreSQL.

## Limitaciones

- Las cajas de texto usan una estimación determinista independiente de fuente; el PDF conserva su tamaño tipográfico existente.
- Ante una cantidad excepcional de etiquetas técnicas mayor que el espacio físico, la separación se reduce matemáticamente sin ocultarlas. La división a doce capas evita el caso habitual de saturación litológica.
- La inspección raster del PDF queda pendiente de un rasterizador PDF local; el navegador headless disponible no mostró el plugin PDF.

## Rollback

Revertir los commits de RSP-06F-D restaura los adaptadores anteriores. No hay migraciones, datos persistidos ni archivos de usuario que revertir.
