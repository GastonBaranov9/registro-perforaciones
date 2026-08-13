# Progreso ETAPA-RSP-06I-R2 — separar identidades operativas de cuentas

## Resultado

Se cerró el P2 que mezclaba identidades operativas sin credenciales con cuentas administrativas.

- `cuenta_acceso = TRUE` es ahora el límite explícito del CRUD administrativo de usuarios.
- `GET /usuarios` y `GET /usuarios/:id_usuario` solo devuelven cuentas con email y credenciales.
- `PUT /usuarios/:id_usuario` y `DELETE /usuarios/:id_usuario` tratan una identidad operativa como no encontrada.
- `PUT /usuarios/:id_usuario/roles/:id_rol` rechaza identidades sin cuenta antes de modificar roles.
- La creación administrativa establece explícitamente `cuenta_acceso = TRUE`.
- El flujo de candidatos de pozo no se mezcló con `UsuarioPublico`: las identidades operativas continúan siendo candidatas de propietario y pueden usarse al crear pozos.
- Login conserva la condición `cuenta_acceso = TRUE` y `password IS NOT NULL`; una identidad operativa sigue siendo rechazada.

## Causa

Los servicios administrativos consultaban `usuario` sin filtrar `cuenta_acceso`. Por eso podían devolver `email = NULL` bajo el schema `UsuarioPublico` y permitir que el formulario o el endpoint de roles tratara una identidad operativa como cuenta.

## Pruebas

- Prueba focal de servicios: `api/test/usuarios-cuentas.test.ts` — 4/4.
- Pruebas focales existentes de sesión y propietario operativo — 10/10.
- `npm run build` de API correcto.
- Prueba HTTP real `api/test/rsp06i-r2-http.local.ts`: `GET /usuarios` 200 sin la identidad operativa, detalle 404, roles 404 y autocomplete de propietario correcto.
- El flujo completo de propietario operativo y creación de pozo continúa cubierto por `api/test/rsp06i.local.ts`.

## Validación final

Resultado final: build API correcto; suite API 124/124; `check:utf8` correcto; build frontend correcto; suite frontend 147/147; prueba HTTP real correcta; `git diff --check` correcto.
