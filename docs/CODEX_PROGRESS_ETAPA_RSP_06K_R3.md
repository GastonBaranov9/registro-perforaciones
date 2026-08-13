# RSP-06K-R3 — Preview real de mapa con coordenadas pendientes

- Causa: el componente solo cambiaba `v`; el endpoint persistido ignoraba ese valor y usaba las coordenadas guardadas.
- Solución: endpoint autenticado `GET /usuarios/:id_usuario/sitios/:id_sitio/mapa-aereo/preview?latitud=...&longitud=...`.
- Seguridad: autorización sobre el sitio, normalización central de coordenadas, sin URL/host/clave enviados por el cliente, proveedor únicamente en backend.
- Caché: `Cache-Control: private, no-store`; se conserva la protección SSRF y validación de imagen existente.
- UX: edición usa el preview con el último par válido; coordenadas incompletas o inválidas no consultan Google. Cancelar restaura el par persistido y guardar conserva el mapa nuevo.
- Concurrencia: las respuestas de estado obsoletas se descartan y no se consulta configuración repetidamente al editar coordenadas.
- Pruebas: API focalizada 2/2, frontend focalizada 4/4, API completa 163/163, frontend completa 173/173; UTF-8 y builds correctos. Se verificó el contrato `no-store` y que no se filtra la clave.
- Prueba Google real: no se repitió; la integración real ya estaba validada en RSP-06J y esta etapa solo cambia el contrato protegido de preview.
- Commits: `c5a0a20` (`feat(api): agregar preview protegido de mapa`), `ebbf1b5` (`fix(front): mostrar preview con coordenadas pendientes`).
- HEAD final y estado Git: se verifican al cierre con `git rev-parse HEAD` y `git status`.
