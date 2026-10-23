# Sello sanitario constructivo: perfil web y PDF

- El modelo canónico recibe `sello_sanitario_constructivo` como sexto argumento opcional de `crearPerfilLitologico`. Devuelve el rango original o `null`, enriquecido con texto, estilo y dos bandas laterales normalizadas.
- La envolvente usa gris `#999999` y trama `concrete`, definidos sin consultar el catálogo litológico. Rodea el ancho máximo de tubería/filtro que intersecta su rango; sin revestimiento informado rodea la sección esquemática existente. Su espesor horizontal es esquemático, no un diámetro medido.
- Las litologías, huecos, escala y páginas no se dividen ni cambian por el sello. Las bandas usan exactamente la misma transformación vertical, recortándose únicamente en los límites de página.
- La leyenda constructiva está separada de la litológica. Las etiquetas comparten el resolvedor de colisiones existente con tubería, filtros y aportes.
- GET del perfil, POST de vista previa y PDF consumen el mismo modelo. La vista previa transporta objeto/null desde el estado técnico, sin persistir ni convertir antiguas litologías. El código reservado `sello_sanitario` no se admite como estrato del modelo.
- El PDF muestra el rango constructivo como dato técnico. Sólo si falta el rango y el booleano legado es `true` conserva una nota explícita de registro legado sin profundidad; nunca crea geometría desde el booleano.
- Sin profundidad final se mantiene la política anterior: no se infiere escala; el rango sigue disponible como texto en el PDF.

## Validación enfocada

- Backend: geometría canónica, proyección PDF de ambas bandas y límites multipágina, leyendas, colisiones, consulta del reporte, endpoints de perfil/preview y composición de PDF normal/histórico.
- Frontend: renderer persistido, geometría decimal, coexistencia con suelo completo, leyenda constructiva, transporte y renderizado al agregar/modificar/quitar el sello.
- No se modifican migraciones, persistencia ni formularios. No se ejecutan suites completas ni se hace commit.

Resultados: 65 tests backend en siete archivos y 13 tests frontend en dos specs, todos correctos. Builds backend y frontend correctos; `git diff --check` sin errores. El build frontend mantiene el aviso existente `empty-glob` de Stencil.

La escala vertical está verificada por tests; queda pendiente revisión visual manual en móvil e impresión, especialmente con descripciones largas y bandas muy cortas. El ancho horizontal del sello es esquemático.

## Archivos de esta etapa

- `api/src/pdf/perfil-litologico.ts`
- `api/src/pdf/pdf-generate.ts`
- `api/src/routes/informes.ts`
- `api/src/models/schemas.ts`
- `api/src/services/generar-informe-consultas.ts`
- `api/src/services/litologias-services.ts`
- `api/test/perfil-litologico.test.ts`
- `api/test/sello-sanitario.test.ts`
- `api/test/pdf-historicos.test.ts`
- `api/test/rsp06i-r6-r1-pdf.test.ts`
- `front/src/app/shared/types/schemas.ts`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.html`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.css`
- `front/src/app/shared/components/perfil-litologico/perfil-litologico.component.spec.ts`
- `front/src/app/routes/pozos/components/perfil-litologico-vista-previa/perfil-litologico-vista-previa.component.ts`
- `front/src/app/routes/pozos/components/perfil-litologico-vista-previa/perfil-litologico-vista-previa.component.spec.ts`
- `docs/SELLO_SANITARIO_ETAPA_3.md`
