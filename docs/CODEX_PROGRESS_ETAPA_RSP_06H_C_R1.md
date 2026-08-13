# ETAPA RSP-06H-C-R1 — Correcciones de review

## Estado

Se corrigieron exclusivamente los tres hallazgos del review de RSP-06H-C sobre `feature/catalogo-paleta-litologias`. No se reescribieron commits previos ni se modificaron geometría, paleta, administración general, mapas, fotografías o migraciones.

## 1. Contrato de patrones y Docker

La causa era que API y frontend importaban `recursos/litologia-patrones.ts`, fuera de ambos contextos Docker (`./api` y `./front`). Además, el import externo ampliaba el root inferido por TypeScript y podía producir un entry point adicional bajo `dist/api/src/server.js`.

Ahora cada paquete contiene su módulo package-local:

- API: `api/src/pdf/litologia-patrones.ts`.
- Web: `front/src/app/shared/canonical/litologia-patrones.ts`.

Ambos archivos conservan exactamente las mismas 12 claves y especificaciones. `api/test/catalogo-litologias.test.ts` compara sus contenidos normalizados byte a byte para impedir divergencias accidentales. Los renderers siguen consumiendo la misma semántica de forma, paso, tamaño, densidad y contraste; no hay acceso runtime a la raíz del repositorio.

Después de eliminar únicamente `api/dist` y `front/dist`, el API vuelve a emitir solo `api/dist/server.js`, compatible con `npm start`. El frontend emite `front/dist/front`. El build Docker con `DOCKER_USER=local` terminó correctamente para `local/api` y `local/front` usando sus contextos aislados.

## 2. Compatibilidad legacy

En creación completa, un `id_litologia` explícito continúa requiriendo una fila existente y activa; IDs inexistentes o inactivos siguen devolviendo 400 y provocan rollback. Si el ID se omite o es NULL, el INSERT puede conservar el material textual y dejar `id_litologia NULL` cuando no hay coincidencia exacta segura. No se aproxima ni se sustituye el texto.

Se añadió una prueba focalizada que verifica material con espacios/tabulación, FK NULL y COMMIT. Las reglas de edición histórica de RSP-06H-B-R1 no fueron modificadas.

## 3. Leyenda PDF

La leyenda ahora se construye desde `obtenerEntradasLeyendaLitologica`, deduplicando cada litología catalogada por ID y cada fallback sin FK por material. Por tanto, históricos inactivos y materiales NULL/fallback también tienen representación.

La página del perfil reserva como máximo seis entradas compactas en dos filas, dentro del área inferior útil. El resto se dibuja en páginas adicionales tituladas `Leyenda litológica (continuación)`, con 24 entradas por página en tres columnas y ocho filas. Las coordenadas de continuación permanecen dentro de la página y cada entrada conserva muestra de color y patrón. No se altera la geometría del perfil ni se superponen tuberías, filtros o agua.

La prueba focalizada cubre 1, 9, 10, 15 y 29 litologías, verificando cantidad lógica y paginación esperada.

## Pruebas focalizadas

- API build limpio: correcto.
- API catálogo, paridad, leyenda y creación completa: 18/18.
- Frontend build: correcto.
- Entry point: `api/dist/server.js`; `node --check` correcto. El arranque con `.env` alcanzó `listen`; el puerto 3000 ya estaba ocupado por un proceso existente.
- Docker API/frontend desde contextos separados: correcto con etiqueta local.

## Riesgos residuales

Los módulos package-locales son copias verificadas, no un paquete npm independiente; la prueba byte a byte debe mantenerse dentro de la suite API. El build Docker requiere que el entorno defina `DOCKER_USER` para producir etiquetas válidas. La rasterización visual del PDF no se declara si el rasterizador no está disponible de forma confiable; la evidencia estructural usa el modelo y el conteo de páginas.

## Rollback

El rollback es local y reversible mediante los commits de RSP-06H-C-R1. No hay migraciones nuevas ni cambios destructivos de datos. No se ejecutaron push, merge, rebase, reset, clean, despliegue ni cambio de rama.
