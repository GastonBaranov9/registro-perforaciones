# Progreso ETAPA-RSP-06I-R4 — integridad PDF, mapas y coordenadas

## Hallazgos corregidos

1. Las actualizaciones completas rechazan antes de abrir transacción cualquier `id_intervalo_litologico` persistido repetido. IDs distintos y entradas nuevas sin ID siguen permitidos; la preservación histórica legítima no cambia.
2. Los campos generales extensos del PDF se dibujan por fragmentos, reservando espacio y creando páginas `tecnica-continuacion` cuando corresponde. Las tablas posteriores conservan su paginación y fuente mínima de 9 pt.
3. `docker-compose.production.yaml` reenvía al API las familias `MAP_STATIC_*` y `PDF_MAP_*`, sin hardcodear secretos.
4. Las coordenadas se centralizaron en `normalizarCoordenadasTexto`: se recortan, se validan como números finitos dentro de rango y se persisten normalizadas. El cero explícito sigue siendo válido. La misma regla se usa en creación atómica, CRUD standalone administrativo y lectura de mapas.

## Configuración de mapas

Los nombres canónicos son `MAP_STATIC_URL_TEMPLATE`, `MAP_STATIC_ALLOWED_HOST`, `MAP_STATIC_API_KEY` y `MAP_STATIC_ATTRIBUTION`. Los nombres `PDF_MAP_*` son fallback compatible. Un valor canónico no vacío tiene prioridad; si está vacío o ausente se usa el valor legacy equivalente. La API key solo se reenvía al backend.

## Pruebas

- Focales RSP-06I-R4: duplicados, coordenadas, configuración legacy/canónica y campos PDF extensos.
- HTTP real `api/test/rsp06i-r4-http.local.ts`: whitespace 400 sin sitio, cero explícito 201 y persistido normalizado, duplicado 400 sin actualización parcial.
- Suite final API: 132/132.
- Suite final frontend: 148/148.
- Evidencia PDF: continuación de campos generales, tablas presentes y fuentes técnicas nunca menores a 9 pt.
- Compose: configuración de producción comprobada con variables dummy controladas; no se imprimieron valores secretos.

## Commits

La configuración Compose de producción se renderizó con variables dummy controladas y el build de imagen API terminó correctamente.
