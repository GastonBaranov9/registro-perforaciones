# ETAPA RSP-06F-C — Vista previa y fechas legibles

## Resultado

La edición vuelve a mostrar una sección **“Vista previa del perfil del pozo”** y refleja el borrador técnico sin guardarlo. Las fechas de calendario se mantienen como `YYYY-MM-DD` en controles HTML y se presentan como `DD/MM/YYYY` en detalle y PDF.

## Causa raíz

La extracción del editor técnico compartido dejó `pozo-edit.page.html` únicamente con `app-pozos-form` y `app-datos-tecnicos-borrador`. El componente `app-perfil-litologico` no se montaba allí y solo admitía `idUsuario/idPozo`, por lo que solo podía consultar el estado persistido. No existía una entrada para un modelo de borrador ni una operación no persistente.

Las columnas `pozo.fecha_inicio` y `pozo.fecha_fin` son `DATE`; `fecha_creado` es `TIMESTAMPTZ`. El detalle interpolaba los valores `DATE` sin formato y el PDF entregaba directamente el valor del driver a `drawText`, permitiendo cadenas extensas de `Date`. Esta etapa no cambia datos ni esquema.

## Arquitectura de vista previa

- `POST /usuarios/:id_usuario/pozos/:id_pozo/perfil-litologico/vista-previa` recibe profundidad, litología, tuberías, filtros y aportes.
- La ruta exige sesión, autorización sobre el pozo y las mismas reglas de roles que el perfil persistido. El hook CSRF global protege el `POST`.
- El cuerpo no contiene propietario ni perforador y no puede conceder acceso. No se consulta información técnica del pozo ni se ejecuta SQL de escritura.
- `validarDatosTecnicosPozo` es la misma validación backend usada antes de crear/actualizar en transacción: finitud, rangos, profundidad, solapamientos y materiales.
- La respuesta sale de `crearPerfilLitologico`, la misma función pura y canónica utilizada por web y PDF.
- `PerfilLitologicoComponent` admite ahora un `modelo` opcional. En modo normal sigue consultando el endpoint persistido; en edición renderiza el modelo recibido sin recalcular geometría ni usar `innerHTML`.

## Actualización del borrador

`PerfilLitologicoVistaPreviaComponent` convierte las referencias locales del editor en el contrato técnico, aplica debounce de 300 ms y `switchMap`: una petición nueva cancela la anterior y una respuesta obsoleta no puede sobrescribirla. Mientras espera muestra “Actualizando vista previa…”. Un error elimina el modelo potencialmente obsoleto, mantiene intacto el borrador y permite reintentar. Los datos incompletos o inválidos se bloquean localmente con un mensaje y el backend vuelve a validarlos.

El formulario emite de forma tipada los cambios de profundidad. Los cambios de litología, tubería/material/diámetro, filtros y aportes ya emiten copias ordenadas desde el editor técnico compartido. La distribución usa dos columnas sobre 900 px y una columna por debajo de ese ancho, dejando el perfil debajo del formulario en móvil.

## Fechas

- API: `api/src/utils/fechas.ts` formatea `DATE` mediante sus componentes o getters UTC, sin convertirlo a la zona local.
- Frontend: `normalizarFechaCalendarioInput` conserva `YYYY-MM-DD`; `formatearFechaCalendario` presenta `DD/MM/YYYY`; los instantes usan `Intl.DateTimeFormat` con `America/Montevideo`.
- Detalle: etiquetas corregidas a “Fecha de inicio” y “Fecha de finalización”; ausencia: “No especificada”.
- Listado: “Fecha de creación” y utilidad central de instante.
- PDF: “Fecha de inicio” y “Fecha de finalización” en `DD/MM/YYYY`; no se restauró el pie de página ni “Generado el…”.

## Archivos principales

- `api/src/models/schemas.ts`
- `api/src/routes/informes.ts`
- `api/src/services/pozo-completo-service.ts`
- `api/src/utils/fechas.ts`
- `api/src/pdf/pdf-generate.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/*`
- `front/src/app/routes/pozos/components/perfil-litologico-vista-previa/*`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.ts`
- `front/src/app/shared/services/perfil-litologico.service.ts`
- `front/src/app/shared/utils/fechas.ts`
- detalle y listado de pozos.

## Pruebas y evidencia

- API: 60/60. Incluye fecha `2026-08-05` como `05/08/2026`, un `Date` UTC sin cambio de día, ausencia/inválido, borrador válido con PVC/Acero/filtro/aporte y rechazo de solapamiento/fuera de profundidad.
- Frontend: 118/118. Incluye debounce, cancelación de solicitud anterior, conservación del borrador inválido y utilidades de fecha.
- Builds API y frontend correctos.
- El renderer web ya cubre tubería, filtro, aporte, escala, tablas accesibles y modelo directo; no hubo cambios de geometría, etiquetas ni paleta.
- La inspección responsive se sustenta en el grid de dos columnas y su media query a una columna. No se usaron HTTP/WebSocket reales en specs.

## Seguridad y regresiones

Se conservan cookies HttpOnly, `version_sesion`, CSRF, `request.user.sub`, autorización de propietario/perforador/administrador, 404 genérico por los prehandlers actuales y PDF autorizado antes de generar bytes. No se añadieron Bearer, JWT en almacenamiento, SQL, migraciones, dependencias, `any` de TypeScript ni archivos públicos.

## Limitaciones reales

La vista previa requiere un pozo existente y autorizado porque pertenece a la edición; no se creó una operación anónima ni reutilizable para consultar pozos ajenos. La fotografía y los datos generales no alteran la geometría y por eso no forman parte del contrato de vista previa. La etapa no modifica portada, mapa, etiquetas constructivas ni paleta litológica.

## Despliegue y rollback

No requiere migración ni variables nuevas. Desplegar API y frontend juntos para disponer del contrato y del consumidor. El rollback consiste en revertir los commits de RSP-06F-C; no hay datos que restaurar.
