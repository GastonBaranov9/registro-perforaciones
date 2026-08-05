# ETAPA RSP-06E — Modelo constructivo de tubería y filtros

## Decisión de modelo

Se conserva `intervalo_diametro_perforacion` y sus rutas para evitar una ruptura. El recurso suma `material_tuberia`, presentado como “Material de tubería”. Se crea `intervalo_filtro` como categoría independiente porque un filtro puede coincidir intencionalmente con tubería y solo debe impedir solapamientos con otros filtros.

El tipo de negocio es exactamente `MaterialTuberia = 'PVC' | 'Acero'`. TypeBox, el `CHECK` PostgreSQL y la validación del servicio compuesto rechazan cualquier otra escritura.

## Migración e históricos

`002_add_tuberia_filtros.sql`:

- añade `intervalo_diametro_perforacion.material_tuberia VARCHAR(5) NULL` con `CHECK` canónico;
- crea `intervalo_filtro` con PK `BIGSERIAL`, FK `id_pozo ON DELETE CASCADE`, profundidades y diámetro `NUMERIC`, material obligatorio, checks e índice `(id_pozo, desde_m, hasta_m)`;
- incluye instrucciones de rollback manual al final.

El `NULL` de tubería existe exclusivamente para registros anteriores. No se ejecuta backfill ni se inventa PVC/Acero. Lecturas, detalle y PDF muestran “No especificado”. Al cargar edición completa, el frontend usa el estado tipado pendiente `''`; la validación bloquea el guardado hasta seleccionar material. Las altas nuevas exigen material en TypeBox y PostgreSQL. `scripts.sql` refleja el esquema y orden de eliminación.

## Contratos, rutas y transacciones

Los cuerpos compuestos incluyen `intervalos_filtro` y cada diámetro incluye `material_tuberia`:

- `POST /usuarios/:id_usuario/pozos/completo`;
- `PUT /usuarios/:id_usuario/pozos/:id_pozo/completo`;
- CRUD existente `/intervalo_diametro_perforacion`;
- nuevo CRUD `/intervalos_filtro`.

Creación y actualización completas validan rangos, profundidad, material y solapamiento por categoría antes de escribir. La transacción inserta/reemplaza tuberías y filtros junto con litología, aportes, pozo y fotografía. La actualización bloquea el pozo, borra hijos solo por `id_pozo` autorizado y hace COMMIT/ROLLBACK integral. Los endpoints técnicos usan consultas parametrizadas, advisory lock y rechazo de solapamiento/profundidad.

## Creación, edición y páginas técnicas

El editor compartido añade material a tubería y una sección independiente “Intervalos de filtro”. Ambas usan selectores accesibles PVC/Acero y continuidad calculada por listas separadas. Los filtros son opcionales y el vacío muestra “Este pozo no tiene intervalos de filtro registrados.”

La edición carga filtros en paralelo con el resto de recursos y conserva referencias locales distintas de IDs PostgreSQL. El detalle posterior muestra material y filtros. El formulario y listado técnico independiente de diámetros incorporan material. Para ajustes independientes de filtros se conserva el bloque completo de edición y el CRUD protegido, sin duplicar otro editor divergente.

## Perfil y PDF

`crearPerfilLitologico` continúa como fuente visual única y ahora normaliza `tuberias` y `filtros` con rango, diámetro, material, texto histórico, ancho normalizado y patrón:

- PVC: tramo claro/liso;
- Acero: tramo oscuro/tramado;
- filtro: superposición ranurada con prioridad visual y etiqueta de intervalo.

El diámetro determina de forma determinista el ancho relativo. Angular consume esta geometría sin recalcularla y ofrece tabla accesible “Diseño del pozo”. `pdf-lib` consume los mismos tramos, escala y rangos; no inventa grava, sello ni prefiltro.

El PDF solo cambia lo pedido en RSP-06E: columna Material en tuberías, tabla de filtros con “Sin registros” y diseño constructivo en el perfil. No se rediseñaron portada, mapa, tipografía ni paginación general.

## Archivos principales

- `api/db/migrations/002_add_tuberia_filtros.sql`, `api/db/scripts.sql`.
- `api/src/models/schemas.ts`.
- `api/src/services/pozo-completo-service.ts`, `intervalo-diametro-services.ts`, `intervalos-filtro-service.ts`.
- `api/src/routes/intervalos-filtro.ts`.
- `api/src/services/generar-informe-consultas.ts`.
- `api/src/pdf/perfil-litologico.ts`, `pdf-generate.ts`.
- `front/src/app/shared/types/schemas.ts`, `shared/utils/datos-tecnicos-borrador.ts`.
- editor técnico, páginas de diámetro, detalle y componente de perfil.

## Pruebas

- API: 54/54; materiales PVC/Acero, material inválido, filtros opcionales/múltiples/con huecos, solapamiento, profundidad, coincidencia entre categorías, transacción, geometría canónica, PDF e histórico `NULL`.
- Frontend: 109/109; continuidad independiente, validación, editor en memoria, selector, perfil liso/metálico/ranurado y tabla accesible.
- Builds API y frontend correctos; `git diff --check` correcto.

La prueba PostgreSQL local no pudo ejecutarse: no existe `psql` ni `api/.env` en este workspace y no se proporcionó una conexión local. No se intentó producción ni se expusieron credenciales. La migración sí fue revisada y la atomicidad fue ejercitada con clientes PostgreSQL controlados en las pruebas de servicios.

## Seguridad

Se conservan cookies HttpOnly, CSRF global para mutaciones, `version_sesion`, `request.user.sub`, autorización por pozo, 404 genérico, archivos protegidos y autorización previa al PDF. Las consultas nuevas enumeran columnas y parametrizan valores; no se añadieron Bearer, JWT en almacenamiento, `SELECT *`, endpoints públicos ni dependencias.

## Despliegue, rollback y limitaciones

Despliegue: aplicar primero `002_add_tuberia_filtros.sql`, después API y frontend juntos. No requiere backfill. Para rollback de aplicación, revertir commits en orden inverso. El rollback SQL elimina primero `intervalo_filtro`, luego constraint y columna; es destructivo para filtros ya creados y debe respaldarse antes.

Limitaciones reales:

- los históricos seguirán mostrando “No especificado” hasta una edición explícita;
- la base no tiene un mecanismo general de migraciones automáticas: la aplicación del SQL es una operación de despliegue;
- no se realizó la prueba PostgreSQL real por ausencia de cliente/configuración local;
- el catálogo visual geológico y el rediseño general del PDF quedan fuera de RSP-06E.
