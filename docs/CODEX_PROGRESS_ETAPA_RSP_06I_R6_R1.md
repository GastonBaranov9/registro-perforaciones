# ETAPA-RSP-06I-R6-R1 — Corrección visual de espaciado PDF

## Causa raíz

R6 dejó de comparar directamente contra la baseline, pero todavía construía la caja del título con `font.heightAtSize(size, { descender: false })`. Para Helvetica-Bold, pdf-lib calcula ese valor con `Ascender=718`, mientras que la caja AFM completa de la misma fuente alcanza `FontBBox.top=962` y `FontBBox.bottom=-228`.

A 12 pt, el ascenso usado por R6 era 8,616 pt, pero la fuente puede ocupar hasta 11,544 pt sobre la baseline. Faltaban 2,928 pt por arriba. Además, `bordeInferiorFinal` apuntaba al centro del stroke de 0,3 pt de la última fila, no a su borde inferior visual; faltaban otros 0,15 pt.

En el peor caso conservador, los 10 pt informados por R6 garantizaban solamente `10 - 2,928 - 0,15 = 6,922 pt` entre el borde inferior visible y un glifo que alcanzara la caja completa. Por eso la diferencia de coordenadas no representaba 10 pt blancos reales. El gap posterior también se comparaba contra el tope geométrico de la fila, no contra el tope visual aproximado del texto del encabezado.

## Contrato visual final

`medirCajaVisualTexto` crea una caja conservadora a partir de las métricas públicas de pdf-lib:

- ascenso: máximo entre `heightAtSize(..., { descender:false })` y el tamaño de fuente;
- descenso: máximo entre el descenso calculado por pdf-lib y el 25 % del tamaño.

Con las fuentes fijas del informe, esta aproximación encierra las cajas AFM completas: Helvetica-Bold 962/-228 y Helvetica 931/-225. No confunde baseline con top o bottom visual.

`iniciarSeccionTecnica` aplica un único flujo:

1. bottom visual del bloque anterior;
2. 12 pt de gap visual previo;
3. top, baseline y bottom conservadores del título de 12 pt;
4. 7 pt de gap visual posterior;
5. top visual conservador del encabezado o de `Sin registros`.

La tabla deja el cursor después del borde inferior real, incluyendo medio grosor del stroke. `Sin registros` deja el cursor después de su descenso visual conservador. El encabezado se posiciona desde el top visual de sus glifos, aunque conserve padding y borde de fila.

## Fit-to-page

`medirTabla`, la reserva de sección y las comprobaciones de continuación incluyen:

- caja visual completa del título;
- gaps 12/7 pt;
- desplazamiento entre top visual y caja de encabezado;
- primera fila;
- medio stroke inferior.

La fuente mínima continúa en 9 pt. Si el espacio visual no cabe, se crea una continuación técnica; no se comprime el contenido por debajo del mínimo ni se permite que el borde salga del área útil.

## Evidencia manual exacta

Caso generado en memoria y guardable mediante `RSP06I_R6_R1_PDF_PATH`:

- Litología: `0–10 Sello sanitario`, `10–40 Tosca rosada`, `40–100 Arena arcillosa`.
- Tuberías: `0–10 8 pulg PVC`, `10–100 6 pulg PVC`.
- Filtros: `Sin registros`.
- Aporte: `70 m`.

Métricas en coordenadas PDF:

| Transición | Bottom visual anterior | Top visual título | Gap |
|---|---:|---:|---:|
| Litologías → Tuberías | 545,740 pt | 533,740 pt | 12,000 pt |
| Tuberías → Filtros | 454,090 pt | 442,090 pt | 12,000 pt |
| `Sin registros` → Aportes | 407,340 pt | 395,340 pt | 12,000 pt |

Los cuatro gaps título → contenido midieron 7,000 pt. Títulos: Helvetica-Bold 12 pt. Tablas y `Sin registros`: Helvetica/Helvetica-Bold 10,2 pt. Todos los bloques quedaron en la página 3 del documento, única página técnica del caso manual.

Chrome headless generó una captura completamente oscura del visor PDF. Esa salida no es una rasterización confiable de la página y no se declara inspección visual automatizada; la evidencia aceptable es la instrumentación métrica determinista sobre cajas visuales conservadoras.

## Pruebas

- Desarrollo focalizado: 16/16 pruebas de composición/R6/R6-R1.
- Caso pequeño y normal: una página técnica cuando cabe.
- Caso cargado: fuente nunca menor a 9 pt y bottoms dentro del área útil.
- Campos generales largos: continuación sin páginas vacías.
- Tabla extensa: continuación técnica sin clipping ni filas fuera del área útil.
- Caso manual: cajas visuales, baseline distinta de top/bottom, gaps 12/7, `Sin registros`, fuentes y páginas.
- Validación final API: build correcto y suite completa 143/143.
- Frontend no fue modificado y, conforme al alcance R1, no se repitieron sus suites.

## Archivos y commits

Archivos de producto/prueba modificados:

- `api/src/pdf/pdf-generate.ts`
- `api/test/rsp06i-r6-pdf.test.ts`
- `api/test/rsp06i-r6-r1-pdf.test.ts`

Commits:

- `79bd61b fix(pdf): corregir espaciado visual entre secciones tecnicas`
- `7019879 test(pdf): medir cajas visuales entre bloques`
- `docs: documentar correccion visual RSP-06I-R6-R1` contiene este cierre.

HEAD de implementación validada antes del commit documental: `7019879`. Tras el commit documental se verifican `git diff --check`, HEAD final y árbol limpio; el hash final se informa en el reporte de cierre.
