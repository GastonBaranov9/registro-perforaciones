# ETAPA RSP-06H-A-R1 — Correcciones de review

## Estado inicial y alcance

La corrección comenzó en `feature/catalogo-paleta-litologias`, HEAD `6f5a8f5`, árbol limpio y base `main`. RSP-06H-A no estaba publicada. Se atendieron exclusivamente los dos P2 del review: normalización de espacios y respuesta 500 ante identificadores de catálogo rechazados en operaciones completas.

## P2-1: normalización de espacios

### Causa raíz y corrección

Con `standard_conforming_strings=on`, el literal SQL `'\\s+'` entrega dos barras invertidas al motor de expresiones regulares y busca una barra literal seguida de `s`, en vez de la clase de espacios pretendida. La migración inédita 003 se corrigió a `regexp_replace(valor, '\s+', ' ', 'g')`: el archivo SQL contiene una sola barra. `\s+` en la expresión regular reconoce una o más separaciones, incluidos espacios, tabulaciones y saltos de línea; `regexp_replace` las compacta a un espacio. `btrim` elimina el espacio resultante en extremos; después se conservan las reglas existentes de diacríticos y minúsculas.

La función continúa siendo SQL, `IMMUTABLE`, `STRICT` y `PARALLEL SAFE`: solo aplica funciones deterministas al argumento y no consulta estado de base, configuración regional dinámica ni tablas.

### Tratamiento de migración y PostgreSQL

Como 003 aún no fue publicada, se corrigió directamente y no se creó una 004 artificial. En la base habitual, donde la versión anterior se había aplicado solo para validación local, se ejecutó el mismo `CREATE OR REPLACE FUNCTION` corregido. No se reinicializó ni eliminó la base y los 10 intervalos habituales permanecieron intactos.

Una base temporal con nombre controlado recibió `scripts.sql`, 001, 002, un intervalo histórico previo y 003 desde cero. El resultado fue: 29 seeds, las cinco variantes (`Arena fina`, espacios repetidos, extremos, tabulación y salto de línea) normalizadas a `arena fina`, `Arena final` distinta, duplicado administrativo rechazado por unicidad y el histórico `  Arenisca   fina\t` vinculado correctamente sin alterar `material`. La base temporal se eliminó al finalizar.

## P2-2: identificadores inexistentes o inactivos

### Causa raíz y corrección

Creación completa y `insertarHijos` repetían el INSERT protegido. Un `id_litologia` inexistente o inactivo hacía que `INSERT ... SELECT ... WHERE` devolviera cero filas; luego `numerizarLitologia(rows[0])` recibía `undefined` y lanzaba `TypeError`, convertido finalmente en 500.

Ambos flujos usan ahora `insertarIntervaloLitologico`. El helper conserva el filtro de catálogo activo dentro del mismo INSERT para cerrar la carrera con una desactivación concurrente, inspecciona `rows[0]` inmediatamente y, si falta, lanza `T05DatosIncorrectos` con mensaje seguro y estado 400. Solo numeriza una fila demostrada. Errores inesperados continúan propagándose como errores internos; el error de dominio no se recaptura ni transforma.

### Atomicidad, creación y edición

En creación, el 400 provoca `ROLLBACK`: no quedan pozo, hijos, archivo temporal ni fotografía confirmada. En edición, aunque los hijos anteriores se borren dentro de la transacción antes de reinsertar, el 400 revierte actualización, borrados e inserciones, conservando información y fotografía previas. Las pruebas cubren ID activo, inexistente, inactivo y cero filas por carrera para ambos flujos; ninguna validación depende de un `TypeError`.

## Compatibilidad y regresión

No se cambió la lectura histórica: un intervalo ya vinculado conserva el `LEFT JOIN` a una litología posteriormente inactiva y continúa disponible en detalle, perfil y PDF. La vista previa mantiene el contrato anterior y los valores desconocidos con `id_litologia NULL` conservan el fallback determinista. No se modificaron paleta, interfaz, mapas, fotografías, autenticación, CSRF, cookies, sesiones, roles, aislamiento, advisory locks ni contratos públicos.

## Pruebas y riesgos residuales

- API: build y suite completa, incluidas creación/edición, rollback, carrera, foto, perfil, vista previa y PDF.
- PostgreSQL habitual: función actualizada de forma no destructiva; prueba reversible con cinco variantes, unicidad, 29 seeds y vinculación histórica.
- PostgreSQL limpio: esquema y migraciones 001–003 completos en base temporal eliminada al terminar.
- Frontend: build, suite completa y UTF-8 para confirmar ausencia de regresiones.
- Calidad: SQL parametrizado, columnas explícitas, sin `SELECT *`, dependencias ni `any` nuevos.

Riesgo residual: si una futura modificación cambia la expresión de normalización después de que existan nombres con la semántica anterior en un entorno publicado, deberá auditar colisiones antes de recalcular columnas generadas. Ese escenario no aplica a esta migración inédita ni a los 29 nombres actuales.
