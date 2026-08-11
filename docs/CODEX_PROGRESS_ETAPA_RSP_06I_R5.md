# ETAPA-RSP-06I-R5 — Compatibilidad SQL y litología histórica

## Causa

El PUT legado de pozo conservaba 18 valores después de hacer inmutable `id_sitio`, mientras la sentencia dejó de consumir `$3` y continuaba en `$4`. PostgreSQL rechazaba la preparación por el parámetro sin tipo.

Además, los updates completos compatibles permiten omitir `id_intervalo_litologico`. La resolución anterior interpretaba esa omisión como intervalo nuevo y podía perder `id_litologia` al reemplazar los hijos.

## Corrección

- `updatePozo` renumera los placeholders editables de `$3` a `$17`, elimina `data.id_sitio` de `vals` y mantiene `id_sitio = id_sitio`.
- El update completo bloquea y lee explícitamente `id_intervalo_litologico`, profundidades, material e `id_litologia` antes de borrar hijos.
- Un intervalo compatible sin ambos IDs se asocia al original únicamente cuando coincide exactamente en `desde_m`, `hasta_m` y material normalizado (trim, espacios agrupados y comparación sin diacríticos).
- Cada original se consume como máximo una vez. Una coincidencia ambigua o una reutilización se rechaza con 400 antes de los `DELETE`; la transacción mantiene rollback ante errores posteriores.
- Los IDs persistidos enviados explícitamente continúan sujetos a la validación de duplicados de RSP-06I-R4. Los intervalos nuevos sin ID siguen las reglas actuales.

## Contratos

Los payloads modernos pueden identificar el intervalo mediante `id_intervalo_litologico`; los compatibles pueden omitirlo. Un `id_litologia` explícito conserva prioridad según las reglas vigentes. La preservación histórica solo se aplica cuando la identidad se puede demostrar de forma inequívoca.

## Pruebas

- Prueba focalizada RSP-06I-R5: 7/7.
- Prueba HTTP/PostgreSQL real: PUT legado 200, sitio inmutable, update compatible 200 y asociación `id_litologia` conservada.
- Se verificó limpieza de los registros temporales mediante `finally`.
- Suite API completa: 139/139; suite frontend completa: 148/148; `check:utf8`, builds y `git diff --check` correctos.

## Commits

Commits:

- `feaa716 fix(api): corregir compatibilidad de actualizaciones`
- `1ee1150 test: cubrir compatibilidad SQL y litologica`
- `b121286 docs: cerrar RSP-06I-R5`
- El commit de actualización de esta documentación registra la validación final.

HEAD final y estado del árbol se verifican al cerrar la etapa.
