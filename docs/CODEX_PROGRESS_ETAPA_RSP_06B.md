# ETAPA RSP-06B — flujo de carga y correcciones

## Auditoría del flujo anterior

El formulario creaba realmente una fila `pozo`; después, si había una foto, realizaba un segundo POST. Litología, diámetros y aportes exigían navegar a tres grupos de páginas técnicas. Las tablas `intervalo_litologico`, `intervalo_diametro_perforacion` y `nivel_aporte` requieren `id_pozo` y borran en cascada con el padre. No existía endpoint compuesto ni transacción que incluyera hijos.

La fotografía no es `documento`: la referencia vive en `pozo.foto_url` y el archivo protegido en `api/public/pozo-{id}.{jpg|png}`. La aplicación tenía POST/GET protegidos, pero no DELETE funcional ni botón para limpiar selección/persistencia.

## Causas raíz

1. **Flujo fragmentado:** el contrato POST de pozos solo aceptaba `NuevoPozo`; los hijos dependían de un ID que todavía no existía y Angular navegaba a páginas separadas.
2. **Foto no eliminable:** faltaban endpoint DELETE, operación de consistencia y controles visibles. Cambiar una foto también podía dejar inconsistencias si fallaba la actualización de base.
3. **PDF tras cargar intervalos:** `pg` devuelve `NUMERIC` como `string`. `getReportePozo` convertía profundidades de hijos, pero dejaba `pozo.profundidad_final_m` como cadena. `crearPerfilLitologico` exige un número finito y lanzaba 422 al aparecer la primera capa. No era un fallo de autorización ni de `pdf-lib`.
4. **Foto en PDF:** `foto_url` es una URL HTTP protegida, no una ruta física. El generador intentaba resolver esa URL debajo de `public` y no encontraba el archivo real.

## Flujo nuevo

> Continuidad: RSP-06C reutiliza este borrador técnico en edición, añade selectores de personas y un PUT compuesto. El cierre actualizado está en `docs/CODEX_PROGRESS_ETAPA_RSP_06C.md`.

La pantalla `pozos-create` contiene datos generales, foto opcional y tres editores en memoria. Cada fila usa `idLocal` (`local-N`) exclusivamente en Angular; el ID nunca viaja al backend ni simula una clave PostgreSQL. Se puede agregar, editar, quitar y revisar antes de enviar.

Las validaciones web y API exigen rangos finitos, `desde >= 0`, `hasta > desde`, límites respecto de profundidad final y ausencia de solapamientos por categoría. Los aportes permanecen separados y se validan como profundidades. Cambiar la profundidad muestra errores y bloquea el envío sin eliminar filas.

El botón se deshabilita durante la operación; un segundo clic retorna sin crear. Ante error se conserva el borrador. Tras éxito se navega a `/pozos-detail/:id_pozo`, que carga inmediatamente litología, diámetros, aportes, foto y perfil; las páginas técnicas continúan disponibles.

## Arquitectura transaccional y contrato

`POST /usuarios/:id_usuario/pozos/completo` recibe:

```json
{
  "pozo": { "id_propietario": 1, "id_sitio": 2, "id_perforador": 3, "profundidad_final_m": 60 },
  "intervalos_litologicos": [{ "desde_m": 0, "hasta_m": 12, "material": "Arena" }],
  "intervalos_diametro": [{ "desde_m": 0, "hasta_m": 60, "diametro_pulg": 6 }],
  "niveles_aporte": [{ "profundidad_m": 25 }],
  "foto": { "mime_type": "image/png", "base64": "..." }
}
```

La API vuelve a validar, inicia `BEGIN`, crea padre e hijos con consultas parametrizadas y columnas explícitas, escribe la foto con nombre derivado del ID, actualiza `foto_url` y recién entonces ejecuta `COMMIT`. Cualquier error hace `ROLLBACK` y elimina el archivo. El perforador no administrador debe coincidir con `request.user.sub`; propietario y perforador deben tener sus roles persistidos. CSRF se aplica por el hook global a esta mutación cookie-only.

La foto admite JPEG/PNG hasta 5 MB y se valida por MIME y firma binaria. El nombre del cliente se ignora. No se introdujeron temporales públicos ni rutas físicas en respuestas.

## Eliminación y reemplazo de fotografías

`DELETE /usuarios/:id_usuario/pozos/:id_pozo/foto` exige sesión, CSRF, pertenencia del pozo y rol administrador/perforador. Propietario conserva solo lectura. La operación mueve primero el archivo a `.trash` (inaccesible para GET), limpia `foto_url`, restaura el archivo si falla PostgreSQL y purga después. Si el archivo ya no existe, igualmente limpia la referencia y responde 204. Si falla la purga final, se informa 500: la base y la URL quedan seguras, aunque puede quedar un archivo aislado no servible.

El reemplazo usa el mismo aislamiento: aparta la foto anterior, escribe la nueva con `wx`, actualiza la base y restaura la anterior ante fallo. En creación, “Quitar fotografía” solo limpia el `File` local y no realiza red.

## Corrección PDF

`getReportePozo` normaliza a número la profundidad oficial, niveles generales, litología, diámetros y aportes. Un conjunto válido genera PDF; un solapamiento o capa fuera de profundidad continúa produciendo un error de validación comprensible. Los huecos se llaman “Sin información litológica”.

El PDF localiza la foto por el ID seguro del pozo, conserva tabla, perfil, aportes, diámetros, foto y paginado. Con `foto_url = null` no intenta leer archivo. Una referencia cuyo archivo falta se advierte y el resto del informe sigue generándose.

## Archivos principales

- API: `models/schemas.ts`, `services/pozo-completo-service.ts`, `services/foto-pozo-service.ts`, `services/generar-informe-consultas.ts`, `routes/pozos.ts`, `pdf/{pdf-generate,perfil-litologico}.ts`.
- Web: `datos-tecnicos-borrador.component.*`, `datos-tecnicos-borrador.ts`, `pozos-create.page.*`, `pozos-form.component.*`, servicios de creación/foto, detalle del pozo y tipos.
- Pruebas: `pozo-completo.test.ts`, `foto-pozo.test.ts`, `reporte-pozo.test.ts`, `rsp06b.local.ts` y specs Angular del borrador, formulario, página y servicios.

## Pruebas y evidencia local

- API: 43/43; build correcto.
- Frontend: 97/97; build correcto.
- La suite existente mantiene cookies HttpOnly, CSRF global, `version_sesion` y aislamiento A/B.
- `rsp06b.local.ts` ejecutó contra PostgreSQL local sin imprimir identidades ni secretos: creó un pozo temporal con 2 capas, 2 diámetros, 1 aporte y PNG; confirmó relaciones; generó PDF con foto; eliminó la foto mediante el servicio productivo; generó PDF sin foto; intentó una creación inválida y confirmó que no aumentó el conteo; finalmente eliminó padre e hijos. Resultado: `relaciones`, `pdfConFoto`, `pdfSinFoto` y `rollback` verdaderos.

## Limitaciones reales

- La selección de propietario sigue el contrato existente: un perforador registra el pozo para un usuario con rol propietario. La identidad del perforador sí se fija a la sesión salvo administrador.
- PostgreSQL no tiene constraint de exclusión para intervalos; el endpoint compuesto valida dentro de su única transacción y las rutas litológicas posteriores conservan advisory lock. Escrituras directas fuera de la API deben respetar la regla.
- Si el proceso termina abruptamente después de mover una foto a `.trash` y antes de completar la operación, puede quedar un archivo aislado. Nunca es servido ni referenciado; una tarea operacional puede purgar `.trash`.
- La foto viaja en base64 para incluir archivo y datos en una sola operación controlada; el límite de 5 MB evita cargas desproporcionadas.

## Despliegue y rollback

Desplegar API y frontend juntos. No hay migraciones ni dependencias nuevas. Verificar límite de body del proxy para aproximadamente 6,7 MB por la expansión base64. Para rollback, revertir los commits RSP-06B en orden inverso y desplegar ambos artefactos; no hay transformación de datos. Las filas creadas con el contrato nuevo usan las tablas existentes.
