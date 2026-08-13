# ETAPA-RSP-06I-R6 — Huecos litológicos y separación PDF

## Alcance y causa del editor

El bloqueo estaba en `sugerirInicioSiguienteIntervalo`: ordenaba los intervalos, tomaba el `hasta_m` del último y rechazaba la acción cuando ese valor alcanzaba la profundidad final. Por eso un perfil `0–5`, `10–40`, `40–100` se consideraba sin lugar para agregar aunque conservara el hueco interno `5–10`.

La nueva regla separa dos conceptos:

- que el último intervalo llegue a la profundidad final;
- que la unión de todos los intervalos cubra efectivamente desde 0 hasta la profundidad final.

Solo el segundo representa cobertura completa. El mensaje anterior fue reemplazado por `El perfil litológico cubre toda la profundidad.` y se usa únicamente cuando no hay huecos, solapamientos ni rangos inválidos.

## Análisis puro de cobertura

`analizarCoberturaIntervalos` recibe la profundidad y un array de solo lectura. Crea y ordena una copia por `desde_m`/`hasta_m`, recorre la cobertura acumulada y devuelve:

- huecos iniciales, internos y finales;
- solapamientos, incluso cuando un intervalo está contenido dentro de otro;
- índices inválidos;
- `coberturaCompleta`.

El helper no muta el array recibido. La acción litológica rechaza primero rangos inválidos o solapamientos y, si existe cobertura incompleta, precarga `Desde` y `Hasta` con el primer hueco. Si aún no se definió profundidad final conserva la creación editable histórica. Tuberías y filtros no cambiaron.

El guardado históricamente permite perfiles con huecos; R6 no introdujo una obligatoriedad nueva. Las reglas de rango, profundidad y ausencia de solapamientos continúan activas en frontend y backend.

## Caso manual e identidad

El caso persistido `0–10`, `10–40`, `40–100` se cubrió expresamente. Tras editar el primer tramo a `0–5`, “Agregar intervalo” permanece habilitado y crea una fila local nueva precargada `5–10`. El orden resultante es `0–5`, `5–10`, `10–40`, `40–100`.

La fila editada conserva su `id_intervalo_litologico` en el borrador y la fila `5–10` nace sin ID persistido, sin material inferido y exige una litología elegida por el usuario. El update HTTP conserva las asociaciones de catálogo A/D/B/C, persiste cuatro IDs únicos y asigna al nuevo tramo un ID que no reutiliza ninguno de los tres IDs iniciales. No se relajó la validación de solapamientos.

## Causa y contrato de layout PDF

El ajuste anterior restaba entre 5 y 9 pt al cursor y dibujaba el título usando esa posición como línea base. La altura ascendente de la fuente de 12 pt ocupaba casi toda esa separación; por eso el hueco visible entre el borde inferior y el tope real del título quedaba cercano a cero.

R6 centraliza el contrato en `iniciarSeccionTecnica` y mide la caja tipográfica real con `PDFFont.heightAtSize`:

- 10 pt desde el fondo real de la tabla/bloque anterior hasta el tope real del título;
- 6 pt desde el fondo real del título hasta el comienzo de la tabla o texto siguiente.

Esos valores forman parte de `medirTabla`, de la reserva previa y del salto a continuación. El cursor de una tabla queda exactamente sobre su borde inferior; el cursor de `Sin registros` queda en el fondo tipográfico real. No se agregaron decrementos dispersos ni se redujo la fuente mínima, que continúa en 9 pt.

El diagnóstico reproducible registra `tituloTop`, `tituloBottom`, `contenidoTop`, `bordeInferiorFinal`, página y gaps. En el caso normal se midieron 10 pt entre Litología/Tuberías y Tuberías/Filtros; con filtros vacíos se midieron 10 pt entre el fondo de `Sin registros` y Niveles de aporte. Todos los títulos registraron 6 pt posteriores. No se declara rasterización visual automatizada: la evidencia entregada es métrica y determinista.

## Pruebas y evidencia

- Frontend focalizado: helper 14/14 y componente 8/8. Incluye completo, hueco interno tras `0–10 → 0–5`, relleno `5–10`, huecos inicial/final/múltiples, entrada desordenada sin mutación, solapamiento, rango inválido, botón disponible e ID local nuevo.
- PDF focalizado: 15/15 entre composición existente y R6; cubre pequeño, normal, cargado, campos largos, continuación, `Sin registros`, límites del área útil, fuente mínima y gaps reales.
- API final: build correcto y suite completa 142/142.
- Frontend final: `check:utf8`, build y suite completa 156/156.
- No se ejecutaron builds Docker porque los cambios no modifican imágenes, dependencias ni configuración de contenedores.

La evidencia HTTP/PostgreSQL real produjo: POST 201; intento solapado 400 sin alterar los tres intervalos originales; PUT válido 200; cuatro intervalos ordenados; cuatro IDs únicos; litologías A/D/B/C; reapertura HTTP idéntica; consulta PostgreSQL idéntica. El `finally` eliminó pozo y sitio, y la consulta posterior confirmó `0|0` registros R6.

## Commits

- `82050c9 fix(front): permitir completar huecos del perfil litologico`
- `245ab0b test(front): cubrir deteccion de huecos litologicos`
- `8a432ec fix(pdf): corregir separacion entre secciones tecnicas`
- `e35c131 test(pdf): cubrir gaps reales entre bloques`
- `eff2bdd test(api): cubrir persistencia de huecos litologicos`
- `c00c82a fix(pdf): completar diagnostico de layout`
- `docs: cerrar RSP-06I-R6` contiene este documento.

HEAD de implementación validada antes del commit documental: `c00c82a`. Tras crear el commit documental se verifican nuevamente el HEAD final, `git diff --check` y el árbol limpio; el hash final se informa en el reporte de cierre.
