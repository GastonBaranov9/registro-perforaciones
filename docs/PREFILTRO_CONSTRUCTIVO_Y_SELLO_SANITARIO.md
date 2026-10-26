# Prefiltro constructivo y proporción del sello sanitario — actualización 027

Implementación local sobre `4776a923b54b62590a591bb23393164ac2afb548`, rama
`feature/rsp-10-pilot-apk`. Cierre en un único commit local; sin push ni despliegue.

## Representación

- El sello mantiene su textura de hormigón y todas sus profundidades. Su espesor
  lateral definitivo es `ESPESOR_GRAFICO_SELLO = 0.13` del ancho de la columna, medido
  desde el borde exterior de la construcción hacia afuera. Antes se extendía
  hasta 0.06/0.94: con la tubería más ancha cada banda ocupaba 0.24; ahora ocupa
  0.13 (aproximadamente 46 % menos). No cambia el ancho del caño. Se conserva
  exactamente el ajuste manual aprobado por el propietario; no se restaura 0.075.
- `ESPESOR_GRAFICO_PREFILTRO = 0.13`, conservado del archivo local. Se representa gravilla con granos huecos y
  fondo claro, mediante un patrón propio `gravilla-prefiltro`, independiente de
  las texturas geológicas. No es un filtro ranurado ni una litología.
- Se conservan terreno, cambios de diámetro, tramos abiertos, filtros, aportes,
  cota cero y sobresaliente. Las envolventes se dibujan antes de tuberías y aportes.
- Ambos espesores y las posiciones radiales son convenciones gráficas, no medidas
  físicas en centímetros ni datos que deban guardarse.
- La geometría procede exclusivamente de `crearPerfilLitologico()`. Preview,
  consulta del perfil guardado y PDF usan esta misma función. El perfil guardado
  se reconstruye a partir de datos persistidos; no se almacena otro motor gráfico.
- Cada intervalo de prefiltro tiene una etiqueta en la página de su punto medio.
  Los cambios de diámetro y cortes de página no duplican esa etiqueta. La tabla
  conserva todos los intervalos. Se utiliza el separador `-` en las etiquetas
  compartidas porque es compatible con el sanitizador actual de fuentes PDF.
- La leyenda de prefiltro sólo aparece si hay intervalos. En PDF se incorpora a
  la leyenda paginada de materiales junto al sello; no se dibujan leyendas encima
  del gráfico. Las advertencias se imprimen en una página de observaciones.

## Solapamientos y límites de la representación

No se permiten duplicados ni solapamientos entre intervalos de prefiltro; sí
intervalos consecutivos con un extremo común. Se ordenan para validar y representar,
sin mutar el payload original ni su identidad idempotente.

El solapamiento sello–prefiltro se acepta con advertencia visible en formulario,
perfil web y PDF. En el tramo coincidente, el sello queda junto a la construcción
y el prefiltro ocupa una banda contigua exterior. Las profundidades no se alteran.
Esta separación permite distinguir las texturas; **no afirma que las posiciones
radiales reales hayan sido medidas ni certifica la validez física de la construcción**.
El usuario debe revisar la coincidencia. Fuera del solapamiento el prefiltro vuelve
a tocar el borde de la construcción.

Se advierte si hay prefiltro sin filtros ranurados; no se prohíbe ni se generan
filtros automáticamente. No se infieren intervalos a partir de otros materiales.
El propietario revisó y aprobó el grosor del sello. La verificación final comprueba
su geometría sin cambiar la proporción elegida: incluso en solapamiento, las bandas
quedan dentro de la columna y mantienen contacto, con terreno visible alrededor.

## Contrato y persistencia

Campo independiente, en el nivel de los datos técnicos:

```json
{
  "prefiltro_constructivo": [
    { "desde_m": 13.5, "hasta_m": 15.5 },
    { "desde_m": 20, "hasta_m": 25 }
  ]
}
```

| Entrada | Alta | Actualización |
|---|---|---|
| Campo omitido | Sin prefiltro | Conserva exactamente las filas existentes |
| `null` | Sin prefiltro | Elimina explícitamente la colección |
| `[]` | Sin prefiltro | Elimina explícitamente la colección |
| Colección válida | Guarda intervalos | Reemplaza toda la colección en una transacción |

Las lecturas actuales devuelven `[]` cuando no hay prefiltro. Se aceptan respuestas
idempotentes antiguas sin el campo. Un PATCH de otro dato no lo elimina.

Validación frontend/backend: números finitos, `0 <= desde_m < hasta_m`, profundidad
final conocida y suficiente, sin duplicados ni solapamientos internos. Si se reduce
la profundidad final, se revisan también los prefiltros conservados. Un histórico
sin profundidad puede seguir existiendo sin prefiltro; para declararlo debe indicar
la profundidad final. No se exige coincidencia exacta con un filtro ranurado.

`027_prefiltro_constructivo.sql` crea exclusivamente `prefiltro_pozo`:

- `id_pozo` con FK y `ON DELETE CASCADE`.
- `desde_m` y `hasta_m` numéricos, no nulos, finitos y ordenados.
- Clave primaria `(id_pozo, desde_m)`, que sirve también para buscar por pozo y
  rechazar dos intervalos con el mismo inicio. No se necesita una identidad extra.
- Las validaciones entre filas y contra la profundidad final se realizan en los
  servicios bajo el bloqueo/transacción existente del pozo. No se agrega extensión
  PostgreSQL ni se cambia infraestructura.

El reemplazo y la escritura del pozo comparten transacción; cualquier error posterior
revierte la colección. El inventario de hijos archivados por el procedimiento de
eliminación existente incluye la tabla nueva para preservar su evidencia; no se
cambian operaciones, permisos, reservas ni políticas administrativas.

## Compatibilidad y conservación

- `pozo.pre_filtro` sigue siendo texto legado. No se elimina, convierte ni sobrescribe.
  El PDF lo identifica como «Prefiltro (texto legado)» y muestra los intervalos nuevos
  como «Prefiltro de gravilla» por separado.
- No se modifican migraciones 000–026, sellos guardados, numeración, política 026,
  reservas, permisos, resultados de idempotencia, fotografías ni documentos existentes.
- La nueva tabla comienza vacía para todos los registros anteriores.
- Alta/edición normal e histórica, relectura y borradores transportan el campo nuevo.
  La reconciliación tras guardar conserva ediciones locales hechas después del envío.
- Offline: un borrador antiguo sin campo produce el mismo JSON enviado que antes.
  No se añaden defaults a esa solicitud, no se reordena su colección al enviarla y no
  cambian clave, época, fotos ni identidad. Los reintentos usan la misma operación;
  los resultados confirmados antiguos se devuelven tal como fueron registrados.
- Históricos pendientes: el cuerpo conservado mantiene prefiltro cuando existe y su
  ausencia cuando no existe. No se recrean operaciones confirmadas.
- Los PDF ya descargados no cambian. Sólo los regenerados usan el aspecto nuevo.
- El modelo no contiene límites ni reglas particulares de numeración de esta empresa.
  También sirve para futuras instalaciones, sin introducir multitenancy.

## Verificación local previa al ajuste manual

Todas las bases fueron nuevas, sintéticas, con puerto aleatorio, dentro de Temp.
El ensayo verifica `data_directory` antes de escribir, no carga `.env`, no usa Docker
y detiene su propio clúster al terminar. No se contactó producción.

- Pruebas API focalizadas de contratos, geometría, PDF, sello, históricos y tramos
  abiertos: **84/84**; ver comandos de reproducción debajo.
- PostgreSQL: **10/10**, incluyendo aplicación aditiva desde 026, conservación,
  alta/edición normal e histórica, omisión/null/[], rollback, solicitudes antiguas,
  reintentos, detalle/reporte, 15 solicitudes HTTP autenticadas A–E y dump/restore.
- Angular Chrome Headless: **181/181** (86 de formularios/modelos/renderizado y
  95 de offline/históricos; incluye seis casos nuevos de conservación/reintento offline).
- Visual: **30/30**, cinco casos × dos vistas × tres anchos (390, 768 y 1366 px),
  además de capturas de formularios. Build Angular real, respuestas API interceptadas
  tomadas del ensayo PostgreSQL; ninguna conexión API externa. No sustituye una
  sesión manual completa en un teléfono físico.
- Compilación API y build Angular development correctos. Advertencia no bloqueante
  de Stencil `empty-glob`. Sin dependencias nuevas.
- PDF sintéticos A–E generados desde PostgreSQL y renderizados con Windows.Data.Pdf
  para inspección. Incluyen advertencia de solapamiento, tabla, leyenda y texturas.
- Casos de geometría multipágina y leyenda extensa verificados automáticamente.

Comandos desde `api`:

```powershell
node --test --experimental-strip-types test/prefiltro-constructivo.test.ts test/perfil-litologico.test.ts test/sello-sanitario-constructivo.test.ts test/informes-legacy.test.ts test/intervalos-sin-tuberia.test.ts test/pdf-historicos.test.ts test/historicos.test.ts
node --test --experimental-strip-types test/prefiltro-constructivo.postgres.local.ts
npm.cmd run build
```

El ensayo PostgreSQL requiere PostgreSQL 18 local; `RSP_PREFILTRO_PG_BIN` permite
indicar otro directorio de binarios compatible. Imprime la ruta sintética de evidencia.
Desde `front`, después de `npm.cmd run build -- --configuration development`:

```powershell
node scripts/test-prefiltro-visual.mjs '<ruta Temp rsp-prefiltro027-... impresa por el ensayo>'
```

El script visual abre un perfil Chrome temporal y captura A (sello), B (prefiltro
con filtro), C (ambos separados), D (sin prefiltro) y E (solapados). El filtro ranurado
permanece en los casos sin prefiltro para verificar que no lo crea automáticamente.

## Verificación final del grosor aprobado — 26/10/2026

- Geometría, contratos afectados y PDF: **58/58**. Se actualizó una expectativa
  que todavía exigía 0.07–0.08, sin modificar la geometría, y se agregó cobertura
  de contacto, márgenes de terreno y solapamiento con cambios de diámetro.
- Comando desde `api`:

  ```powershell
  node --test --experimental-strip-types test/prefiltro-constructivo.test.ts test/perfil-litologico.test.ts test/intervalos-sin-tuberia.test.ts
  ```

- Se regeneraron los modelos y PDF A–E desde las copias JSON sintéticas del ensayo
  anterior, sin iniciar ni consultar PostgreSQL. Preview y representación guardada
  coinciden al comparar sus datos constructivos; las identidades de filas no forman
  parte de la geometría.
- Visuales repetidas con los nuevos modelos: **30/30**, en 390, 768 y 1366 px,
  preview y perfil guardado. Etiquetas correctas, sin desbordamiento horizontal.
  Inspección de PNG web y páginas PDF renderizadas: sello solo, ambos elementos
  y solapamiento legibles; profundidades y texturas conservadas.
- Chrome tuvo un timeout de inicio dentro del sandbox; el mismo ensayo pasó fuera
  del sandbox con perfil temporal y API interceptada. Cero conexiones API reales
  y cero escrituras del ensayo. El renderizador WinRT produjo los cinco PNG;
  su proceso quedó abierto al finalizar y se interrumpió sólo esa sesión auxiliar.
- Se reutilizan las evidencias previas **PostgreSQL 10/10**, **Angular 181/181**,
  **API 84/84** y compilaciones correctas. No se repiten esas suites generales:
  en este cierre sólo cambiaron expectativas/cobertura de tests y documentación.
- Migraciones 000–026 intactas; 027 es la única nueva. `git diff --check` correcto.
  Sin cambios ajenos al alcance, secretos ni artefactos temporales en el inventario.

## Guía breve para administración

1. En alta normal, alta histórica o edición, ingresar la profundidad final conocida.
2. En **Datos técnicos → Prefiltro**, pulsar **Agregar prefiltro**.
3. Completar Desde/Hasta; agregar otros intervalos si corresponde. No cargarlo como
   litología ni sustituir el filtro ranurado.
4. Revisar los errores y las advertencias. Si coincide con el sello, comprobar los
   datos reales; el dibujo no corrige ni certifica esa coincidencia.
5. Guardar y reabrir; revisar detalle, perfil y PDF. Para quitarlo, eliminar sus filas
   y guardar. Dejar la sección vacía es válido.

## Antes de publicar o desplegar

El grosor tiene aprobación visual del propietario y revisión técnica final local.
Pendientes: autorización de push y despliegue. No se actualizó una APK ni se probó
en Android físico. Para instalar posteriormente:
respaldo y ensayo habituales, migración 027 antes de iniciar la API nueva y publicación
coordinada frontend/API. Los datos de 026 son compatibles; la API nueva requiere la
tabla 027. No ejecutar el despliegue por haber aprobado estas pruebas locales.

## Inventario de archivos

Se incluye abajo el inventario del cambio para revisión; no comprende artefactos
compilados ni imágenes sintéticas, que permanecen fuera de Git.

Modificados (30):

- `api/src/models/historicos.ts`
- `api/src/models/schemas.ts`
- `api/src/pdf/pdf-generate.ts`
- `api/src/pdf/perfil-litologico.ts`
- `api/src/routes/informes.ts`
- `api/src/services/administracion-eliminaciones-service.ts`
- `api/src/services/generar-informe-consultas.ts`
- `api/src/services/historicos-service.ts`
- `api/src/services/pozo-completo-service.ts`
- `api/src/services/pozos-services.ts`
- `api/test/intervalos-sin-tuberia.test.ts`
- `api/test/pdf-historicos.test.ts`
- `front/src/app/core/native/offline.service.ts`
- `front/src/app/core/native/offline.spec.ts`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts`
- `front/src/app/routes/pozos/components/perfil-litologico-vista-previa/perfil-litologico-vista-previa.component.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.html`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.ts`
- `front/src/app/shared/services/pozos-create.service.ts`
- `front/src/app/shared/services/pozos-edit.service.ts`
- `front/src/app/shared/types/schemas.ts`
- `front/src/app/shared/utils/datos-tecnicos-borrador.ts`
- `front/src/app/shared/utils/estado-formulario-perforacion.ts`
- `front/src/app/shared/utils/historicos-form.ts`
- `front/src/app/shared/utils/reconciliar-perforacion.ts`
- `front/src/app/shared/utils/tecnicos-persistidos.ts`

Nuevos (7):

- `api/db/migrations/027_prefiltro_constructivo.sql`
- `api/src/services/prefiltro-service.ts`
- `api/test/prefiltro-constructivo.postgres.local.ts`
- `api/test/prefiltro-constructivo.test.ts`
- `docs/PREFILTRO_CONSTRUCTIVO_Y_SELLO_SANITARIO.md`
- `front/scripts/test-prefiltro-visual.mjs`
- `front/src/app/shared/utils/prefiltro-constructivo.spec.ts`

Evidencia sintética del 26/10/2026 (fuera de Git):

- PostgreSQL y PDF A–E: `C:/Users/Raul Silva/AppData/Local/Temp/rsp-prefiltro027-ZQCmjZ`.
- Capturas web/formularios y RESULT.json: `C:/Users/Raul Silva/AppData/Local/Temp/rsp027-visual-tPv7fO`.
- Cierre con grosor definitivo, modelos y PDF/PNG A–E: `C:/Users/Raul Silva/AppData/Local/Temp/rsp-prefiltro027-cierre-yBscT1`.
- Capturas finales y RESULT.json (30/30): `C:/Users/Raul Silva/AppData/Local/Temp/rsp027-visual-feSudM`.
