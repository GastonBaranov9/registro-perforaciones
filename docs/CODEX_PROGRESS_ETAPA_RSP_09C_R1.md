# RSP-09C-R1 — cierre de hallazgos del review

## Logout pending

El backend de RSP-09B revoca las sesiones activas del mismo `id_usuario` e `installation_id` antes de insertar la nueva sesión. El cliente conserva `logout_pending_v1` junto con el usuario anterior hasta recibir 204 de `logout-device` o completar un login de reemplazo: respuesta válida, token nuevo persistido en secure storage, binding actualizado, memoria autenticada y recién entonces limpieza del pending. Login inválido, red, 426, metadata o fallo de storage nunca limpian el pending. El login no adjunta el Bearer anterior. Bootstrap y resume siempre reintentan logout antes de session restore; un restart posterior a un login fallido no restaura el token reservado.

## Recursos protegidos

La auditoría encontró el mapa aéreo de `MapaAereoComponent` y las fotos persistidas de detalle/formulario de pozo. Los assets locales y previews `data:` permanecen directos. El nuevo `ProtectedResourceService` valida origin/path de la API y, en Android/iOS, usa `HttpClient` con el interceptor native para descargar Blob y crear un object URL. `ProtectedResourceDirective` lo enlaza a `img`/`ion-img`, cancela solicitudes obsoletas con `switchMap`, evita que una respuesta stale sustituya la actual y revoca cada URL al reemplazar o destruir el componente. Web conserva URL same-origin con cookie. Nunca se envía Bearer en URL, query ni a Maps/CDN/origins externos.

PDF, multipart uploads y endpoints Maps backend siguen usando los servicios existentes; no hubo cambios en API.

## Runtime desconocido

`web`, `android` e `ios` se despachan explícitamente. `unknown` produce `RuntimePlatformUnknownError`, estado `client-error`, bloquea guards/negocio y no ejecuta login, restore ni requests de credenciales web. El interceptor sólo deja pasar recursos externos sin credenciales y rechaza la API propia antes de enviar. Web permanece en el contrato cookie/CSRF vigente.

## Validación R1

La cobertura añadida verifica pending durante navegación/login fallido, replacement login seguro, storage pendiente, restart ordering, carga Blob native, object URL/revoke, race cancellation, origins externos y Maps, además de bootstrap/login/interceptor/guard unknown. La suite Angular y los builds web/native se ejecutan en el cierre de la etapa. `api/` permanece intacto.

Pendientes sin cambios: WebSocket native RSP-09D; Xcode, Keychain físico y pruebas Android/iOS en hardware RSP-09E.
