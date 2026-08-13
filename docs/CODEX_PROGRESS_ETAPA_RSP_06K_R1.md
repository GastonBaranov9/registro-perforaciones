# ETAPA RSP-06K-R1

- Regla: `Sello sanitario` y `Pre-filtro` se retiraron del flujo operativo moderno; se representan mediante intervalos litológicos definidos manualmente.
- Frontend: eliminados de creación, edición, listado, filtros y detalle. Los DTO modernos no los administran ni serializan.
- Compatibilidad: las columnas PostgreSQL y los contratos legacy se conservan. No hubo migración. El `UPDATE` completo moderno omite ambas columnas y preserva los valores históricos.
- Intervalos: no se agregó inferencia ni alta automática; `Sello sanitario` continúa siendo seleccionable como litología de catálogo.
- PDF: eliminados de Datos generales; los intervalos y el perfil litológico continúan mostrándolos. Gaps 20/7, tipografía mínima y layout permanecen sin cambios.
- Pruebas focalizadas: API 27/27; frontend 22/22.
- Validación final: API build + 158/158; frontend UTF-8 + build + 171/171; HTTP real 201/200; preservación histórica, PDF real y limpieza temporal confirmados; `git diff --check` correcto.
- Commits: `ee456c0`, `d09355e`, `03fe2c5`, `b3da040`; cierre documental en el commit siguiente.
- HEAD de implementación: `b3da040b60b37d0bd14970206af8ab3a457916a2`.
- Git status antes del cierre documental: limpio.
