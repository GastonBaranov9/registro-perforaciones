# RSP-06H-D — Prueba manual y UX de pozos

## Causa raíz y corrección

El 500 de `GET /usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico` no era un JOIN inválido: PostgreSQL devolvía `BIGINT`/`NUMERIC` como cadenas (`"65"`, `"0"`, `"6"`) y Fastify rechazaba esos valores contra `Type.Integer`/`Type.Number` durante la serialización. La causa se reprodujo con el pozo local 18 y se corrigió normalizando números y metadata nullable en crear, actualizar, detalle y lista. Los históricos con FK nula conservan `null` y los vinculados (activos o inactivos) conservan metadata.

La edición reutiliza esa lista normalizada y mantiene el flujo de datos técnicos. Los errores de `resource`/HTTP se convierten en mensajes humanos sin mostrar `[object Object]`.

## UX aplicada

- Propietarios y perforadores: búsqueda remota con límite de 20, debounce de 300 ms e ignorado de respuestas obsoletas; la lista inicial no descarga cientos de candidatos.
- Sitios: se muestran como localidad/departamento, manteniendo el ID solo para el contrato interno y la navegación.
- Perforador nuevo: se preselecciona el usuario autenticado cuando aparece como candidato inequívoco; administración conserva la posibilidad de cambiarlo. Edición no altera el valor existente.
- Detalle: muestra nombres humanos cuando la autorización permite hidratar candidatos y mantiene fallback técnico seguro.

Pruebas focalizadas: normalización API, build API, specs de selector/personas/crear/editar frontend (13/13). La validación integral y la prueba PostgreSQL/HTTP controlada se ejecutan al cierre de la etapa.

Riesgos residuales: si el usuario no tiene autorización para consultar candidatos, el detalle conserva el ID como fallback; no se expone información personal adicional.
