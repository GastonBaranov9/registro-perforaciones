# Numeración y reingreso administrativo (024)

## Alcance y regresión corregida

023 sustituyó `RectificacionNumeracionComponent` por `ReservasEliminadasComponent`
y convirtió el POST de rectificación en un 409 incondicional. La pantalla vuelve a
mostrar tres herramientas complementarias: configuración del próximo automático,
rectificación excepcional y administración individual de reservas. No se retira
ninguna protección de eliminación de 023 ni se habilitan eliminaciones antiguas.

La configuración exige motivo de 10–1000 caracteres y muestra valor anterior/nuevo.
Registra administrador, fecha, valores y motivo; su historial queda protegido contra
UPDATE/DELETE/TRUNCATE. Las entradas anteriores conservan motivo NULL: no se inventa
una justificación retroactiva. No se admite retroceso directo ni un número ocupado.

La rectificación vuelve a admitir hasta 100 reservas **finales consecutivas** desde
3282. Exige evidencia de eliminación normal, ausencia de registros/referencias y de
documentos archivados, declaración de pruebas sin referencias externas, motivo y
`RECTIFICAR`. Usa desafío firmado de cinco minutos ligado al actor, operación,
número inicial y estado revisado. El nonce, las confirmaciones y las reservas
originales se archivan en `numeracion_rectificacion`. Cambios concurrentes,
confirmaciones antiguas y rangos con huecos se rechazan. No se rehabilita el contrato
inseguro anterior: los clientes deben aportar el desafío nuevo.

## Volver a ingresar una perforación histórica eliminada

Desde la consulta individual: **Revisar reingreso histórico** abre el formulario
existente **Nueva perforación histórica**, sin duplicar su lógica de datos técnicos,
fotografías o guardado. También se puede acceder con `?reingresar=<número>`;
ese parámetro sólo selecciona una consulta, nunca autoriza una escritura.

1. GET `/pozos/historicos/reingreso/:numero`, exclusivo de administradores activos,
   comprueba reserva, ID anterior, registros activos, referencias e historial.
2. Las referencias históricas se consideran informativas sólo si coinciden en
   número, origen histórico e identidad original (o cadena anterior auditada).
   Una referencia ambigua/ajena, resultado offline, documento o informe incompatible
   bloquea la operación. Una reserva inexistente o un registro activo también bloquean.
3. Se muestran ID original y fecha de asignación, antecedentes y motivos de bloqueo.
   Se exige motivo, declaración sobre nueva carga administrativa de la misma
   perforación física o sustitución justificada, ausencia de documentación externa
   incompatible/sincronizaciones pendientes y `REINGRESAR <número>`.
4. La confirmación local no escribe ni libera nada. Al guardar, el POST histórico
   existente recibe `reingreso` junto con datos manuales, clave idempotente y época.
5. El servidor verifica nuevamente administrador/sesión/época; toma el bloqueo
   administrativo y el del contador, revalida estado y firma. Sustituye la reserva,
   crea el pozo con ID nuevo, sus hijos, foto, resultado idempotente y auditoría en
   una misma transacción. Nunca deja un número disponible entre ambos pasos.
6. `reingreso_historico` conserva ID anterior/nuevo, reserva original y nueva, fecha
   original, referencias, actor, motivo, confirmaciones, nonce y clave de operación.
   Es inmutable y no tiene FK que puedan borrar evidencia en cascada.

El GET no modifica datos ni consume el desafío. Este dura cinco minutos; un reinicio
de API lo invalida. El nonce es de un solo uso y se consume sólo al confirmar toda la
transacción. Se mantiene la compensación de fotografías del creador histórico.
Los archivos del ID eliminado permanecen privados; no se restauran, sirven ni borran
automáticamente. No hay nueva política de purga: mantienen la retención de evidencia
definida en `ADMINISTRACION_ELIMINACIONES.md` y están incluidos en el backup integral.

Sólo se permite el rango histórico 1–3281. El caso ficticio 3277/ID 19 se prueba sin
condicionales específicos en el código funcional. Reingresarlo no cambia el próximo
automático 3282. La administración individual de liberación sigue tratando las
referencias históricas como bloqueantes: el reingreso controlado es una operación
distinta, no una forma de liberar números para cualquier alta.

## Idempotencia e intento pendiente

`creacion_historica` original no se borra, modifica ni reasigna. Su clave sigue
identificando exclusivamente su resultado original: si ese pozo ya no existe,
devuelve conflicto y nunca el pozo nuevo. El nuevo guardado tiene otra identidad
interna y su propio resultado idempotente.

Un intento rechazado sin resultado puede conservar **la misma clave, época, datos y
foto** y adjuntar la autorización. El servidor comprueba la clave antes de escribir;
si ya corresponde a otra operación, rechaza el cambio. No se generan claves nuevas
automáticamente para esquivar conflictos. Tras un error de red se reenvía exactamente
la solicitud conservada; un resultado confirmado se devuelve sin nueva escritura,
incluso si expiró el desafío. Renovar sólo el token no altera la huella de esa carga.
Cambiar su motivo o contenido después de preparar/enviar la operación se rechaza.

SessionStorage conserva metadatos y payload sin el base64; IndexedDB conserva la foto
por servidor/actor/clave. La pantalla recupera y muestra los datos pendientes. Cancelar
no borra la carga ni escribe en servidor. La sesión debe ser la misma; otra carga
pendiente no se reemplaza. Una época distinta requiere revisión, no envío silencioso.
No se promete recuperar borradores de otro navegador/dispositivo. No se accedió al
borrador del navegador productivo durante este desarrollo.

## Actualización, respaldo y límites

`024_reingreso_historico_y_numeracion.sql` sólo agrega estructura. No toca reservas,
contador, referencias ni auditorías previas; 000–023 permanecen intactas. Debe aplicarse
antes de iniciar el backend nuevo, mediante el despliegue coordinado habitual con
respaldo integral. No ejecutar un backend anterior contra nuevas operaciones sin
evaluar su compatibilidad: no se autoriza rollback de datos automático.

El backup formato 2 ya incluye todas las tablas/secuencias y todo el volumen de
persistencia. No se cambia su formato ni sus scripts. Se ensaya dump/restore a otra
base descartable, igualdad de tablas/secuencias, vigencia de triggers de auditoría
y conservación de fotografías con SHA-256. No se restaura producción.

El sistema no puede detectar PDFs entregados ni copias offline fuera del servidor:
la declaración del administrador sigue siendo obligatoria. Si los antecedentes son
ambiguos o hay documentos incompatibles, debe revisarlos antes de continuar.

## Pruebas focalizadas

Desde `api`:
- `node --experimental-strip-types test/reingreso-historico.postgres.local.ts`
- `node --experimental-strip-types test/rectificacion-numeracion.postgres.local.ts`
- `node --experimental-strip-types test/administracion-eliminaciones.postgres.local.ts`
- `node node_modules/typescript/bin/tsc --noEmit`

Los clústeres son nuevos en Temp, con puerto loopback aleatorio y datos ficticios;
comprueban su directorio de datos antes de operar y se detienen al terminar. Se
conservan sus evidencias. Las pruebas Angular afectadas cubren las tres herramientas,
motivos, confirmación, cancelación, doble envío, cambio de sesión, renovación,
respuesta perdida y recarga de fotografía desde IndexedDB.

Resultados del cierre local: PostgreSQL reingreso/024 **20/20**, seguridad de
eliminaciones **20/20**, rectificación **11/11**. Frontend: conjunto afectado **62/62**
y comprobación final de reingreso **8/8** (incluye dos casos adicionales; no son
70 pruebas distintas). TypeScript, compilación Angular de producción y
`git diff --check` correctos. Advertencias de recursos Stencil/Ionicons sin fallos
de compilación ni de pruebas. La restauración incluye historial previo con motivo
NULL y auditorías nuevas, sin reescribir justificaciones anteriores.

## Archivos incluidos en este cambio local

- `api/db/migrations/024_reingreso_historico_y_numeracion.sql`
- `api/src/models/historicos.ts`
- `api/src/routes/historicos.ts`
- `api/src/routes/numeracion-perforacion.ts`
- `api/src/services/confirmacion-numeracion.ts`
- `api/src/services/reingreso-historico-service.ts`
- `api/src/services/historicos-service.ts`
- `api/src/services/numeracion-perforacion-service.ts`
- `api/src/services/rectificacion-numeracion-service.ts`
- `api/src/services/administracion-eliminaciones-service.ts`
- `api/test/reingreso-historico.postgres.local.ts`
- `api/test/rectificacion-numeracion.postgres.local.ts`
- `api/test/numeracion-perforacion-postgres.local.ts`
- `api/test/administracion-eliminaciones.postgres.local.ts`
- `front/src/app/shared/services/reingreso-historico.service.ts`
- `front/src/app/shared/services/numeracion-perforacion.service.ts`
- `front/src/app/shared/services/numeracion-perforacion.service.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.ts`
- `front/src/app/routes/pozos/pages/numeracion/numeracion.page.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/rectificacion-numeracion.component.ts`
- `front/src/app/routes/pozos/pages/numeracion/rectificacion-numeracion.component.spec.ts`
- `front/src/app/routes/pozos/pages/numeracion/reservas-eliminadas.component.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.html`
- `front/src/app/routes/pozos/pages/historicos/historicos-reingreso.spec.ts`
- `docs/REINGRESO_HISTORICO_Y_NUMERACION.md`

Producción sólo se consultó en modo lectura. No se creó ningún commit ni se realizó
push, mantenimiento, migración o despliegue productivo. Revisión, commit y despliegue
son etapas posteriores; el reingreso real requerirá una acción administrativa explícita.
