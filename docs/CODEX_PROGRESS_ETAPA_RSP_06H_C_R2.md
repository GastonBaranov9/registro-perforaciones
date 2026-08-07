# RSP-06H-C-R2 — Validación y cache de selectores

## Alcance

Se corrigieron exclusivamente los dos hallazgos P2 del review posterior a RSP-06H-C-R1.
No se modificaron paleta, patrones, PDF, PostgreSQL ni seguridad.

## Intervalos nuevos e históricos

El borrador ya distingue un intervalo nuevo de uno persistido mediante
`id_intervalo_litologico`, metadata que ya formaba parte de la hidratación de edición.

- Un intervalo nuevo exige `id_litologia` y material no vacío.
- Un histórico inactivo conserva su FK y sigue siendo válido.
- Un histórico sin FK conserva material no vacío y sigue siendo válido.
- Un histórico sin FK puede vincularse explícitamente a una litología activa.

La regla vive en `validarDatosTecnicos`, por lo que bloquea tanto guardar como generar
la vista previa antes de realizar la petición.

## Cache del catálogo

`LitologiasService` comparte la promesa de la lista activa entre todas las instancias.
Los errores eliminan la entrada para permitir un reintento real. Las cargas excepcionales
de entidades históricas se comparten por ID y no se incorporan al catálogo global de
opciones nuevas.

Crear, editar, activar y desactivar invalidan las cargas cacheadas. La administración
continúa consultando la lista completa (`incluir_inactivas=true`) sin reutilizar el cache
de activas. No se usa almacenamiento persistente del navegador.

## Pruebas

Las pruebas focalizadas cubren:

- nuevos sin selección, selección activa y limpieza;
- dos históricos, incluido histórico sin FK;
- una carga activa compartida por diez selectores;
- ausencia de nueva carga al cambiar selección;
- carga excepcional histórica compartida;
- invalidación tras mutación;
- error inicial y reintento.

La validación integral ejecutada al cierre obtuvo API 111/111, build frontend y UTF-8
correctos. La suite frontend terminó 136/139: conserva fallos preexistentes/ambientales
de Ionic-Karma, incluido `Invalid base URL` y el test aislable de
`PerfilLitologicoComponent` (`Expected null not to be null`). Los tests nuevos de esta
etapa pasaron aisladamente.

## Riesgos residuales

La suite frontend puede mostrar el fallo ambiental intermitente de Ionicons/Karma ya
documentado en RSP-06H-C-R1 (`Invalid base URL`). No se altera producción para ocultar
ese síntoma.

## Rollback

Revertir el commit local de RSP-06H-C-R2 elimina únicamente la validación de intervalos
nuevos, el cache del servicio, las pruebas y esta documentación; no requiere migraciones.
