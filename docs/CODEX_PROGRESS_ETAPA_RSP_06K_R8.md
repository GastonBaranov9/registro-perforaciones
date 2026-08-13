# ETAPA-RSP-06K-R8

## Causa

El selector de ranura ofrecía `No especificada` para cualquier filtro persistido,
aunque el backend rechaza borrar una ranura moderna ya especificada.

## Regla aplicada

- Los filtros nuevos muestran `Seleccionar...` y exigen 0.50, 0.75 o 1.00 mm.
- Los filtros persistidos históricamente NULL conservan y pueden volver a elegir
  `No especificada`.
- Los filtros persistidos con ranura original no nula solo muestran las tres
  ranuras modernas.

El borrador conserva `ranuraOriginal` fuera del payload para que la decisión no
dependa del valor temporal editado. La serialización continúa enviando solo
`dato`, preservando la semántica de omisión y rechazo del backend.

## Pruebas

Se añadió una prueba de componente para comprobar las opciones de históricos y
modernos y la validación contra una nulificación moderna. Pasaron:

- `npm run check:utf8`
- `npm run build`
- `npm test -- --watch=false --browsers=ChromeHeadless` (178/178)
- `git diff --check`

## Commits y estado

HEAD inicial: `09fd102183b2dc9b7ecaabdbb132d5b779d8f74d`.

Los commits de cierre se registran en esta rama sin push ni reescritura de
historial. El árbol queda limpio tras el commit de documentación.
