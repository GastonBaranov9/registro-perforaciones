# ETAPA RSP-06G — Rediseño integral del PDF

## Resultado

El informe dejó de componerse como una secuencia de coordenadas y saltos aislados. La portada, ubicación, datos generales, tablas y perfil tienen responsabilidades separadas y el contenido técnico utiliza un flujo determinista que mide filas y texto antes de dibujar.

## Causa raíz del diseño anterior

- La primera página acumulaba fotografía, ubicación, personas, fechas y características técnicas.
- Cada tabla decidía por separado cuándo crear página y no repetía consistentemente su encabezado.
- Los saltos preventivos y decrementos manuales de `y` generaban espacios grandes, títulos huérfanos y páginas casi vacías.
- La tipografía normal era de 10 pt y varios textos secundarios de 7,5 pt.
- `sitio` concatenaba departamento y localidad; la consulta no entregaba coordenadas ni ambos campos por separado.

## Arquitectura de composición

`FlujoPDF` en `api/src/pdf/pdf-generate.ts` no crea páginas en su constructor. `pagina`, `reservar`, `titulo`, `campo`, `texto` y `tabla` crean contenido solo cuando existe un bloque real. Las tablas miden el alto de cada fila, envuelven texto, mantienen título/encabezado con una fila y repiten el encabezado tras un salto. `crearPDFConDiagnostico` expone metadatos estructurales para verificar páginas sin contenido y títulos huérfanos sin analizar bytes.

## Portada y página 2

- Página 1: identidad sobria, título de 28 pt, número de pozo, fotografía protagonista y propietario/empresa. La imagen usa `contain`, preserva la relación de aspecto y no se recorta. Sin foto se utiliza una composición alternativa, sin caja simulada vacía.
- Página 2: departamento, localidad y coordenadas separadas; mapa o fallback compacto; perforador, fechas y profundidad. Los `DATE` siguen usando `DD/MM/YYYY` sin conversión de zona.
- No existe un nombre de sitio independiente en PostgreSQL: `sitio` era una concatenación de departamento/localidad. No se inventó un tercer dato.

## Coordenadas y mapa

`sitio.latitud` y `sitio.longitud` son `VARCHAR`; el formulario las origina desde `Geolocation.coords.latitude/longitude`. El adaptador valida números finitos y rangos WGS84 (-90..90 y -180..180), sin intercambiarlos.

El repositorio no tenía proveedor, biblioteca, clave ni configuración de mapas. No se eligió uno. `api/src/pdf/mapa-estatico.ts` deja preparada una integración opcional y segura:

- URL construida solo desde configuración de servidor y coordenadas validadas;
- HTTPS y coincidencia exacta de host;
- sin credenciales en la URL base ni host aportado por el cliente;
- redirecciones deshabilitadas;
- timeout de 3 s;
- máximo 2 MB;
- solo PNG/JPEG;
- atribución obligatoria;
- fallo, ausencia o respuesta inválida producen “Mapa no disponible” sin abortar el PDF.

Variables: `PDF_MAP_STATIC_URL_TEMPLATE`, `PDF_MAP_ALLOWED_HOST`, `PDF_MAP_STATIC_API_KEY` y `PDF_MAP_ATTRIBUTION`. Hasta que se seleccione contractualmente un proveedor, deben permanecer vacías.

## Tipografía, datos y tablas

- Título: 28 pt; página: 20 pt; sección: 17–18 pt; texto: 12 pt; secundario: 10,5–11,5 pt; tablas: 11 pt.
- Booleanos: `Sí`, `No`, `No especificado`.
- Unidades: `m`, `pulg`, `l/h`.
- Tablas: litología (Desde/Hasta/Material), tuberías y filtros (Desde/Hasta/Diámetro/Material), aportes según su profundidad real.
- Las secciones vacías ocupan una línea “Sin registros”.
- La consulta agrega columnas explícitas de ubicación y datos constructivos; no se añadió `SELECT *` ni SQL interpolado.

## Perfil y fotografía

El perfil conserva el modelo geométrico canónico, el orden de capas, segmentación multipágina, litología, tuberías, filtros, aportes, etiquetas y conectores. Comienza en páginas propias y no se comprime para rellenar otra sección. No se cambió la paleta litológica.

La fotografía continúa leyéndose desde almacenamiento protegido con nombre derivado de `id_pozo`, firma PNG/JPEG y límite de 5 MB. Una referencia ausente o eliminada genera la portada alternativa.

## Pruebas y evidencia

- API build correcto; 66/66 pruebas correctas.
- Frontend build correcto; 119/119 pruebas correctas.
- Casos reproducibles en `api/test/rsp06g.visual.ts`: sin foto, foto horizontal, foto vertical, tablas extensas y perfil multipágina.
- Pruebas de composición: páginas con bloques reales, ausencia de título huérfano, tabla extensa, coordenadas válidas/inválidas, host, redirección, tipo y tamaño del mapa.
- `git diff --check` correcto.

Se generaron PDF en `%TEMP%/rsp06g-evidencias`. Edge headless no rasterizó el visor PDF y produjo lienzos grises; por ello no se declara inspección visual de esas capturas. La evidencia válida es la generación reproducible, las imágenes embebidas detectadas por `pdf-lib`, los recuentos de página y los diagnósticos de composición. Esta es una limitación del entorno de inspección, no de la generación.

## Seguridad y regresiones

No se modificaron autenticación, cookies HttpOnly, CSRF, `version_sesion`, `request.user.sub`, autorización, aislamiento, rutas de informe ni almacenamiento. La autorización continúa ejecutándose antes de solicitar los bytes. No se añadieron dependencias, migraciones, Bearer, JWT en almacenamiento, secretos, URLs de cliente, `any` ni `SELECT *`.

## Despliegue y rollback

No requiere migración ni dependencia. Desplegar API normalmente. El mapa seguirá en fallback mientras no se configuren las cuatro variables. Para rollback, revertir los commits de RSP-06G en orden inverso; el contrato HTTP del PDF permanece igual.

## Limitaciones reales

- La elección de proveedor de mapas y sus términos/coste sigue siendo una decisión pendiente del usuario; no existe configuración actual.
- No se pudo hacer inspección raster visual fiable en este host.
- La paleta empresarial de litologías queda expresamente para RSP-06H.
