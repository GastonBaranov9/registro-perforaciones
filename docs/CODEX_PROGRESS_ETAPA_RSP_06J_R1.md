# ETAPA-RSP-06J-R1 — Refresco inmediato de mapa

- Causa raíz confirmada: el componente web conservaba un `src` estable y solo ejecutaba su carga en `ngOnInit`; además el endpoint respondía `private, max-age=300`. Por eso el modelo y PDF se actualizaban, pero el navegador podía reutilizar el mapa anterior.
- Frontend: el componente reevalúa cambios de coordenadas, actualiza estado y genera un `src` determinista versionado con `latitud,longitud` normalizadas. No contiene API key ni URL Google.
- API: el endpoint autenticado responde `Cache-Control: private, no-store`. El caché interno backend de cinco minutos permanece por URL Google/coordenadas y no reutiliza la ubicación anterior.
- Caso B validado: tras guardar DMS, el detalle usa inmediatamente `-31.443917, -57.986556`; el PDF continúa usando las coordenadas nuevas.
- Fallback sin Google y atribución permanecen sin cambios funcionales.
- Pruebas focalizadas: API mapa/caché `6/6`; frontend mapa `3/3`; prueba HTTP real con creación decimal, actualización DMS, lectura normalizada, mapa `200`, `private, no-store` y PDF `200`/4 páginas.
- Validación final: API build y suite completa; frontend UTF-8, build y suite completa; `git diff --check`.
- No se modificaron Google Static (satellite/zoom 17/640x400/scale 2/marcador), DMS, PDF técnico, gaps 20/7, intervalos ni catálogo.
- Commits R1: `8d6f47b fix(front): refrescar mapa tras actualizar ubicacion`, `728bb35 fix(api): evitar cache obsoleta de mapas protegidos`, `951624b test: cubrir refresco de imagen aerea` y este cierre documental.
- HEAD final y `git status` se registran tras los commits.
