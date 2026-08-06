# ETAPA RSP-06F — Ajustes visuales de PDF y perfil

## Alcance corregido

- Se eliminó del generador PDF el pie agregado a todas las páginas, incluido el texto “Generado el…”, fecha y numeración inferior.
- Las etiquetas litológicas conservan sus carriles y las etiquetas de filtros usan tres carriles constructivos independientes, calculados de forma determinista después de ordenar los intervalos por profundidad. En web se amplió el lienzo técnico para reservar esa zona; en PDF se separaron horizontalmente las etiquetas de filtros y aportes.
- El filtro conserva el color de su material y añade una superposición de ranuras cortas deterministas en ambos lados del tramo. El texto y la leyenda lo identifican como “Filtro ranurado”.
- Acero permanece gris y tramado. PVC cambia a celeste oscuro (`#429bc1` en web y su equivalente RGB en PDF). Los históricos sin material mantienen un gris neutro y no se presentan como PVC.
- Los aportes pasan de 8 a 12 unidades mínimas de espesor, ocupan un rango horizontal ligeramente mayor, usan azul más intenso, ondas más gruesas y un marcador mayor. Se dibujan después de litología, tubería, filtro y contornos para conservar prioridad visual.
- No se modificó la paleta litológica ni su selección determinista.

## Fuente visual compartida

`crearPerfilLitologico` continúa siendo la fuente canónica para rangos, geometría constructiva, carriles y geometría de aportes. Angular consume esas propiedades para el SVG y `pdf-lib` para la salida impresa. La diferencia entre web y PDF se limita a coordenadas propias de cada soporte, manteniendo orden de capas, materiales, ranuras y prioridad semántica.

## Archivos

- `api/src/pdf/pdf-generate.ts`: eliminación completa del pie global.
- `api/src/pdf/perfil-litologico.ts`: geometría de aportes, colores constructivos, ranuras, orden de capas y carriles de filtros.
- `front/src/app/shared/types/schemas.ts`: contrato visual actualizado.
- `front/src/app/shared/components/perfil-litologico/*`: SVG, estilos, ranuras, colores, etiquetas y prioridad visual.
- `api/test/pdf-portada.test.ts`, `api/test/perfil-litologico.test.ts` y el spec Angular del perfil: regresiones del pie y del modelo visual.

## Validación

- El test PDF inspecciona la salida sin object streams y verifica que no exista “Generado el” ni su representación hexadecimal.
- Las pruebas del modelo verifican el mayor espesor del aporte y los carriles constructivos.
- El spec Angular comprueba material PVC, ranurado explícito, etiqueta y que la banda de aporte quede después del filtro en el orden SVG.
- Build y suite completa de API y frontend ejecutados al cierre.

## Limitaciones y siguientes etapas

La paleta final de suelos permanece deliberadamente fuera de RSP-06F. Tampoco se alteraron datos, migraciones, contratos persistentes, portada, autenticación, autorización ni rutas. El rollback consiste en revertir los commits de esta etapa; no requiere cambios PostgreSQL.
