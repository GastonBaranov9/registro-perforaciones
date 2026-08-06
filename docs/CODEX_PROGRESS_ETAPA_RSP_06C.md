# ETAPA RSP-06C — selectores de personas y edición técnica completa

## Problema anterior y auditoría

Creación y edición escribían `id_propietario` e `id_perforador` en controles numéricos. El único listado de usuarios era `/usuarios`, reservado a administración y deliberadamente demasiado amplio para un perforador. Los datos públicos existentes son ID, nombre, email, activo y roles; password y `version_sesion` permanecen fuera de `UsuarioPublico`.

Administración y perforadores pueden crear/modificar pozos. La regla vigente impide que un perforador asigne otro `id_perforador`; administración sí puede elegir. Propietarios conservan lectura y no reciben catálogos globales ni mutaciones. La edición anterior actualizaba solo la fila `pozo` y luego subía una foto en una segunda operación; litología, diámetros y aportes seguían en pantallas separadas.

## Catálogos y selectores

`GET /pozos/candidatos-personas` devuelve exclusivamente `{id_usuario,nombre,email,roles}` de cuentas activas. Propietarios candidatos tienen rol `propietario`. Administración obtiene perforadores activos; un perforador recibe únicamente su propia identidad si continúa activo y con el rol, evitando exposición administrativa innecesaria. La ruta exige sesión cookie-only y rol administración/perforador; un propietario recibe denegación.

El componente compartido `selector-persona-pozo` busca localmente por nombre o email, presenta nombre, email e ID auxiliar, compara y persiste solo `id_usuario`, distingue nombres duplicados y usa botones nativos accesibles por teclado. Expone selección actual, coincidencias vacías y avisa si la cuenta elegida quedó inactiva o perdió el rol. Creación ofrece carga, error y REINTENTAR y bloquea el envío hasta contar con candidatos válidos.

## Editor compartido

`pozos-form` contiene los datos generales, ambos selectores y las acciones de foto. `datos-tecnicos-borrador` es el mismo editor tipado para creación y edición, recibe estado inicial y conserva IDs exclusivamente locales. En edición se cargan en paralelo con `Promise.all`: pozo, candidatos, litología, diámetros y aportes. El formulario no aparece incompleto; durante carga hay indicador y ante fallo se muestra el error vigente y RECARGAR.

Las mismas utilidades validan creación y edición: finitud, `desde >= 0`, `hasta > desde`, profundidad oficial, solapamientos por categoría y aportes independientes. Reducir profundidad bloquea sin borrar filas. Doble envío retorna inmediatamente y un error mantiene el borrador.

## Actualización transaccional

`PUT /usuarios/:id_usuario/pozos/:id_pozo/completo` recibe el mismo bloque técnico que creación y `foto_accion: conservar|eliminar|reemplazar`. La identidad efectiva siempre es `request.user.sub`; `id_usuario` de URL no concede permisos. Primero se aplica `pozoIsFromUser`, que devuelve 404 genérico también para un perforador ajeno, y luego el rol de escritura.

La API valida todo antes del primer DELETE, abre transacción, bloquea el pozo `FOR UPDATE`, toma advisory lock por pozo y bloquea candidatos elegidos contra cambios concurrentes de actividad/rol. Actualiza columnas explícitas, reemplaza los tres conjuntos hijos mediante DELETE limitado por `id_pozo` e INSERT parametrizado, y ejecuta COMMIT. Cualquier fallo produce ROLLBACK, por lo que permanecen padre e hijos anteriores. IDs locales o IDs persistidos de intervalos no participan en la operación y no pueden mover filas de otro pozo.

## Fotografía

En edición la foto actual no se borra al pulsar ELIMINAR: queda marcada hasta guardar. Puede conservarse, eliminarse, reemplazarse o cancelarse el cambio. El backend deriva el nombre desde `id_pozo`, valida JPEG/PNG y 5 MB, mueve la anterior a `.trash`, escribe mediante temporal exclusivo y actualiza la referencia dentro de la transacción. En rollback elimina el reemplazo y restaura la anterior; un fallo de restauración se informa expresamente. Tras COMMIT purga el aislado. No recibe nombres ni rutas del cliente.

## Seguridad

Se conservan cookies HttpOnly, CSRF global, `version_sesion`, ausencia de Bearer/JWT en almacenamiento, archivos protegidos y autorización por relación persistida. Las consultas nuevas enumeran columnas, usan parámetros y no exponen hashes, passwords ni versión de sesión. Creación y edición revalidan existencia, actividad y rol de ambas personas dentro de la transacción; un perforador no puede seleccionar a otro.

## Archivos y endpoints

- API: `models/schemas.ts`, `routes/pozos.ts`, `services/candidatos-pozo-service.ts`, `services/pozo-completo-service.ts`, ajuste 404 en `plugins/jwt.ts`.
- Web: `selector-persona-pozo.component.*`, `candidatos-pozo.service.ts`, `pozos-form.component.*`, `datos-tecnicos-borrador.component.*`, páginas create/edit, `pozos-edit.service.ts` y tipos.
- Endpoints nuevos: `GET /pozos/candidatos-personas`; `PUT /usuarios/:id_usuario/pozos/:id_pozo/completo`.
- Las rutas técnicas y DELETE de foto anteriores permanecen disponibles para mantenimiento posterior.

## Pruebas y evidencia local

- API: 49/49 y build correcto; incluye candidatos, rol/actividad inválidos, actualización, reemplazo de hijos, rollback, profundidad, foto conservada/eliminada/reemplazada y seguridad heredada.
- Frontend: 104/104 y build correcto; selectores por nombre/email/ID, vacío, contrato limitado, editor en memoria, foto diferida, payload sin IDs locales, doble envío y preservación ante error. La suite no usa HTTP ni WebSocket reales.
- `rsp06c.local.ts` creó dos propietarios y dos perforadores temporales activos, comprobó catálogos por rol/ID, creó y editó un pozo completo, modificó sus tres recursos técnicos, reemplazó y eliminó foto, generó PDF, rechazó una cuenta inactiva y confirmó rollback de profundidad inválida. Finalmente eliminó pozo, hijos, cuatro cuentas y archivos. Verificación posterior: cero pozos y cero usuarios temporales.

## PDF, perfil y caché

La actualización reemplaza las filas reales consultadas por detalle, perfil e informe; después del éxito se navega al detalle del pozo, que vuelve a obtener recursos. El PDF controlado se generó tras editar y tras eliminar la fotografía. No se añadieron cachés y permanecen el modelo visual único, huecos y paginado de RSP-06.

## Limitaciones, despliegue y rollback

- La búsqueda filtra en cliente el catálogo funcional ya limitado. Para volúmenes extremos puede evolucionar a búsqueda paginada de servidor sin cambiar la identidad por ID.
- PostgreSQL no posee constraints de exclusión para rangos; los endpoints compuestos validan y serializan por pozo. Escrituras externas deben respetar la regla.
- Como en RSP-06B, una caída abrupta durante operaciones de filesystem puede dejar un archivo aislado no servido en `.trash`; nunca queda como URL de otro pozo y puede purgarse operacionalmente.
- No hay migraciones ni dependencias. Desplegar API y frontend juntos. Para rollback, revertir los commits RSP-06C en orden inverso; no hay transformación de datos.
