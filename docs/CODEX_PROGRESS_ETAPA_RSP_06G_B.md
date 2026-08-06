# ETAPA RSP-06G-B — Correcciones de fotografía, mapa y tablas

## Resultado

Se conservan la portada, la página de ubicación, el perfil litológico y la tipografía aprobada en RSP-06G. No se modificaron la paleta, los contratos HTTP, la base de datos ni las reglas de autorización.

## Causa raíz de la fotografía

El control compartido no usaba un `input type=file`: llamaba `Camera.getPhoto()` de Capacitor con resultado URI. En navegador, ese adaptador crea la capa web del selector. La promesa no tenía `try/catch/finally`; al cancelar o fallar quedaba una excepción sin tratar y el formulario no recuperaba su flujo normal. Después, el formulario hacía `fetch(webPath)` para reconstruir un `File`, agregando otra operación asíncrona innecesaria. No había validación local de firma ni vista previa estable. El backend y el tamaño del archivo no eran la causa del bloqueo observado.

La corrección usa un selector nativo, activado por un botón accesible. Cancelar no cambia el archivo anterior ni crea loading/modal. JPEG y PNG se validan por MIME, firma binaria y máximo de 5.000.000 bytes antes de emitir el archivo. La vista previa usa `FileReader` y un data URL; no se crean object URLs que deban revocarse. El valor del input se limpia tras cada cambio para permitir seleccionar nuevamente el mismo archivo, sin listeners manuales ni duplicados. El estado `procesando` siempre se retira en `finally`.

En creación y edición, el archivo y su vista previa permanecen en el componente del formulario si falla el guardado, permitiendo reintentar. Conservar, reemplazar, cancelar reemplazo y marcar para eliminar mantienen las acciones existentes. Seleccionar una foto no llama al backend.

## Persistencia y seguridad de fotografía

Se verificaron sin cambiar contrato: `bodyLimit` de 7.500.000 bytes para compensar base64, máximo decodificado de 5.000.000 bytes, MIME y firma también validados en API, nombres derivados exclusivamente del `id_pozo`, almacenamiento protegido, transacción PostgreSQL, temporales y restauración/aislamiento ante rollback. Las pruebas cubren creación, reemplazo, eliminación, fallo transaccional y PDF posterior a eliminar.

## Mapa y motivo del fallback

El fallback local se produce por variables ausentes/vacías: `.env.example` declara las variables pero no configura proveedor. No se encontró un proveedor válido configurado y no se usaron secretos. Se distinguieron además plantilla incompleta, clave ausente, host no permitido, timeout, redirección/respuesta fallida, tipo de contenido, firma y tamaño inválidos.

La URL se construye únicamente desde la plantilla del servidor. Se validan latitud/longitud, HTTPS, host exacto, ausencia de credenciales en URL, redirección manual, timeout, tipo, firma y tamaño máximo. El cliente no puede enviar una URL. El marcador visible debe formar parte de la plantilla elegida por el administrador del proveedor.

Variables requeridas:

```dotenv
PDF_MAP_STATIC_URL_TEMPLATE=https://HOST-PERMITIDO/ruta?center={latitud},{longitud}&marker={latitud},{longitud}&key={apiKey}
PDF_MAP_ALLOWED_HOST=HOST-PERMITIDO
PDF_MAP_STATIC_API_KEY=CLAVE-DEL-PROVEEDOR
PDF_MAP_ATTRIBUTION=Atribución exigida por el proveedor
```

`{latitud}` y `{longitud}` son obligatorios. `{apiKey}` es opcional en la plantilla; si aparece, la clave es obligatoria. La plantilla concreta, parámetros de marcador, atribución, proveedor y credenciales son una decisión pendiente del usuario. No se eligió servicio externo ni se inventó una clave.

El adaptador simulado prueba imagen válida, host inválido, configuración ausente, plantilla incompleta, clave ausente, redirección, timeout, contenido no imagen, firma inválida y exceso de tamaño, sin red real.

## Fallback compacto

Sin proveedor o ante fallo, el PDF continúa con una tarjeta de 72 pt, “Mapa no disponible” y el motivo. Las coordenadas permanecen arriba y el resumen técnico sigue inmediatamente debajo. La caja anterior reservaba 285 pt. El diagnóstico de PDF registra `fallbackMapaAlto` y una prueba exige menos de 100 pt.

## Composición centralizada de tablas

`FlujoPDF.tabla` mide todas las celdas antes de dibujar. Mantiene fuente de 11 pt, interlínea de 14 pt y padding superior/inferior de 6 pt. La altura de fila depende del máximo de líneas envueltas. La línea inferior se dibuja en el borde calculado después del texto, con 9 pt efectivos desde la última línea base, evitando atravesar valores como “70 m”, “PVC” o “Acero”.

El motor reserva título, encabezado y primera fila juntos; repite el encabezado al continuar, nunca parte una fila y agrega separación entre secciones. “Sin registros” omite el encabezado vacío y usa una línea compacta. Niveles de aporte conserva la arquitectura de tabla extensible pero usa una sola columna compacta.

El diagnóstico registra altura de encabezado, alturas de filas, altura completa, posición final y páginas usadas. Las pruebas verifican padding mínimo, wrapping, tablas con/sin filtros, textos largos, multipágina, ausencia de páginas vacías y ausencia de footer.

## Pruebas y evidencia

- API build: correcto.
- API: 69 pruebas correctas.
- Frontend build: correcto.
- Frontend: 123 pruebas correctas en Chrome, sin HTTP real en specs de selección.
- Fotografía: apertura del input, cancelación, JPEG, PNG, tipo, firma, 5 MB, vista previa, reemplazo, cancelación y acción de eliminación.
- Persistencia: creación atómica, rollback sin huérfanos, reemplazo, eliminación y PDF sin foto.
- PostgreSQL local: creación con PNG, PDF, edición/reemplazo, PDF actualizado, eliminación, PDF sin foto, rollback y limpieza final correctos mediante `rsp06c.local.ts`.
- PDF/mapa: configuración y fallos simulados, fallback de 72 pt, filas medidas, filtros vacíos/con datos y multipágina.
- `api/test/rsp06gb.visual.ts` genera tres PDF reproducibles en `%TEMP%\rsp06gb-evidencias`.

Edge headless no rasterizó el contenido del visor PDF y produjo capturas en blanco; por eso no se declara inspección visual de esas capturas. Los PDF se dejan para revisión manual y la validación automatizada registrada es estructural. Karma sí ejecutó los componentes en Chrome real, pero no puede automatizar el diálogo nativo del sistema operativo; la persistencia completa se verificó directamente contra PostgreSQL local.

## Seguridad, rollback y limitaciones

Se conservaron cookies HttpOnly, CSRF, `version_sesion`, identidad de `request.user.sub`, aislamiento por propietario, autorización del perforador, autorización previa al PDF, SQL parametrizado y almacenamiento protegido. El mapa conserva controles SSRF, host permitido, HTTPS, redirects bloqueados, timeout y tamaño máximo. No se agregaron Bearer, JWT en almacenamiento, `any`, `SELECT *`, migraciones, dependencias ni secretos.

Rollback por commits nuevos: revertir los commits de esta etapa en orden inverso. No se reescribieron commits anteriores. Limitaciones pendientes: selección administrativa de proveedor/configuración de mapa; revisión manual de los PDF rasterizados; recorrido E2E autenticado con selector nativo y PostgreSQL, no automatizable en el entorno actual sin credenciales/sesión de prueba.
