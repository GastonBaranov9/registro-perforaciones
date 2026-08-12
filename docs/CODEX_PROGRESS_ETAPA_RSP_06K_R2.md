# ETAPA RSP-06K-R2

- Mapa: la edición de sitio ahora pasa latitud/longitud persistidas a `MapaAereoComponent`. La ubicación pendiente de captura o edición actualiza el mapa; cancelar la captura limpia ese estado y recupera las coordenadas persistidas.
- IDs modernos: todo `id_intervalo_litologico` explícito se valida contra los originales bloqueados del pozo, con consumo único y sin fallback legacy.
- Legacy: los payloads sin ID mantienen matching inequívoco por profundidad/material.
- Atomicidad: la validación litológica y de filtros ocurre antes del `UPDATE`/`DELETE`; los errores devuelven 400 y la transacción revierte cualquier cambio.
- Pruebas focalizadas: API IDs/compatibilidad 10/10; frontend mapa 4/4.
- Validación final: API build + 161/161; frontend UTF-8 + build + 172/172; `git diff --check` correcto.
- Commits: `fix(front): mostrar mapa existente al editar sitio`, `fix(api): validar pertenencia de intervalos litologicos`, `test: cubrir mapa de sitio e identidades litologicas`, `docs: cerrar RSP-06K-R2`.
- HEAD y árbol se registran en el commit de cierre.
