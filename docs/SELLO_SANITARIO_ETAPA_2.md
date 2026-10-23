# Sello sanitario constructivo: frontend y transporte

## Estado y formulario

El dato vive en `DatosTecnicosBorrador.sello_sanitario_constructivo`, separado de
las listas litológicas y del booleano legado. Es opcional para leer borradores
anteriores sin convertirlos; null significa ausencia. El detalle `Pozo` y las
respuestas completas declaran el mismo contrato disponible en el backend.

La sección compartida «Sello sanitario» permite agregar un único rango, editar
Desde/Hasta y quitarlo. Ambos campos se muestran vacíos al agregarlo. No se
precarga ninguna profundidad. Los borradores incompletos pueden guardarse
localmente; requieren completar números finitos antes de enviarse.

La validación exige `0 <= desde_m < hasta_m` y respeta la profundidad final cuando
existe. El sello no interviene en cobertura ni solapamientos de litología. Se
conservan decimales y el límite inicial no se fuerza a cero.

## Persistencia y edición

- Alta normal y sincronización offline envían el objeto o null en `/completo`.
- Alta histórica incorpora el objeto cuando existe; la ausencia puede omitirse.
- Las ediciones normal e histórica comparan contra la última versión canónica:
  sin cambios omiten el campo, quitar envía null y cambiar envía el objeto.
- La hidratación copia el rango persistido sin consultar el booleano legado.
- Las huellas incluyen el rango y reconocen reversiones exactas sin falso dirty.
- La edición normal usa el guard existente de salida y reconcilia la respuesta
  completa; la histórica reconcilia la recarga posterior al PATCH. Los cambios
  posteriores al envío se conservan frente al estado confirmado por el servidor.
- La persistencia JSON del repositorio offline ya conserva el estado técnico
  completo. Sólo se amplía el cuerpo de sincronización armado manualmente.

Los cuatro estándares técnicos no agregan sello. El detalle muestra el rango o
«No registrado». El selector existente ya excluye opciones inactivas nuevas; no
se incorporan filtros por ID ni una conversión de litologías antiguas. Un
borrador con un ID retirado conserva sus datos y recibe el rechazo normal del
backend al intentar sincronizarse.

Esta etapa no cambia la migración, el backend, los dibujos ni el PDF.

## Validación

Se ejecutaron 225 pruebas enfocadas en ChromeHeadless, distribuidas en 14 specs
de formularios, transporte, hidratación, reconciliación, detalle, selector y
offline: todas aprobadas. También pasan `npm run build` desde `front` y
`git diff --check`. No se ejecutaron suites completas ni pruebas backend en esta
etapa. El build informa la advertencia de Stencil `empty-glob`, sin errores.

## Archivos modificados

- `front/src/app/shared/types/schemas.ts`
- `front/src/app/shared/utils/datos-tecnicos-borrador.ts`
- `front/src/app/shared/utils/tecnicos-persistidos.ts`
- `front/src/app/shared/utils/estado-formulario-perforacion.ts`
- `front/src/app/shared/utils/reconciliar-perforacion.ts`
- `front/src/app/shared/utils/historicos-form.ts`
- `front/src/app/shared/services/pozos-create.service.ts`
- `front/src/app/shared/services/pozos-edit.service.ts`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.ts`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html`
- `front/src/app/core/native/offline.service.ts`
- `front/src/app/app.routes.ts`

Pruebas ampliadas en sus archivos existentes:

- `front/src/app/shared/utils/datos-tecnicos-borrador.spec.ts`
- `front/src/app/shared/utils/historicos-form.spec.ts`
- `front/src/app/shared/utils/reconciliar-perforacion.spec.ts`
- `front/src/app/shared/services/pozos-create.service.spec.ts`
- `front/src/app/shared/services/pozos-edit.service.spec.ts`
- `front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.spec.ts`
- `front/src/app/routes/pozos/pages/pozo-edit/pozo-edit.page.spec.ts`
- `front/src/app/routes/pozos/pages/historicos/historicos.page.spec.ts`
- `front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.spec.ts`
- `front/src/app/core/native/offline.spec.ts`
- `front/src/app/shared/components/selector-litologia/selector-litologia.component.spec.ts`
