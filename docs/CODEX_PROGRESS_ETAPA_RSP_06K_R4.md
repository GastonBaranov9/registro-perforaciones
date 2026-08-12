# RSP-06K-R4 — Aislamiento de sitios y búsqueda de propietarios

- Causa: el listado de sitios usaba `getAllSitios()` para perforadores, aunque las rutas individuales ya exigían relación con un pozo gestionable.
- Regla: administración conserva el listado global; propietario conserva sus sitios; perforador recibe solo sitios con `pozo.id_perforador` propio.
- Implementación: consulta SQL parametrizada con `EXISTS`, sin `SELECT *`; las verificaciones GET/PUT/DELETE permanecen como segunda barrera.
- Propietarios: el selector remoto acepta consultas desde un carácter. Vacío y whitespace no disparan búsqueda de propietarios; se mantienen debounce, respuestas obsoletas y máximo 20 resultados.
- Compatibilidad: no cambia la creación de propietarios operativos ni la selección de perforadores.
- Pruebas focalizadas: API 5/5 y selector Angular 6/6.
- Validación final: API build/suite y frontend UTF-8/build/suite ejecutados al cierre.
- Commits: `a2aacd9` (API/aislamiento), `a5085a7` (frontend/búsqueda), `c82a88f` (documentación).
- HEAD y estado Git: `c82a88f`; árbol limpio al finalizar.
