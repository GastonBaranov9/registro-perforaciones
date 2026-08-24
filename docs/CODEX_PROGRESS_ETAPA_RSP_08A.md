# ETAPA RSP-08A — Datos ampliados de propietario y padrón de sitio

## 1. Modelo final de propietario

El propietario operativo continúa representado por un registro de `usuario` con rol `propietario`, pero no es una cuenta de acceso. Se reutiliza el campo `nombre` existente y la interfaz lo presenta como **Nombre y apellido**. Se agregaron `documento_rut`, `telefono`, `propietario_email`, `direccion`, `localidad`, `departamento` y `observaciones`.

El email de contacto se guarda deliberadamente en `propietario_email`; no reutiliza el email de autenticación. Crear un propietario mantiene `email = NULL`, `password = NULL`, `cuenta_acceso = FALSE`, no crea sesión y sólo asigna el rol operativo `propietario`. La administración en `/usuarios` conserva su filtro de cuentas de acceso.

## 2. Razón de padrón en sitio

`padron` pertenece a `sitio`, no a `usuario`: una misma persona puede ser propietaria de varios sitios con padrones diferentes. Se almacena como texto opcional para conservar ceros, separadores y representaciones no estrictamente numéricas. No se agregó unicidad.

## 3. Migración 007

La migración canónica `007_datos_propietario_padron_sitio.sql` agrega columnas anulables sin defaults ni backfill y un `CHECK` para el catálogo de departamentos. No modifica las migraciones 000..006.

Se validaron tres recorridos:

- base nueva: aplica exactamente 000..007;
- base en 006: aplica únicamente 007 y preserva el prefijo del ledger con sus checksums;
- segunda ejecución: no-op.

Los registros históricos mantienen su nombre y reciben `NULL` en los campos nuevos. Los sitios históricos reciben `padron = NULL`.

## 4. Campos requeridos y opcionales

`nombre` continúa obligatorio y admite hasta 160 caracteres. Son opcionales y se normalizan de blank/whitespace a `NULL`: documento/RUT (80), teléfono (80), email de contacto (254), dirección (300), localidad (160), departamento y observaciones (2000). El padrón del sitio es opcional, textual y admite hasta 80 caracteres.

El backend valida tipos, límites, nombre no vacío, estructura razonable de email y catálogo de departamento. Los objetos y arrays son rechazados por los schemas Fastify. Un update conserva campos omitidos y permite limpiar un opcional enviando `null`, cadena vacía o whitespace.

## 5. Catálogo de departamentos

El catálogo controlado contiene los 19 departamentos de Uruguay con sus tildes UTF-8: Artigas, Canelones, Cerro Largo, Colonia, Durazno, Flores, Florida, Lavalleja, Maldonado, Montevideo, Paysandú, Río Negro, Rivera, Rocha, Salto, San José, Soriano, Tacuarembó y Treinta y Tres.

Backend y frontend tienen constantes tipadas en sus respectivos límites de aplicación. El backend vuelve a validar independientemente de la selección visual y la base agrega la restricción final. El selector permite “Sin especificar”.

## 6. API

Se amplió `POST /pozos/propietarios` y se agregaron `GET` y `PUT /pozos/propietarios/:id_propietario`. Las respuestas exponen los datos operativos, nunca credenciales. La actualización implementa semántica parcial: un campo omitido se preserva y un opcional blank se limpia.

Los DTO de sitio, el alta/edición standalone autorizada y el alta atómica sitio nuevo + pozo nuevo transportan `padron`. El detalle de pozo incorpora los datos ampliados del propietario y el padrón dentro del sitio.

## 7. Frontend

El formulario embebido de propietario incorpora Nombre y apellido, Documento/RUT, Teléfono, Email, Dirección, Localidad, Departamento y Observaciones. Usa límites alineados con la API, email tipado, selector de departamento y textarea multilinea. Los valores `NULL` se cargan como controles vacíos y el estado de guardado evita doble envío.

Se permite editar los datos del propietario seleccionado sin pasar por administración de cuentas. El detalle del pozo presenta identificación, contacto, ubicación y observaciones sin `innerHTML` ni valores `null` visibles.

Los formularios de sitio nuevo y existente incorporan Padrón. El listado y el detalle usan el padrón como dato humano, nunca el ID interno como sustituto. Se mantuvieron el preview del mapa, las coordenadas pending/persistidas, cancelación y el retorno al borrador del pozo.

## 8. Búsqueda

La búsqueda remota conserva un carácter como mínimo, blank sin consulta, debounce de 300 ms y límite 20. Para propietarios busca por nombre, documento/RUT, teléfono y email de contacto, con orden estable por nombre, documento e ID. El selector muestra nombre y, si existe, Documento/RUT; no expone observaciones, direcciones ni IDs como información principal. El selector de perforadores conserva su email habitual.

## 9. Permisos

Se preservó el contrato existente de admin/perforador para crear, leer, buscar y editar datos operativos de propietarios. Esto no concede administración de usuarios, roles, passwords, activación ni sesiones.

El perforador sigue sin poder crear sitios standalone. Puede enviar padrón únicamente en el flujo atómico autorizado de sitio nuevo + pozo nuevo. El administrador mantiene el alta standalone. Las restricciones existentes de sitio manejable y aislamiento por rol no cambiaron.

## 10. Compatibilidad histórica

No cambiaron IDs, relaciones ni el campo de nombre preexistente. Los nuevos opcionales no se exigen al editar pozos históricos. `/usuarios` continúa mostrando cuentas reales y los selectores operativos continúan encontrando propietarios sin cuenta.

Los scripts de regresión que comprueban la cantidad y versión máxima del ledger fueron actualizados de 000..006 a 000..007; no se alteró la infraestructura de migración, backup, restore, readiness ni despliegue.

## 11. PDF

El PDF ya incluía propietario y sitio, por lo que su bloque de ubicación agrega de forma compacta nombre, Documento/RUT, teléfono, email y padrón cuando existen. Los opcionales nulos se omiten y los valores extensos se ajustan a una sola línea para evitar desborde.

No se rediseñó el informe. Los espacios técnicos congelados permanecen en 20 antes del título y 7 después, cubiertos por regresión.

## 12. Validaciones ejecutadas

- API TypeScript build: correcto.
- Suite API completa: 265 pruebas correctas.
- Frontend build: correcto.
- Suite frontend ChromeHeadless: 191 pruebas correctas.
- Configuración frontend: 3 pruebas correctas.
- Frontend production build y contrato same-origin: correctos.
- Migración fresh, upgrade 006→007 y rerun no-op: correctos.
- PDF y espaciado técnico: correctos dentro de la suite API.
- UTF-8: correcto.
- `git diff --check`: sin errores de whitespace.
- Revisión de logging: no se agregaron logs de documento, teléfono o email de contacto.

## 13. Pendientes encontrados

No quedan pendientes funcionales de RSP-08A. Android Auth P2-10 continúa fuera de alcance. No se ejecutó despliegue, push, merge, rebase, reset, clean ni cambio de rama.
