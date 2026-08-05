# ETAPA RSP-06D — Ajustes de carga y diseño PDF

## Resultado

Se completó la continuidad sugerida de intervalos, se sustituyó el aporte circular aislado por una banda acuífera canónica y se integró la fotografía en una portada A4 de dos columnas. Creación y edición conservan el mismo editor y el perfil web/PDF sigue derivando de `crearPerfilLitologico`.

## Continuidad de intervalos

La función pura `sugerirInicioSiguienteIntervalo` recibe los intervalos en memoria y la profundidad oficial. Para la primera fila devuelve 0; para las siguientes ordena rangos válidos y propone el mayor `hasta_m`. El campo continúa editable y `hasta_m` nace vacío (`NaN` en el modelo de formulario, no enviado al backend hasta ser válido).

La función no modifica filas, no rellena huecos ni corrige datos. Un rango inválido, solapado, fuera de profundidad o que ya termina en la profundidad final bloquea la deducción y conserva el mensaje de validación. La usan el editor compartido de creación/edición y las páginas técnicas independientes de litología y diámetro. `nivel_aporte` es puntual y no usa `desde/hasta`.

## Representación acuífera

La tabla real `nivel_aporte` persiste únicamente `profundidad_m`; no existen rango ni caudal. Cada aporte se normaliza como evento puntual con una banda azul estrecha centrada en su profundidad. La geometría canónica define extensión normalizada 0,05–0,95, espesor mínimo de 8 px y patrón `ondas`, además de las posiciones normalizadas de exterior, espacio anular e interior de tubería.

Angular dibuja la banda mediante SVG declarativo y patrón seguro; `pdf-lib` reproduce la misma extensión y profundidad con líneas onduladas estáticas. Los contornos de tubería se redibujan encima, de modo que el aporte atraviesa las tres zonas sin ocultar sus límites. Se conservan círculo y etiqueta lateral, leyenda “Aporte de agua” y tabla accesible. El patrón mantiene significado en escala de grises. No se usa `innerHTML`.

## Portada PDF

Antes, la fotografía se añadía al flujo inferior y podía quedar prácticamente sola después de un salto de página. Ahora la primera página contiene:

- encabezado, título e identificación del pozo;
- datos principales a la izquierda y fotografía en un marco sobrio a la derecha;
- ajuste proporcional por el mínimo de ancho y alto disponibles, válido para orientación vertical y horizontal;
- pie de foto y continuidad de características debajo de la caja;
- ancho completo de datos cuando no existe fotografía.

El envoltorio de texto ya no trunca a tres líneas: divide también palabras excepcionalmente largas y crea una página de continuación si falta altura. Las páginas nuevas repiten encabezado y todas reciben pie con fecha y numeración después de incorporar el perfil. Tablas, fotografía opcional, intervalos, aportes y perfil multipágina permanecen en el informe.

## Arquitectura y archivos

- `front/src/app/shared/utils/datos-tecnicos-borrador.ts`: cálculo puro de continuidad.
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/*`: uso compartido en creación y edición.
- páginas `intervalos-litologicos-create` e `intervalos-diametros-create`: reutilización en mantenimiento técnico.
- `api/src/pdf/perfil-litologico.ts`: geometría semántica de aportes y adaptador PDF.
- `front/src/app/shared/components/perfil-litologico/*`: adaptador SVG, leyenda y tabla accesible.
- `front/src/app/shared/types/schemas.ts`: contrato canónico tipado.
- `api/src/pdf/pdf-generate.ts`: portada, ajuste de imagen, texto y pies.
- `api/test/pdf-portada.test.ts`, `api/test/rsp06d.visual.ts` y pruebas existentes: regresión y evidencia reproducible.

No cambiaron endpoints, tablas, migraciones ni dependencias.

## Pruebas y evidencia

Cobertura automatizada añadida:

- primer intervalo, continuidad 0–10–20, orden lógico, hueco manual, eliminación, solapamiento, rango inválido y profundidad final;
- uso del mismo editor en creación y edición y posibilidad de modificar el valor sugerido;
- aporte puntual, dos profundidades, capa fina, límite de estrato, geometría determinista, leyenda y tabla accesible;
- portada sin foto, foto vertical, foto horizontal, datos extensos, foto eliminada e informe con perfil multipágina.

`api/test/rsp06d.visual.ts <directorio>` genera HTML de continuidad y PDF sin foto/con foto vertical/con foto horizontal. `api/test/perfil-litologico.visual.ts <directorio>` genera perfiles web y PDF mínimo/multipágina. En `%TEMP%/rsp06d-evidencias` se verificó:

- formulario 0–10 y siguiente inicio 10;
- banda ondulada cruzando formación y tubería, con contornos y etiqueta visibles;
- 40 capas, dos aportes y cinco páginas de perfil;
- las tres portadas cargan como PDF válido; las variantes con fotografía poseen imagen en la primera página y no agregan una página vacía.

Chrome headless rasterizó correctamente los HTML. Su visor PDF produjo una captura oscura sin contenido, limitación ya observada en RSP-06; por ello la portada se verificó estructuralmente con `pdf-lib`: A4, conteo de páginas, XObject de imagen en página 1, generación con ambas orientaciones y ausencia de página adicional. Los artefactos quedan disponibles para apertura manual en el directorio temporal, pero no se versionan.

## Seguridad

No se tocaron autenticación ni autorización. Se conservan cookies HttpOnly, CSRF, `version_sesion`, aislamiento por propietario, autorización de perforador, archivos protegidos y autorización previa a generar bytes PDF. No se añadieron Bearer, JWT en almacenamiento, SQL, `SELECT *`, `any`, dependencias ni migraciones.

## Validación final

- Build API: correcto.
- Pruebas API: 52/52.
- Build frontend: correcto.
- Pruebas frontend: 108/108.
- `git diff --check`: correcto.
- Inspección HTML: continuidad y perfil con aportes correctos.
- PDF: portadas y perfil multipágina válidos estructuralmente.

## Limitaciones reales

- El modelo persistido solo admite aportes puntuales. La geometría tipada distingue `tipo: puntual` y está preparada para ampliar el contrato, pero no representa rangos ni caudales inexistentes.
- La rasterización PDF automatizada no está disponible en las herramientas locales usadas; la revisión visual final de impresión puede hacerse abriendo los artefactos reproducibles.
- La sugerencia es una ayuda de formulario. El backend continúa siendo la autoridad y rechaza rangos inválidos o solapados.

## Despliegue y rollback

API y frontend deben desplegarse juntos por la ampliación del contrato visual. No hay migraciones ni tareas de datos. Para rollback, revertir los commits de RSP-06D en orden inverso y desplegar nuevamente ambos artefactos; los datos persistidos permanecen compatibles.
