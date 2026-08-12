# RSP-06K-R5 — Sincronizar sitio al regresar a edición de pozo

- Causa: Ionic conserva `PozoEditPage` y su snapshot de sitios; el retorno guardado no se consumía al volver.
- Lifecycle: `ionViewWillEnter()` consume `SitioReturnService.sitioCreado`.
- Actualización: reemplazo quirúrgico por `id_sitio`; retornos de otra identidad se ignoran y el retorno se limpia.
- Borrador: no se recarga `pozoResource`, no se hidrata el formulario y se preservan datos técnicos, intervalos, filtros, ranuras, tuberías y aportes.
- Cancelar: `SitiosEditPage` solo publica después de `editSitio` exitoso; cancelar no altera el sitio del pozo.
- Múltiples retornos: cada guardado se consume una vez y reemplaza el estado anterior por la misma identidad.
- Pruebas: focalizada de `PozoEditPage` 9/9; se validan retorno, identidad, consumo único, ausencia de reload y preservación del borrador.
- Validación final: UTF-8, build y suite frontend ejecutados al cierre.
- Commits y HEAD: se registran al finalizar; árbol limpio.
