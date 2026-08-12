# RSP-06K-R6 — Preservar ranura y restringir preview de mapa

- Ranura: los filtros persistidos consultan su `ranura_mm` original antes de mutar. Propiedad omitida conserva el valor; valor numérico válido actualiza; `null` explícito solo conserva históricos NULL y rechaza borrar una ranura moderna. Filtros nuevos siguen exigiendo ranura.
- Atomicidad: la resolución y validación ocurren dentro de la transacción, antes de eliminar/recrear hijos.
- Preview: las coordenadas arbitrarias requieren `userIsAdminOrPerforador` y además `sitioEsGestionablePorPerforador`; propietarios conservan lectura del mapa persistido, pero no pueden usar preview.
- Seguridad: autorización antes de `obtenerMapaEstatico`; no se modificaron API key, validación SSRF, proveedor, `no-store` ni controles de imagen.
- Pruebas: focalizadas de ranuras y autorización pasan; suite API completa `168/168` y build correctos. Se verificó que la ruta no usa preview para propietarios.
- Frontend: sin cambios funcionales; no se repite su suite.
- Commits y HEAD: se registran al cierre; árbol limpio.
