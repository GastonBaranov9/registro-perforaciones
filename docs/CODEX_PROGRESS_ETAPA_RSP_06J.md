# ETAPA-RSP-06J — Google Maps y coordenadas históricas

## Implementación

- Google Maps Static API se consume solo desde el backend mediante endpoint autenticado y PDF.
- Plantilla: `https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&scale=2&maptype=satellite&markers=color:red%7C{latitud},{longitud}&key={apiKey}`.
- Variables: `MAP_STATIC_URL_TEMPLATE`, `MAP_STATIC_ALLOWED_HOST`, `MAP_STATIC_API_KEY`, `MAP_STATIC_ATTRIBUTION`; `PDF_MAP_*` permanece como fallback.
- Se conservan HTTPS, host exacto, redirect manual, timeout, máximo incremental, MIME/firma PNG/JPEG y protección SSRF.
- El frontend usa únicamente la URL protegida de la API; la clave y la URL Google no llegan al bundle ni a respuestas.
- El PDF dibuja la imagen completa con proporción preservada. No existe overlay sobre la atribución incorporada; `Google Maps` adicional se ubica fuera de la imagen.
- La imagen se reutiliza cinco minutos entre endpoint y PDF para evitar consumo repetido.

## Coordenadas y UX

- Se aceptan decimal y DMS por campo con comillas rectas/variantes de espacios.
- Caso histórico: `31°26'38.1"S`, `57°59'11.6"W` → `-31.4439167`, `-57.9865556`.
- N/S/E/W definen signo; cualquier signo explícito en DMS se rechaza para evitar contradicciones.
- Crear/editar sitio y crear pozo admiten pegado manual, normalizan al perder foco y mantienen geolocalización.
- Auditoría de datos: 13 sitios; 12 coordenadas válidas, 1 sin coordenadas, 0 inválidas. No se requirió migración.

## Seguridad y validación

- `.env` ignorado; sin patrón `AIza` versionado; clave y host Google ausentes del bundle Angular.
- Producción debe usar clave distinta de DEV, restringida a Maps Static API y, con IP pública estable, también por IP. URL signing queda como endurecimiento posterior.
- API: build y suite `152/152`. Frontend: UTF-8, build y suite `163/163`.
- Dedicados RSP-06J: API/PDF/DMS `9/9`; frontend DMS/formulario/mapa `15/15`.
- HTTP real controlado: decimal 201, DMS 200, lectura normalizada, mapa 200 y PDF 200/4 páginas; clave redactada. Datos temporales eliminados.
- Compose development/production: `config --quiet` correcto. `git diff --check` correcto.

## Commits

- `79f4cc4 feat(api): integrar Google Maps Static`
- `d6b89c0 feat: aceptar coordenadas historicas DMS`
- `c83a9e1 fix(pdf): preservar atribucion de Google Maps`
- `859b6d2 feat(front): mostrar imagen aerea protegida`
- `7e3ec63 test: cubrir mapas y coordenadas historicas`
- `13f491c fix(api): tipar MIME validado del mapa`
- El commit documental de este archivo cierra RSP-06J.

HEAD de implementación validada: `13f491ccf8233348d6a874a660efe5833cabfe6d`. Tras el commit documental, HEAD final se informa en el reporte y `git status` queda limpio.
