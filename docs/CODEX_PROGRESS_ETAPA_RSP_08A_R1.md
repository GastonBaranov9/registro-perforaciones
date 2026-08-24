# ETAPA RSP-08A-R1 — Sincronización del editor y email de perforador

## 1. Causa del estado stale

El formulario conservaba por separado el ID seleccionado en `pozo().id_propietario` y el último objeto recibido en `propietarioSeleccionadoDatos`. Al abrir el editor se priorizaba ese objeto cacheado sin comprobar su ID. Después de cambiar de A y crear o seleccionar B, el editor podía mostrar A mientras el guardado enviaba el ID de B.

## 2. Fuente de verdad elegida

El ID actual de `pozo().id_propietario` es la fuente de verdad. Al abrir el editor se busca primero ese ID en el catálogo vigente; el objeto cacheado sólo se admite si su `id_usuario` coincide exactamente. El estado editable guarda juntos `id_usuario` y `body`, de modo que la identidad y los datos forman una sola unidad.

## 3. Sincronización A→B

Seleccionar una persona sincroniza ID, objeto seleccionado y cierre del editor anterior. `CAMBIAR` limpia ID, cache y edición. Registrar un propietario limpia cualquier referencia previa y, cuando el padre incorpora el DTO creado al catálogo y selecciona su ID, la próxima apertura se resuelve desde ese nuevo objeto.

Quedan cubiertas las transiciones A→B, A→nuevo B, B→A, múltiples alternancias y selección→vacío. En el caso crítico, B con sólo nombre abre con sus opcionales vacíos y A no participa en el request.

## 4. Guardado defensivo

Antes de emitir la actualización se compara `editor.id_usuario` con el ID actualmente seleccionado. Si difieren, el componente falla cerrado: descarta el editor, no emite ninguna mutación y muestra un mensaje seguro para reabrirlo. Cancelar también descarta el borrador; reabrir vuelve a leer al propietario actual.

## 5. Causa del email de perforador

La consulta de candidatos buscaba el email condicionalmente por rol, pero el `SELECT` proyectaba siempre `u.propietario_email`. Así, una fila de perforador encontrada por `u.email` llegaba al frontend sin su email de login y podía ser eliminada por el filtro local.

## 6. Distinción login email/contact email

La proyección ahora usa la misma regla que la búsqueda:

- rol `perforador`: devuelve `u.email`, email existente de cuenta/login;
- rol `propietario`: devuelve `u.propietario_email`, dato operativo de contacto.

Se probó explícitamente un perforador cuyo email de login y email de contacto son diferentes. No se modificaron autenticación, cuentas, passwords, roles, sesiones ni `/usuarios`.

## 7. Tests y validaciones

- Frontend focalizado: 25 pruebas correctas.
- Frontend completo: 197 pruebas correctas.
- Frontend production build: correcto.
- API focalizada, incluyendo `/usuarios`: 15 pruebas correctas.
- API completa: 267 pruebas correctas.
- API TypeScript build: correcto.
- Búsqueda de un carácter, límite 20 y orden estable: preservados.
- Migración 007: sin cambios; no se creó migración nueva.
- Auth, PDF, padrón, permisos y semántica `NULL`: sin cambios.

## 8. Hallazgos cerrados

Se cerraron exclusivamente los dos P2 del review: editor de propietario con identidad stale y pérdida del email de login en candidatos perforadores. No se añadieron funcionalidades nuevas ni cambios de infraestructura.
