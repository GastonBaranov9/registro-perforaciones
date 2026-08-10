# ETAPA RSP-06I — Cierre operativo y UX de pozos

## Estado y auditoría inicial

- Rama verificada: `feature/catalogo-paleta-litologias`.
- HEAD inicial verificado: `79be8dd`; árbol inicial limpio.
- PostgreSQL local disponible en Docker; API y frontend se validaron desde el repositorio.
- El modelo real no tiene una tabla `persona`: `usuario` representa la identidad, `usuario_rol` vincula los roles `propietario` y `perforador`, y `pozo.id_propietario`/`pozo.id_perforador` referencian `usuario.id_usuario`.
- `sitio` contiene `id_sitio`, `departamento`, `localidad`, `latitud` y `longitud`; `pozo.id_sitio` conserva la relación histórica. No se agregó una restricción `UNIQUE` ni una migración destructiva.
- La base local auditada tenía 10 sitios y 5 pozos; cinco sitios no estaban referenciados. Esto confirmó el riesgo real del flujo anterior de crear sitio y pozo mediante solicitudes separadas.
- La configuración local no contenía credenciales de mapas. `.env.example` solo documentaba las variables heredadas `PDF_MAP_*`.

La auditoría del código y los contratos reprodujo las causas observadas: creación de pozo descargaba el catálogo completo de sitios, el sitio se persistía en una solicitud independiente, la edición pedía geolocalización al cargar y mutaba las coordenadas visibles, el detalle intentaba hidratar identidades desde catálogos parciales y terminaba mostrando IDs, y la alta de propietario estaba acoplada a la administración general de cuentas. La validación posterior se realizó mediante HTTP real con una identidad de perforador temporal controlada; antes de los cambios no se fabricó una credencial sobre datos existentes para forzar una sesión.

## Sitio nuevo por pozo

La creación completa recibe `sitio_nuevo` en lugar de `id_sitio`. El servicio abre una única transacción PostgreSQL, valida propietario y perforador, inserta el sitio, inserta el pozo y luego sus intervalos y aportes. Cualquier fallo revierte toda la operación, incluido el sitio. La ruta legacy de creación simple rechaza nuevas altas para impedir reutilización accidental de sitios históricos.

El frontend ya no solicita ni muestra sitios en creación. Presenta el bloque **Ubicación del nuevo pozo**, captura departamento, localidad y coordenadas, y conserva esos datos en el mismo borrador hasta guardar. La respuesta completa devuelve tanto el pozo como el sitio creado. En edición se hidrata únicamente el sitio persistido y se ofrece **Editar sitio**; no existe selector para sustituirlo.

## Propietarios y perforadores

Los propietarios usan autocomplete remoto con consulta desde dos caracteres, debounce de 300 ms, máximo de 20 resultados, secuencia para ignorar respuestas obsoletas y selección por teclado o ratón. La consulta inicial no devuelve propietarios. Solo se exponen `id_usuario`, nombre, email y rol; el ID permanece como clave interna y no se presenta como identificación humana.

`POST /pozos/propietarios` permite a administrador o perforador registrar exclusivamente una identidad operativa con rol fijo `propietario`. La transacción busca el rol real, crea el usuario activo con una contraseña criptográfica aleatoria no entregada y asigna solo ese rol. El cuerpo no acepta contraseña, estado ni roles. Un usuario no autorizado recibe 403 y un email duplicado recibe 400. La administración general de cuentas continúa reservada al administrador. Tras el alta, el frontend agrega y preselecciona el propietario sin perder el resto del borrador.

El perforador autenticado se obtiene mediante la relación persistida `usuario`/`usuario_rol`, nunca por nombre o email. Para un perforador no administrador, el backend devuelve únicamente su propia asociación y la creación exige que `id_perforador` coincida con `request.user.sub`; el selector queda bloqueado. El administrador recibe búsqueda remota y puede elegir. La edición conserva siempre el perforador persistido y lo consulta por ID si no venía en el catálogo inicial.

## Identidades y ubicación humanas

El detalle de pozo usa una consulta con columnas explícitas y joins a propietario, perforador y sitio. El schema Fastify conserva nombre/email humanos y el objeto del sitio. La UI muestra empresa, propietario, representación completa del sitio y perforador; nunca usa `ID X` como fallback. Para un histórico incompleto usa “Identificación no disponible” o “Información de ubicación no disponible”.

La representación del sitio combina localidad, departamento y, cuando existen, latitud/longitud. Esto diferencia sitios que comparten localidad y departamento sin inventar campos ausentes del modelo.

## Coordenadas y navegación

Editar sitio incluye botones **VOLVER** y **ACTUALIZAR UBICACIÓN**. La captura usa la Geolocation API con alta precisión y timeout. Valida rangos, informa permiso denegado, timeout, proveedor no disponible o coordenadas inválidas, y muestra precisión cuando existe. La captura queda pendiente: no modifica el objeto persistido hasta **GUARDAR SITIO** y **CANCELAR NUEVA UBICACIÓN** restaura visualmente el valor anterior.

La vuelta usa una ruta interna explícita validada (`/pozo-edit/:id`, `/pozos-detail/:id` o `/sitios-list`). No invoca `history.back`, por lo que no puede abandonar accidentalmente la aplicación.

## Mapa aéreo compartido

`mapa-estatico.ts` usa primero la configuración compartida y mantiene fallback compatible con `PDF_MAP_*`:

- `MAP_STATIC_URL_TEMPLATE`: URL HTTPS del proveedor, con `{lat}`, `{lon}` y opcionalmente `{key}`. También se admiten los aliases heredados `{latitud}`, `{longitud}` y `{apiKey}`. La plantilla debe seleccionar en el propio proveedor estilo satelital/aéreo, zoom apropiado y marcador.
- `MAP_STATIC_ALLOWED_HOST`: host exacto autorizado, sin esquema ni ruta.
- `MAP_STATIC_API_KEY`: clave opcional, conservada solo en backend.
- `MAP_STATIC_ATTRIBUTION`: texto de atribución exigido por el proveedor.

El endpoint autenticado de imagen verifica que propietario, perforador asociado o administrador puedan consultar el sitio y obtiene la imagen desde backend. Conserva HTTPS, allowlist exacta, ausencia de redirecciones, timeout, límite incremental de bytes, control MIME y firma PNG/JPEG. La misma implementación sirve al detalle, edición y PDF, sin exponer la clave al navegador.

No existe una credencial configurada en el entorno local. Por ello la integración quedó preparada y validada en fallback: frontend muestra **Mapa aéreo no configurado**, PDF conserva su bloque de mapa no disponible y el endpoint devuelve 503. No se declara evidencia de imagen aérea real hasta configurar las cuatro variables anteriores con un proveedor autorizado.

## PDF y fit-to-page

La portada mantiene branding y fotografía, pero eleva el propietario a 21 pt y deja el número de pozo en 14 pt. La página 2 contiene ubicación humana, coordenadas, mapa/fallback y resumen contextual. La página 3 inicia siempre la sección técnica compacta con:

- datos generales en dos columnas;
- intervalos litológicos;
- tuberías y diámetros;
- intervalos de filtro;
- niveles de aporte.

El motor mide encabezados, valores generales multilínea y cada fila. Intenta 10,2 pt con padding normal, luego 9,7 pt y finalmente un mínimo de 9 pt con menor separación. Nunca divide una fila ni omite texto. Si el volumen excepcional supera el área útil, continúa con encabezados repetidos y redistribuye las dos últimas filas para evitar una continuación de una sola fila cuando hay espacio para hacerlo. El perfil litológico histórico se conserva después de las tres páginas principales.

`api/test/rsp06i-pdf-evidencia.ts` genera de forma reproducible casos pequeño, normal, cargado y extremo junto con diagnóstico JSON en el directorio temporal indicado por `RSP06I_EVIDENCE_DIR`. Los diagnósticos obtenidos fueron: pequeño y normal, una página técnica a 10,2 pt; cargado, dos páginas técnicas a 9 pt; extremo, cinco páginas técnicas a 9 pt. La rasterización local con Edge produjo imágenes blancas/no confiables, por lo que no se afirma una inspección visual inexistente; la aceptación se apoya en estructura PDF, mediciones, límites y diagnósticos automatizados.

## Pruebas y evidencia HTTP

Pruebas focalizadas durante el desarrollo:

- API: atomicidad de sitio/pozo, rollback, autorización de propietario operativo, candidatos y composición PDF; 37/37 en la última ejecución focalizada.
- Frontend: autocomplete remoto, persistencia de selección, geolocalización y edición pendiente de sitio; las ejecuciones focalizadas terminaron sin fallos.

El script `api/test/rsp06i.local.ts` ejecutó contra la aplicación y PostgreSQL reales:

1. login de perforador temporal mediante cookie HttpOnly y CSRF;
2. catálogo inicial sin propietarios y perforador propio preseleccionable;
3. alta de propietario operativo (201) y selección posterior;
4. alta atómica de sitio nuevo + pozo completo (201), sin catálogo de sitios;
5. fallo deliberado de pozo sin sitio huérfano;
6. rechazo del endpoint legacy (400);
7. edición de pozo conserva el sitio persistido incluso si el cliente envía otro ID;
8. detalle con propietario, perforador y sitio humanos;
9. edición de coordenadas del sitio (200);
10. mapa sin configurar (estado `false`, imagen 503);
11. PDF real con cuatro páginas: tres páginas principales más el perfil litológico conservado.

El `finally` del script eliminó por claves exactas el pozo, sitio, propietario y sesión temporales. Una consulta posterior confirmó cero registros temporales RSP-06I. No se modificaron datos funcionales existentes.

## Seguridad

Se conservan cookies HttpOnly, CSRF, `version_sesion`, `request.user.sub`, aislamiento de propietarios, validación de roles, advisory locks, SQL parametrizado, columnas explícitas, protección de fotos y defensas SSRF. No se agregaron tokens Bearer, JWT en almacenamiento, `SELECT *`, SQL interpolado, credenciales, roles arbitrarios, migraciones destructivas ni dependencias de mapas en frontend.

## Riesgos residuales y dependencias externas

- Falta una credencial real y una plantilla de proveedor aéreo autorizada; hasta entonces el mapa permanece correctamente en fallback.
- Debido al modelo acoplado actual, un propietario operativo ocupa una fila `usuario`. No recibe credenciales utilizables; si en el futuro necesita acceso, un administrador debe habilitarlo mediante el flujo de gestión/restablecimiento correspondiente.
- La inspección visual rasterizada de PDFs no fue confiable en este equipo. Los cuatro casos quedan reproducibles para inspección en un visor externo si se desea complementar la validación estructural.
- Sitios huérfanos históricos no se eliminaron ni reasignaron para preservar datos y compatibilidad.

## Rollback

La etapa no tiene migraciones. El rollback consiste en revertir, en orden inverso, los commits locales de RSP-06I con `git revert`; esto restaura contratos, rutas, frontend, PDF, pruebas y documentación sin reescribir la historia. Las variables `MAP_STATIC_*` son opt-in y pueden retirarse del entorno para volver al fallback sin tocar datos.

## Validación integral final

- API: build TypeScript correcto y suite completa 120/120.
- Frontend: comprobación UTF-8 correcta, build de producción correcto y suite completa 146/146.
- Docker: imágenes locales `local/api` y `local/front` construidas correctamente. La imagen API se reconstruyó de forma focalizada tras la corrección final.
- HTTP/PostgreSQL: flujo RSP-06I completo correcto; propietario 201, sitio+pozo 201, rollback sin huérfano, legacy 400, edición conserva sitio, detalle humano, coordenadas 200, mapa no configurado 503 y PDF de cuatro páginas.
- La primera aceptación final detectó que `id_sitio` de la respuesta de edición conservaba el tipo texto de PostgreSQL. Se normalizaron todos los IDs y numéricos del resultado, se repitieron build y pruebas focalizadas 22/22 y la aceptación HTTP pasó. El `finally` también limpió esa ejecución fallida.
- Evidencia PDF: pequeño/normal con una página técnica a 10,2 pt; cargado con dos y extremo con cinco, ambos a mínimo 9 pt.
- PostgreSQL confirmó cero usuarios, sitios o pozos temporales RSP-06I restantes.
- `git diff --check` y estado final se registran después de los commits locales.
