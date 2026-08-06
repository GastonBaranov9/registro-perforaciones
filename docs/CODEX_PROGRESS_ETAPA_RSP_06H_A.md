# ETAPA RSP-06H-A — Catálogo central de litologías

## Estado y auditoría inicial

La campaña comenzó en `feature/catalogo-paleta-litologias`, basada en `main`, con HEAD `74e7a97` y árbol limpio. Solo existían las migraciones `001_add_version_sesion.sql` y `002_add_tuberia_filtros.sql`. PostgreSQL almacenaba la litología exclusivamente en `intervalo_litologico.material VARCHAR NOT NULL`; no había identificador ni catálogo. La base local tenía 10 intervalos y estos valores: `Basalto Azul`, `Basalto marron`, `Basalto naranja`, `Basalto rosado`, `Suelo organico`, `Tosca rosada`, `basalto marron`, `granito` y `suelo organico`.

La auditoría localizó el texto en los formularios y contratos de intervalos, las escrituras individuales y atómicas de pozos, las consultas de informe y las pruebas/scripts. El estilo se decidía en `perfil-litologico.ts` mediante hash del nombre sobre seis combinaciones hardcodeadas; ese modelo canónico alimentaba tanto Angular/vista previa como PDF. El PDF no tenía una paleta independiente, pero sí consumía el estilo resultante del mismo modelo.

## Modelo persistente

La migración `003_catalogo_litologias.sql` crea `catalogo_litologia` con ID estable, código único e inmutable desde la API, nombre visible, nombre normalizado generado, familia, color `#RRGGBB`, patrón semántico limitado, activo, orden no negativo, indicador inicial y timestamps. No agrega extensiones. La función inmutable `litologia_normalizar` recorta, compacta blancos, pasa a minúsculas y elimina diacríticos españoles; una restricción única sobre el valor generado impide nombres equivalentes.

Familias: basalto, suelo, arenisca, arcilla/arena, tosca, gravilla, granito y otro. Patrones permitidos: `basalt`, `basalt_fractured`, `organic`, `sandstone_fine`, `sandstone_medium`, `sandstone_coarse`, `clay`, `sandy_clay`, `tosca`, `gravel_fine`, `gravel_coarse` y `granite`. Son claves propias, vectoriales y deterministas inspiradas conceptualmente por FGDC-STD-013-2006, USGS Techniques and Methods 11-A2, sección 37 y las series 600/700; no se presentan como símbolos oficiales certificados y no incorporan EPS ni recursos externos.

## Catálogo inicial

Se cargan exactamente 29 entradas, en el orden solicitado: cinco basaltos, suelo orgánico, seis areniscas, seis arcillas/arenas, seis toscas, dos gravillas y tres granitos. Los colores son una paleta mineral sobria y canónica almacenada en base de datos. Las variantes rosadas usan rosas/rojos apagados; `Tosca rosada` es `#D29A91`, no verde. Granulometrías y familias se distinguen también por patrón, no solo por color.

## Compatibilidad histórica

`intervalo_litologico` recibe `id_litologia BIGINT NULL` con FK `ON DELETE RESTRICT`. La migración enlaza únicamente igualdades normalizadas exactas y nunca modifica `material`. En la base local se conservaron los 10 intervalos: 6 coincidencias quedaron vinculadas y 4 valores desconocidos permanecieron con FK nula y texto intacto.

Durante la transición, el catálogo es fuente de verdad para una escritura que envía `id_litologia`: una sola sentencia exige que esté activa y copia su nombre a `material`. Para entradas históricas o clientes actuales sin ID, `material` continúa siendo la fuente de verdad y la heurística visual anterior permanece como fallback. Las lecturas enlazadas obtienen nombre/color/patrón/estado con `LEFT JOIN`, por lo que una litología inactiva sigue siendo legible y renderizable. En RSP-06H-B podrá hacerse obligatoria la selección catalogada una vez migrada la interfaz; solo entonces, tras auditar nulos, podrá planificarse retirar el texto duplicado.

Rollback manual, documentado al pie de la migración: quitar FK e índice, quitar la columna nullable, eliminar catálogo y función dentro de una transacción. `material` permite volver atrás sin pérdida.

## API, contratos y seguridad

Rutas autenticadas: `GET /litologias` lista activas ordenadas y `GET /litologias/:id_litologia` obtiene una entrada, incluso inactiva para uso histórico. `GET /litologias?incluir_inactivas=true` exige administrador. Crear, actualizar, activar y desactivar exigen `userIsAdmin`; no existe endpoint de hard delete. Duplicados devuelven 409 y las validaciones de TypeBox/base rechazan código, color, patrón, familia y orden inválidos.

Los modelos TypeBox y Angular preparan entidad, respuesta pública, altas/actualizaciones, familias y patrones sin `any` nuevo. Toda consulta usa parámetros y columnas explícitas. Se conservan cookie HttpOnly, CSRF global, `version_sesion`, `request.user.sub`, roles, aislamiento de pozos, 404 genérico y advisory locks existentes. No se añadió Bearer funcional, almacenamiento JWT, contenido SVG/CSS de usuario ni dependencias.

El perfil canónico admite ID, nombre, color, patrón y estado. Una tabla única traduce la clave semántica segura a los seis patrones vectoriales ya soportados por web y PDF; se conserva geometría y experiencia visual general.

## Validación y evidencia PostgreSQL

- Migración local: `BEGIN`, tabla/función/índice/FK, 29 inserts, 6 vínculos, `COMMIT`.
- Resultado: catálogo 29, 29 códigos, 29 nombres normalizados, 0 colores inválidos, 0 patrones inválidos; intervalos 10 antes y después, 6 vinculados y 4 desconocidos.
- Prueba controlada `rsp06h.local.ts`: creó una litología personalizada, usuario/sitio/pozo/intervalo temporales, la desactivó, verificó que desaparece de activas y sigue legible/renderizable, generó perfil y PDF, y finalizó con `ROLLBACK`; quedaron 0 restos.
- API: build correcto y 99/99 pruebas Node correctas.
- Frontend: build correcto y 131/131 pruebas Karma correctas.
- Las regresiones cubren creación/edición atómica, perfil, vista previa, PDF, autorización, cookies/CSRF, sesiones, fotos, filtros, tuberías y aportes.

## Riesgos residuales y trabajo reservado

Los cuatro nombres locales desconocidos requieren decisión humana o altas explícitas; no se aproximaron silenciosamente. El texto libre sigue aceptado por compatibilidad hasta que RSP-06H-B integre selección catalogada en Angular y migre los flujos. RSP-06H-C queda reservado para ajuste visual completo de paleta/patrones, accesibilidad y diseño administrativo final. Una actualización de nombre mantiene deliberadamente la instantánea histórica de intervalos ya creados; las lecturas muestran ambos valores y renderizan desde el catálogo.
