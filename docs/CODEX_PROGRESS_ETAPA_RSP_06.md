# ETAPA RSP-06 — perfil litológico dinámico

## Resultado

El informe PDF incorpora una página final con un perfil litológico vertical generado dinámicamente a partir de los intervalos del pozo. La columna conserva proporción respecto de la profundidad representada, incluye escala métrica adaptativa y una referencia de intervalos con material y color.

La tabla litológica existente permanece en el informe como detalle completo. No se añadieron dependencias, rutas HTTP, tablas ni migraciones.

## Comportamiento

- La profundidad representada es el máximo entre `pozo.profundidad_final_m` y el mayor `hasta_m` válido. Así no se recortan intervalos aunque el dato general esté desactualizado.
- La escala usa pasos de 2, 5, 10, 25, 50 o 100 metros según la profundidad total.
- Cada tramo ocupa una altura proporcional a `hasta_m - desde_m`.
- Los huecos entre intervalos quedan visibles con fondo neutro; no se inventa material para completarlos.
- Los materiales reciben colores deterministas, insensibles a mayúsculas, espacios y tildes. Un mismo nombre mantiene su color entre informes.
- Los intervalos se ordenan para la representación sin mutar los datos del reporte.
- Los registros no finitos, negativos, vacíos o con `hasta_m <= desde_m` se excluyen defensivamente del gráfico. La tabla y las validaciones persistentes siguen siendo la fuente de detalle.
- Si no hay profundidad ni intervalos válidos, no se agrega una página vacía. Si existe profundidad pero no intervalos, se dibuja la escala y se informa la ausencia de registros.

## Seguridad y límites conservados

El endpoint continúa siendo `GET /usuarios/:id_usuario/pozos/:id_pozo/informe-pdf` y mantiene, antes de consultar el reporte o generar bytes, `authenticate`, `pozoIsFromUser` y `userIsPropietarioOrPerforadorOrAdmin`. El perfil consume exclusivamente `reporte.litologia`, obtenido por `id_pozo` después de esa autorización.

No se modificaron el aislamiento de propietarios, la identidad canónica de sesión, CSRF, roles, WebSocket, fotos ni los CRUD de intervalos. Tampoco se introdujo acceso directo a hijos ni se confió en el `id_usuario` de la URL.

## Archivos

- `api/src/pdf/perfil-litologico.ts`: normalización, escala, color, modelo y dibujo del perfil.
- `api/src/pdf/pdf-generate.ts`: integración del perfil como página final del informe.
- `api/test/perfil-litologico.test.ts`: pruebas unitarias y generación real de bytes PDF.

## Verificación

- API: build TypeScript correcto.
- API: 25/25 pruebas correctas con `node --test --experimental-strip-types test/*.test.ts`.
- Frontend: 84/84 pruebas correctas con ChromeHeadless.
- Frontend: build de producción correcto.
- `git diff --check`: correcto.

El build frontend conserva avisos preexistentes de Ionic/Stencils sobre iconos no registrados, un glob vacío y datos de `baseline-browser-mapping` antiguos; no provocan fallos ni pertenecen a esta etapa.

## Despliegue y rollback

Desplegar la API con las mismas variables y secretos actuales. El frontend no requiere cambios funcionales, pero su suite y build se verificaron para descartar regresiones. No hay pasos de base de datos ni datos que migrar.

Para revertir, aplicar `git revert` a los commits locales de RSP-06 en orden inverso y volver a desplegar la API. Los informes se generan bajo demanda, por lo que no hay artefactos persistentes que convertir o eliminar.

## Limitaciones

El perfil representa fielmente los datos recibidos; no corrige solapamientos históricos ni clasifica semánticamente materiales escritos con nombres distintos. Cuando la cantidad de intervalos excede el espacio de la referencia lateral, la tabla previa conserva el detalle completo. La validación de no superposición debe seguir garantizándose en la capa de intervalos y en PostgreSQL.
