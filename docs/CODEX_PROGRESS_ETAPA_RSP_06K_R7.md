# RSP-06K-R7 — Restringir eliminación directa de sitios

- Regla: los perforadores no eliminan sitios standalone; administración conserva la acción.
- Backend: DELETE no administrador rechaza con 403 antes de cualquier operación destructiva y ya no usa la relación de gestión como permiso de borrado.
- Integridad: administración recibe 409 controlado si el sitio tiene pozos asociados; se preservan sitio, pozos y FK sin cascada.
- Frontend: `Borrar` solo se muestra a usuarios con rol `administracion`; edición, aislamiento y preview no cambian.
- Pruebas: cobertura focalizada de DELETE/FK y visibilidad de acción; suite API y frontend ejecutadas al cierre.
- Commits y HEAD: registrados al finalizar; árbol limpio.
