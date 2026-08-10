# RSP-06I-R1 — cierre de propietarios y espaciado PDF

## Auditoría y decisión

La auditoría confirmó que el alta operativa de RSP-06I insertaba una fila completa en
`usuario`, generaba una contraseña aleatoria y exigía email. El modelo histórico usa
`pozo.id_propietario -> usuario.id_usuario`, por lo que la modificación mínima compatible
fue separar el estado de autenticación dentro de esa identidad existente: `cuenta_acceso`
es `TRUE` para cuentas administradas y `FALSE` para propietarios operativos. Estos últimos
solo tienen nombre, email y contraseña nulos, y siguen pudiendo relacionarse con pozos.

El login exige cuenta activa, `cuenta_acceso = TRUE` y contraseña no nula. El CRUD de
`/usuarios` conserva su guardia exclusiva de administrador y sus campos de email,
contraseña, roles y activación. No se crean credenciales ficticias.

## Cambios

- `POST /pozos/propietarios` acepta únicamente `nombre`; devuelve la identidad operativa
  sin email y asigna solo el rol operativo propietario.
- Se añadieron la columna `usuario.cuenta_acceso` y la migración
  `api/db/migrations/004_propietario_operativo.sql`; la instalación completa la incluye.
- El autocomplete tolera propietarios sin email y la interfaz no solicita credenciales.
- En creación de pozo, el alta se oculta con propietario seleccionado; `CAMBIAR` limpia
  la selección y restaura el alta sin perder el borrador.
- El ajuste PDF incrementa el espacio medido entre secciones técnicas a 9/7/5 unidades
  según el nivel de compactación. `medirTabla` y el renderer usan el mismo valor, por lo
  que el fit-to-page sigue gobernando el salto de página.

## Pruebas

Focalizadas ejecutadas:

- API: `propietario-operativo.test.ts` y `pdf-composicion.test.ts` — 15/15.
- Frontend: servicio de propietario operativo y formulario — 7/7.
- Build API (`npm run build`) correcto.
- Inserción controlada en PostgreSQL verificó identidad sin email/contraseña y fue eliminada.

La validación integral final queda pendiente hasta cerrar el conjunto de cambios de esta
etapa; no se modificaron datos reales.

## Seguridad y regresiones

Se preservan cookies HttpOnly, CSRF, versión de sesión, guards de Fastify, aislamiento,
roles administrativos y SQL parametrizado. Un propietario operativo no tiene datos con los
que pueda iniciar sesión. Los pozos históricos continúan usando la FK existente y las
secciones PDF mantienen contenido, tipografías mínimas y fit-to-page.

## Riesgos y rollback

El único cambio de esquema es aditivo/relajante para permitir identidades sin cuenta; el
rollback consiste en retirar el alta operativa, conservar las filas históricas y revertir
la migración solo después de verificar que no existan identidades con `cuenta_acceso=false`.
