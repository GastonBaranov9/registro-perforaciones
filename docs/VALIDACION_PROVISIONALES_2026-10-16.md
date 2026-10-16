# Operador y datos provisionales — validación final

Rama `feature/rsp-10-pilot-apk`, HEAD `8984749`. Se retomó el working tree existente (51 archivos modificados más archivos nuevos), sin reset ni restauraciones. No se hicieron commits, push, operaciones sobre producción ni cambios en `.env`, Docker o Cloudflare.

## Estado retomado y cierre

Ya estaban implementados los permisos, ambos campos provisionales, las listas administrativas, la vinculación por lotes, la presentación y la migración 019. Había logs de pruebas parciales y una ejecución frontend completa anterior con fallos que aún necesitaba validación final.

Al retomar se corrigió el fallback del listado que podía mostrar un perforador provisional como propietario ausente, con regresión en PostgreSQL. Se completó la validación del formulario individual (provisional vacío/contradictorio, ID nulo), se protegieron cambios hechos durante la carga inicial del alta de intervalo y se agregó su prueba. Se retiró un campo innecesario del tipo del perfil gráfico. Se ejecutaron nuevamente las validaciones finales y se eliminó el clúster desechable.

## Resultado funcional y decisiones

- Operador reutiliza el alcance del perforador en pozos normales, incluida la ventana de edición existente. La excepción por origen histórico permite carga/edición histórica; no concede administración global de sitios, KML, cuentas, roles, catálogo ni numeración. Administración conserva su alcance. Propietario conserva consulta de sus pozos y no ve el alta.
- `perforador_provisional` sólo se admite en históricos, sin `id_perforador`; ambos pueden estar ausentes. No crea personas/cuentas ni confunde al autor de carga con el perforador físico.
- Personas pendientes deriva propietarios y perforadores de los pozos existentes. Agrupa por rol/texto, sin asumir identidad. Administración busca identidad o abre el alta administrativa existente, selecciona ocurrencias y confirma. Una consulta de datos por lista evita N+1.
- `litologia_provisional` se conserva con `id_litologia = NULL`, trim y máximo 160 caracteres. El selector permite texto observado y sustitución explícita por catálogo. No inserta catálogo automáticamente; conserva comportamiento móvil, Android Back y guard de cambios.
- Litologías pendientes se integra en la administración del catálogo. Permite revisar intervalos, usar catálogo existente o crear con el formulario administrativo y confirmar las ocurrencias seleccionadas.
- Las vinculaciones usan transacción, bloqueo ordenado y versiones `xmin` del pozo y ocurrencia. Un cambio desde la consulta devuelve 409 y revierte el lote. Las credenciales/sesión se revalidan dentro de la transacción. No hay vinculación textual automática.
- Detalle e informe usan identidad/catálogo vinculado con prioridad, luego provisional y finalmente el dato ausente o legado correspondiente. PDF no incorpora aviso de vinculación pendiente.
- El modelo anterior admite `material` legado sin ID de catálogo. Se conserva para compatibilidad; la migración no obliga a reclasificar históricos incompletos.
- Única migración nueva: `api/db/migrations/019_datos_provisionales.sql`. Agrega columnas, exclusiones y tres índices parciales para las listas reales. No modifica 000..018 ni crea tablas de pendientes.

## Archivos principales

- Backend: `api/src/services/capacidades.ts`, `edicion-pozo.ts`, `historicos-service.ts`, `pozo-completo-service.ts`, `intervalos-litologicos-services.ts`, `pendientes-service.ts`, `litologia-provisional.ts`; `api/src/plugins/jwt.ts`; rutas `pendientes.ts`, `pozos.ts`, `informes.ts`; modelos y consultas del informe.
- Frontend: `front/src/app/routes/pendientes/`, administración de litologías, formulario histórico, selector de litología, formularios técnicos e individuales, servicios de permisos, rutas/guard y tipos/persistencia de borradores.
- Pruebas nuevas: `api/test/provisionales.test.ts`, `api/test/provisionales.postgres.local.ts`, `front/src/app/routes/pendientes/pendientes.component.spec.ts`, `front/src/app/shared/utils/provisionales.spec.ts`; pruebas existentes ajustadas/ampliadas para el alcance corregido.

## Verificación ejecutada el 16/10/2026

| Comprobación | Resultado |
| --- | --- |
| Backend enfocado: provisionales, operador, edición, KML, intervalos, PDF, roles múltiples, sitios | 74/74 |
| Frontend enfocado: provisionales, pendientes, listado, selector, guard, históricos, edición/sitios, intervalos individuales | 102/102 |
| PostgreSQL: históricos y provisionales `.postgres.local.ts` | 25/25 |
| Backend completo: `npm.cmd test` | 400/400 |
| Frontend completo: `npm.cmd test -- --watch=false --browsers=ChromeHeadless` | 612/612 |
| Backend: `npm.cmd run build` | Correcto |
| Frontend: `npm.cmd run build` | Correcto |
| `git diff --check` | Correcto |

Los logs se conservan en `%TEMP%/rsp-provisionales-{api-focused,front-focused,pg,api-full,front,api-build,front-build}.log`. Angular requirió ejecutar fuera del aislamiento por acceso denegado al resolver dependencias locales. El build muestra una advertencia `empty-glob` de Stencil; las pruebas muestran avisos de iconos de Ionic. No se deshabilitaron pruebas.

PostgreSQL 18 fue verificado mediante SQL: usuario `rsp_reset_test`, dirección `127.0.0.1`, puerto `55439`, directorio `%TEMP%/rsp-provisionales-pg-20261015`. Las pruebas no leen archivos `.env`. La migración se probó sobre datos anteriores a 019, incluidos propietarios provisionales existentes. Se verificaron selección explícita, exclusiones, conflictos, rollback, revocación, permisos HTTP y presentación/PDF. La prueba concurrente utiliza dos conexiones y confirma que el lote espera el bloqueo antes de recibir 409.

En ese laboratorio, histórico 2100 mantuvo el siguiente automático en 3282; normales consumieron 3282 y 3283. No se accedió al contador productivo: no se lo modificó ni se hizo una consulta productiva para verificarlo.

Al terminar no quedaron bases `rsp_reset_test%`. `pg_ctl` confirmó `server stopped`; la carpeta del clúster se eliminó después de verificar su ruta absoluta y ausencia de `postmaster.pid`.

No quedan decisiones funcionales bloqueantes. La migración está preparada pero no aplicada en producción. La cobertura móvil corresponde a pruebas automatizadas en ChromeHeadless; no se hizo una nueva prueba manual en dispositivo Android físico.

## git status --short final

```text
 M api/src/models/historicos.ts
 M api/src/models/schemas.ts
 M api/src/plugins/jwt.ts
 M api/src/routes/informes.ts
 M api/src/routes/pozos.ts
 M api/src/services/candidatos-pozo-service.ts
 M api/src/services/capacidades.ts
 M api/src/services/edicion-pozo.ts
 M api/src/services/generar-informe-consultas.ts
 M api/src/services/historicos-service.ts
 M api/src/services/intervalos-litologicos-services.ts
 M api/src/services/pozo-completo-service.ts
 M api/src/services/pozos-services.ts
 M api/src/services/roles-services.ts
 M api/test/edicion-pozo.test.ts
 M api/test/exportar-kml.test.ts
 M api/test/historicos.postgres.local.ts
 M api/test/intervalos-litologicos-errores.test.ts
 M api/test/operador-administrativo.test.ts
 M api/test/pdf-historicos.test.ts
 M api/test/pozos-roles-multiples.test.ts
 M api/test/sitios-standalone.test.ts
 M front/src/app/app.html
 M front/src/app/app.routes.ts
 M front/src/app/core/guards/cambios-perforacion.guard.spec.ts
 M front/src/app/core/native/offline.service.ts
 M front/src/app/routes/litologias/litologias-admin.page.html
 M front/src/app/routes/litologias/litologias-admin.page.ts
 M front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html
 M front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts
 M front/src/app/routes/pozos/components/pozos-form/pozos-form.component.html
 M front/src/app/routes/pozos/pages/historicos/historicos.page.ts
 M front/src/app/routes/pozos/pages/pozos-create/pozos-create.page.ts
 M front/src/app/routes/pozos/pages/pozos-list/pozos-list.page.spec.ts
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/components/intervalo-lit-form/intervalo-lit-form.component.html
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/components/intervalo-lit-form/intervalo-lit-form.component.spec.ts
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/components/intervalo-lit-form/intervalo-lit-form.component.ts
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-create/intervalos-litologicos-create.page.spec.ts
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-create/intervalos-litologicos-create.page.ts
 M front/src/app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-edit/intervalos-litologicos-edit.page.ts
 M front/src/app/routes/pozos/pozo/pozo.page.html
 M front/src/app/shared/components/selector-litologia/selector-litologia.component.html
 M front/src/app/shared/components/selector-litologia/selector-litologia.component.ts
 M front/src/app/shared/services/auth-service/auth.service.ts
 M front/src/app/shared/services/candidatos-pozo.service.ts
 M front/src/app/shared/services/edicion-pozo.service.spec.ts
 M front/src/app/shared/services/edicion-pozo.service.ts
 M front/src/app/shared/services/permisos-sitio.service.spec.ts
 M front/src/app/shared/services/permisos-sitio.service.ts
 M front/src/app/shared/types/schemas.ts
 M front/src/app/shared/utils/datos-tecnicos-borrador.ts
 M front/src/app/shared/utils/historicos-form.ts
 M front/src/app/shared/utils/tecnicos-persistidos.ts
?? api/db/migrations/019_datos_provisionales.sql
?? api/src/routes/pendientes.ts
?? api/src/services/litologia-provisional.ts
?? api/src/services/pendientes-service.ts
?? api/test/provisionales.postgres.local.ts
?? api/test/provisionales.test.ts
?? docs/VALIDACION_PROVISIONALES_2026-10-16.md
?? front/src/app/routes/pendientes/
?? front/src/app/shared/utils/provisionales.spec.ts
```
