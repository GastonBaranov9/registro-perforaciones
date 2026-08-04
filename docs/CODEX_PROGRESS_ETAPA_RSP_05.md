# ETAPA RSP-05 — aislamiento de perforaciones por propietario

## Resultado y grafo real

El esquema no contiene una entidad `perforacion` separada: el agregado de negocio es `pozo`. La pertenencia inequívoca encontrada es:

`usuario.id_usuario` → `pozo.id_propietario` → `pozo.id_pozo` → `intervalo_litologico | intervalo_diametro_perforacion | nivel_aporte | documento | informe`.

`sitio` se relaciona desde `pozo.id_sitio`. `pozo.id_perforador` conserva el alcance del perforador y `creado_por` es auditoría, no propiedad. No hubo migraciones.

## Inventario de rutas y decisión

| Método y ruta | Recurso | Roles | Riesgo anterior | Protección final |
|---|---|---|---|---|
| GET/POST `/usuarios/:id_usuario/pozos` | listado/alta | propietario (GET), perforador, administración | el listado confiaba en `:id_usuario` | GET usa `request.user.sub` y filtra en SQL; alta limita perforador al `sub` salvo admin |
| GET/PUT/DELETE `/usuarios/:id_usuario/pozos/:id_pozo` | pozo | propietario (GET), perforador, administración | 403 revelador y escrituras de pozos ajenos | autorización central por `id_pozo`; ajeno del propietario es 404; escrituras del perforador requieren relación |
| POST/GET `/usuarios/:id_usuario/pozos/:id_pozo/foto` | imagen | propietario (GET), perforador, administración | archivos predecibles bajo `/public` | se retiró publicación estática y se sirve detrás de sesión y propiedad |
| GET `/usuarios/:id_usuario/sitios[/:id_sitio]` | sitio | propietario, perforador, administración | listado global y detalle directo | propietario recibe solo sitios enlazados a pozos propios |
| POST/PUT/DELETE sitios | sitio | perforador, administración | sin ampliación a propietario | permisos existentes conservados |
| GET/POST/PUT/DELETE `.../intervalo_litologico[/:id]` | litología | propietario solo GET; perforador/admin escritura | ID de padre manipulable | primero se valida el pozo autorizado; SQL hijo valida además `(id_hijo,id_pozo)` |
| GET/POST/PUT/DELETE `.../intervalo_diametro_perforacion[/:id]` | diámetro | propietario solo GET; perforador/admin escritura | IDOR por pozo | misma cadena completa |
| GET/POST/PUT/DELETE `.../niveles_aporte[/:id]` | aporte | propietario solo GET; perforador/admin escritura | IDOR por pozo | misma cadena completa |
| GET `.../informes`, `.../caracteristicas`, `.../litologia` | informe/datos PDF | propietario, perforador, administración | consultas sin propiedad | autorización antes de consultar datos completos |
| GET `.../informe-pdf` | PDF | propietario, perforador, administración | PDF ajeno generable por URL directa | autorización antes de `getReportePozo` y antes de `generarPDFBytes` |
| GET `/ws` | notificaciones | sesión vigente | identidad tomada del query string y mensajes con IDs arbitrarios | cookie/JWT vigente, identidad desde `sub`, canal solo servidor→cliente |
| rutas de usuarios/roles/login | administración/sesión | según reglas existentes | fuera del agregado | sin cambios funcionales; cookie, CSRF y `version_sesion` conservados |

No existen endpoints HTTP de `documento` ni de `informe.id_informe`; aparecen solamente en el esquema/consultas. La foto es el único archivo servido por la aplicación.

## Arquitectura y política HTTP

`autorizacion-recursos.ts` centraliza consultas parametrizadas de pertenencia. El hook `pozoIsFromUser` aplica: administración pasa; propietario requiere `pozo.id_propietario = sub` y recibe 404 genérico si falla; perforador requiere `pozo.id_perforador = sub` y recibe 403. La autenticación inválida continúa en 401. Las mutaciones siguen pasando por el hook global CSRF antes de sus handlers.

Los listados de pozos y sitios de propietario se filtran en PostgreSQL. No se usa el ID de Angular ni el parámetro de ruta como identidad. Las escrituras de hijos incorporan el padre en sus `UPDATE`/`DELETE`, evitando que un ID hijo de otro pozo funcione. Propietario conserva solo lectura: no se ampliaron sus mutaciones.

## Cambios por área

- Backend: identidad canónica desde `sub`, consultas de pozo con columnas explícitas, autorización de padre en todos los recursos técnicos, informes, PDF, foto y sitios.
- Frontend: no filtra datos localmente; vacía el estado antes de recargar y también ante error; oculta editar/eliminar a propietario mediante roles de la sesión.
- PDF: no cambió su contenido ni el perfil litológico; la autorización ocurre antes de reunir datos o crear bytes.
- WebSocket: requiere la cookie de sesión vigente, ignora el `id_usuario` de query y dejó de aceptar mensajes con destinos elegidos por el cliente. Solo notifica al usuario o administradores determinados por el servidor.
- Base: ninguna migración ni modificación de datos persistentes.

## Vulnerabilidades corregidas

Se eliminaron: suplantación del propietario en `:id_usuario`, listados globales de sitios, acceso directo a hijos/PDF por cambiar `id_pozo`, acceso a fotos por URL pública, creación/reasignación por un perforador usando otro `id_perforador`, y suplantación/redistribución de eventos WebSocket. Los errores de propietario no confirman la existencia del objeto ajeno.

## Pruebas y comprobación local

- Backend: 19/19 (`node --test --experimental-strip-types test/*.test.ts`). Incluye cookie-only, CSRF, sesión activa/versionada y pruebas unitarias A/B de pozo, perforador y sitio.
- Frontend: 84/84, 0 fallidas (`npm.cmd test -- --watch=false --browsers=ChromeHeadless`).
- Build API: correcto (`npm.cmd run build`).
- Build frontend: correcto (`npm.cmd run build`).
- `git diff --check`: correcto.
- PostgreSQL local: transacción con propietarios A/B, perforador, dos sitios, dos pozos y dos intervalos. A vio solo su listado/pozo; el pozo y el hijo de B quedaron ocultos. Se ejecutó `ROLLBACK`, por lo que no quedaron datos temporales.

La generación PDF se cubre estructuralmente: el mismo preHandler que negó el pozo ajeno corre antes de `getReportePozo` y `generarPDFBytes`. No se escribió un PDF durante la prueba transaccional para evitar que una consulta desde otro cliente viera datos no confirmados.

## Archivos principales

`api/src/services/autorizacion-recursos.ts`, `api/src/plugins/jwt.ts`, `api/src/routes/{pozos,sitios,informes,intervalos-litologicos,intervalos-diametro-perforaciones,niveles-aporte,ws}.ts`, `api/src/plugins/websocket.ts`, `api/src/services/{pozos,sitios}-service*.ts`, `api/test/aislamiento-propietarios.test.ts` y la lista de pozos/AuthService de Angular.

## Despliegue, rollback y limitaciones

Previo: desplegar API y frontend juntos, conservar `FASTIFY_SECRET`/variables PostgreSQL, cookies seguras en TLS y ejecutar los builds/tests anteriores. No hay SQL de migración. Tras desplegar, verificar login, lista propia, detalle, hijo, PDF, foto y WebSocket con dos cuentas aisladas.

Rollback: revertir los commits RSP-05 en orden inverso y volver a desplegar ambos artefactos; no hay rollback de base. Las fotos existentes permanecen en disco y la API las localiza por `pozo-{id}.ext`.

Limitaciones: no existe ruta HTTP de documentos/informes por ID que proteger; si se añade, deberá encadenar siempre por `documento|informe.id_pozo → pozo.id_propietario`. El perfil litológico dinámico sigue fuera de alcance. Antes de implementarlo debe conservar la misma autorización por `id_pozo`, validar cada intervalo hijo en SQL y mantener la autorización previa a PDF.
