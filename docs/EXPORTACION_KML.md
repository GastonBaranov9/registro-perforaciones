# Exportación de perforaciones a Google Earth

Administración puede usar **Exportar Google Earth (KML)** en la lista de pozos.
Descarga `perforaciones-raulsilva.kml` con todas las perforaciones que tienen
coordenadas y número comercial válidos, sin aplicar filtros de la lista. No sincroniza Google Earth.

## Auditoría de datos

La fuente es el esquema versionado y los servicios existentes; no se consultó
PostgreSQL real. Se revisaron las migraciones 000, 011, 012 y 017, la lectura de
pozos y el manejo de fechas/coordenadas.

| Dato | Fuente real | Faltantes |
| --- | --- | --- |
| Número | `pozo.numero_perforacion` | Nullable en registros antiguos; no se sustituye por `id_pozo` |
| Propietario | `usuario.nombre`, relacionado por `pozo.id_propietario`; alternativa registrada `pozo.propietario_provisional` | La relación y el nombre provisional pueden ser NULL en históricos |
| Fechas | `pozo.fecha_inicio`, `pozo.fecha_fin` (DATE) | Ambas pueden ser NULL; se muestran separadas, sin usar `fecha_creado` como fecha de perforación |
| Profundidad final | `pozo.profundidad_final_m` (NUMERIC, metros) | Puede ser NULL |
| Caudal | `pozo.caudal_estimado_lh` (INTEGER, litros/hora) | Puede ser NULL; se identifica como **estimado**, no hay otro campo de caudal final |
| Departamento/localidad | `sitio.departamento`, `sitio.localidad`, por `pozo.id_sitio` | Localidad nullable; departamento NOT NULL en sitio, pero puede faltar el sitio en históricos o ser texto vacío |
| Coordenadas | `sitio.latitud`, `sitio.longitud` (VARCHAR) | Ambas pueden ser NULL; puede faltar la relación con sitio |

## Contrato

`GET /pozos/exportar/kml` exige sesión vigente y rol `administracion` mediante
los hooks existentes. En el portal se accede mediante `/api/pozos/exportar/kml`.
Propietario y perforador sin rol administrativo reciben 403; sin sesión, 401.

Respuesta 200:

- `Content-Type: application/vnd.google-earth.kml+xml`
- `Content-Disposition: attachment; filename="perforaciones-raulsilva.kml"`
- `Cache-Control: no-store`
- `X-KML-Exportadas`: cantidad de puntos incluidos.
- `X-KML-Omitidas`: total de perforaciones sin coordenadas o número comercial válidos.

El portal consume `/api/` same-origin y puede leer estos headers sin exponerlos
por CORS. El plugin CORS conserva su configuración anterior al KML; no agrega
orígenes ni wildcard. La UI muestra las cantidades disponibles; nunca supone cero si
un header no llegó. La descarga del navegador usa Blob y un enlace con `download`.

Cada solicitud hace un SELECT con LEFT JOIN a usuario y sitio. Incluye registros
normales e históricos y cuenta cada perforación una sola vez. No escribe datos,
no altera numeración, no requiere migraciones ni crea archivos en el servidor.

## Reglas del documento

- KML 2.2, UTF-8, un Document con Folder por departamento y un Placemark por pozo.
- Sin departamento registrado: carpeta `Sin departamento`.
- Nombre `P-<numero_perforacion>`, únicamente con número comercial entero entre
  1 y 2147483647, según el contrato existente. Si falta o es inválido, se omite
  la perforación; no se convierte texto ni se sustituye por el ID interno.
- Internamente se separan `omitidasPorCoordenadas` y `omitidasPorNumero`.
  Son razones excluyentes: si ambas fallan, se cuenta por coordenadas. Su suma
  es `X-KML-Omitidas`, sin duplicar perforaciones ni agregar headers públicos.
- Descripción con número, propietario, ambas fechas, departamento, localidad,
  profundidad, caudal estimado y coordenadas. Datos ausentes: `No registrado`
  o `No especificada` para fechas. Cero registrado se conserva.
- Coordenadas decimales finitas, latitud en [-90, 90] y longitud en [-180, 180],
  límites incluidos. Admite signo y espacios externos. Rechaza NULL, vacíos,
  texto parcial, coma decimal, DMS, notación exponencial y hexadecimal.
  El registro general admite DMS, pero esta exportación aplica la exclusión de
  coordenadas no numéricas solicitada; no convierte ese texto automáticamente.
- Point usa `longitud,latitud,0`. No se inventa una altitud medida.
- Los textos se escapan para XML. Los valores de descripción se escapan también
  para HTML, para que Earth muestre los datos sin interpretarlos como etiquetas.
  Caracteres prohibidos en XML 1.0 se reemplazan por U+FFFD.
- Un resultado sin puntos sigue siendo un KML válido con contadores cero o con
  la cantidad real de omitidas. No incluye Network Links ni recursos externos.

## Validación aislada

Desde `api`:

```powershell
node --test --experimental-strip-types test/exportar-kml.test.ts test/native-auth-security.test.ts
npm.cmd run build
```

Desde `front`:

```powershell
npm.cmd test -- --watch=false --browsers=ChromeHeadless --include="src/app/shared/services/exportar-kml.service.spec.ts" --include="src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts"
npm.cmd run build
```

Las pruebas API usan el parser XML `@xmldom/xmldom` (dependencia de desarrollo),
Fastify con autenticación real y consultas simuladas que impiden conectar a la DB.
No comprueban datos reales ni importan el archivo en una instalación de Google Earth.
El documento se genera en memoria; el consumo crece con el total de registros.
La descarga implementada corresponde al navegador web; no agrega integración
con Filesystem/Share de la aplicación nativa.
