# ETAPA RSP-06H-B — Administración y selectores de litologías

## Estado

Implementación terminada sobre `feature/catalogo-paleta-litologias`, sin cambios de rama, merge, rebase, reset, clean, push ni despliegue. RSP-06H-C queda fuera de alcance: no se modificaron colores, texturas ni patrones visuales canónicos.

## Arquitectura implementada

- `LitologiasService` centraliza GET de activas, GET individual histórica y mutaciones administrativas contra `/litologias`.
- `SelectorLitologiaComponent` carga activas, busca por nombre/familia, muestra familia y muestra de color, informa carga/error/reintento y recupera puntualmente una entrada inactiva seleccionada para conservar históricos.
- La creación completa, edición completa, borrador técnico y CRUD independiente de intervalos usan `id_litologia`; `material` conserva el nombre visible/histórico enviado al contrato existente.
- La hidratación de edición conserva el ID catalogado y el borrador mantiene su regla existente: carga remota no ensucia; cambios manuales sí.
- El acceso `litologias-admin` y el botón de inicio se muestran solo al rol `administracion`; la guardia y el backend continúan siendo la autoridad efectiva.
- La administración lista activas e inactivas, busca, filtra familia/estado, crea, edita nombre/familia/color/patrón/orden y activa/desactiva. No hay hard delete ni edición de código.

## Históricos

Las entradas inactivas se recuperan por ID, se muestran como “Inactiva — uso histórico” y no aparecen en el catálogo de nuevas opciones. Un intervalo sin FK conserva su `material` y no se vincula por coincidencia aproximada al editar otros datos; el backend mantiene el ID existente cuando el cliente omite la litología. El reemplazo exige selección explícita de una opción activa.

## Pruebas focalizadas

- Servicio y selector: 2/2, incluyendo query activa, consulta administrativa y búsqueda `Are`.
- Borrador y formulario de intervalo: 8/8.
- API catálogo/intervalos: 9/9, incluyendo histórica sin FK.

## Validación integral

- Build API: correcto.
- Suite API completa: 107/107.
- Build frontend: correcto.
- Suite frontend completa: 133/133.
- `npm run check:utf8`: correcto.
- PostgreSQL local reversible: catálogo 29, litología personalizada, intervalo, desactivación, histórico legible, opciones nuevas excluidas, perfil y PDF; finalizó con `ROLLBACK` y 0 restos.
- `git diff --check`: correcto.

La variante local heredada `rsp06h-r1-completo.local.ts` no se usó para la evidencia final porque intenta insertar roles globales ya existentes (`rol_nombre_key`); falló antes de confirmar cambios. La prueba reversible `rsp06h.local.ts` sí completó y limpió transaccionalmente.

## Commits

Se crearon dos commits locales coherentes: integración Angular y preservación histórica API, pruebas y documentación. No se publicaron.

## Riesgos residuales

La API mantiene compatibilidad de lectura/escritura para clientes antiguos que envíen solo `material`; los flujos Angular productivos ya seleccionan por ID. Los históricos sin FK no se pueden identificar automáticamente, por diseño. El diseño visual definitivo de colores, texturas y patrones permanece reservado para RSP-06H-C.
