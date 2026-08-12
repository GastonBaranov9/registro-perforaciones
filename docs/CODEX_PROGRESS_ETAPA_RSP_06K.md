# ETAPA-RSP-06K — Datos técnicos estándar y ranura de filtro

- Defaults de creación: `Fue realizado el desarrollo con aire comprimido.`, `Es el espacio anular entre el tubo de protección sanitario y el revestimiento que fue cementado.`, `Rotativa.` y `Rotoneumatica.`. El backend los aplica solo si el campo se omite; conserva valores personalizados.
- UX: los cuatro campos se muestran precargados, legibles y `readonly`; cada botón `Editar` habilita únicamente su campo. En históricos se conserva el valor existente; un `NULL` no se completa ni migra automáticamente.
- Ranuras admitidas: `0.50`, `0.75` y `1.00` mm mediante selector. Son obligatorias para filtros nuevos; un filtro persistido con `NULL` muestra `No especificada` y puede conservarse o completarse.
- DB: migración `005_intervalo_filtro_ranura.sql`, columna `NUMERIC(4,2)` nullable y constraint de valores. Los 3 filtros históricos quedaron preservados (`3/3 NULL`). Migración incremental e instalación limpia temporal validadas; la base temporal fue eliminada.
- API: schemas, DTOs, creación/edición completa, endpoints legacy, consultas y lecturas incluyen `ranura_mm`; valores inválidos se rechazan antes de persistir y las operaciones siguen parametrizadas.
- Frontend: creación precargada, edición histórica sin sobrescritura, selector de ranura, detalle y borrador técnico actualizados.
- PDF: columna `Ranura` con `0.50 mm`, `0.75 mm`, `1 mm` o `No especificada`; gaps 20/7, fuente mínima de 9 pt, fit-to-page y continuación preservados.
- Validación: API build y suite `158/158`; frontend UTF-8, build y suite `167/167`; PDF pequeño/normal/cargado/texto largo/continuación; HTTP real defaults `201`, personalizado `200`, ranura `0.75`, faltante/`0.60` rechazados y histórico `NULL` compatible.
- Seguridad/limpieza: sin secretos `AIza` versionados, puerto 3000 libre, evidencia HTTP `0`, base temporal `0`, `git diff --check` correcto.
- Commits: `703db49 feat(api): definir datos tecnicos y ranuras de filtro`, `5a76d7f feat(front): precargar datos estandar y selector de ranura`, `d4739d9 feat(pdf): incluir ranura de filtros en informe`, `0c8cff1 test: cubrir datos estandar y ranuras de filtro` y este cierre documental.

HEAD de implementación validada: `0c8cff1084cfd2fc9fc792b2ee50c5f382291db3`. Antes del commit documental, `git status --short` estaba limpio; el HEAD final y el árbol limpio se informan en el reporte final.
