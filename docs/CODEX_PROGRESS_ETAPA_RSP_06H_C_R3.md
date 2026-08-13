# RSP-06H-C-R3 — Consistencia de catálogo y respuestas

- Catálogo activo: cache compartido con TTL de 5 minutos, invalidación explícita (`invalidate`) y recarga (`refresh`). Los errores limpian la entrada para que el siguiente intento haga una request nueva; las cargas históricas permanecen separadas.
- Updates legacy: si se omite `id_litologia` y el intervalo ya está vinculado, se conserva la FK y se restaura el nombre canónico de esa entrada. Con un ID explícito, FK y material se guardan juntos (incluido histórico inactivo); sin FK se permite material libre.
- Respuestas Fastify: `IntervaloLitologico` expone `litologia_nombre`, `litologia_color`, `litologia_patron` y `litologia_activa` como campos nullable.

Pruebas focalizadas ejecutadas: spec de `LitologiasService` (4/4), pruebas API de catálogo/errores (12/12) y build TypeScript de API.
