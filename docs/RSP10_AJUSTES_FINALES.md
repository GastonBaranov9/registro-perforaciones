# RSP-10 — Ajustes finales para revisión

30/09/2026. Rama `feature/rsp-10-pilot-apk`, HEAD `2f7c80e85d23`. Se conservaron los cambios locales de la renovación anterior.

Actualización 01/10/2026: según el operador, `009` ya está aplicada y registrada en el piloto. Su alta dejó 30 entradas iniciales y provocó un fallo de verificación final. La [corrección forward-only 010](RSP10_CORRECCION_FORWARD_ONLY.md) deja Sello sanitario activo y `es_inicial=false`, conservando las 29 iniciales históricas. `009` permanece intacta. Los resultados y cambios de `009` descritos a continuación son históricos.

## Cambios y archivos

| Archivos de este ajuste | Resultado |
| --- | --- |
| `front/src/app/routes/home/home.page.{html,css,ts}` | Recupera `assets/branding/background.jpeg` como fondo responsive. La perforadora queda visible y la tarjeta blanca al 97% mantiene la lectura, sin blur ni animaciones nuevas. Se retira la acción de administración del Home y sus dependencias. |
| `front/src/app/app.html`, `app.spec.ts` | Administración de litologías pasa al menú, sólo para administradores. Test de visibilidad con sesión anónima, perforador y administrador. Header y nombre compacto conservados. |
| `front/src/app/routes/login/login.page.{html,css,ts,spec.ts}` | Ojo de 48 px, contraseña oculta inicialmente, alternancia password/text, etiqueta accesible Mostrar/Ocultar contraseña e icono decorativo. El clic conserva el foco del campo; el botón funciona con teclado y no envía el login. Mantiene ngModel/autocomplete, desactiva autocapitalización y corrección ortográfica, y vuelve a ocultar después del login exitoso. |
| `api/db/migrations/009_sello_sanitario.sql` | Mantiene el CHECK ampliado y la inserción sin sobreescritura; agrega validación explícita de colisión por nombre normalizado con otro código. |
| `api/test/sello-sanitario-postgres.local.ts` | Prueba datos históricos, re-ejecución, código preexistente personalizado, nombre exacto, nombre equivalente normalizado, conflicto doble y rollback de todo el DDL. |
| `front/scripts/responsive-audit.mjs` | Verifica carga real del fondo, traslado de acceso al menú, ojo mediante mouse/teclado/touch simulado, foco, valor y etiqueta accesible dentro del Shadow DOM. Permite configurar altura del viewport. |

También se agregaron este reporte y las capturas/mediciones de `docs/evidence/rsp10/final-adjustment/` y `final-compact/`, y se enlazaron desde el informe y la galería anteriores. No se añadieron dependencias ni se cambiaron los archivos de imagen.

## Migración 009

**Estado al 01/10/2026: 009 aplicada y registrada según el operador; 010 preparada para aplicación posterior autorizada. En esta corrección no se accedió al piloto.**

La migración histórica `003` ya declara `catalogo_litologia_nombre_normalizado_uq UNIQUE (nombre_normalizado)`. La normalización contempla mayúsculas, acentos y espacios repetidos. No se reescribió `003` ni ninguna otra migración aplicada.

Se añadió un control previo explícito porque, si el código `sello_sanitario` ya existe con otro nombre y una segunda fila ocupa el nombre «Sello sanitario», `ON CONFLICT (codigo) DO NOTHING` puede resolver primero el conflicto de código y omitir silenciosamente el de nombre. Ahora ese caso falla con SQLSTATE `23505` y un mensaje que pide revisar el catálogo.

Resultado en PostgreSQL aislado:

- Agrega `concrete` al CHECK y crea `sello_sanitario`, «Sello sanitario», `#999999`, patrón `concrete`.
- Conserva los 29 materiales históricos y los intervalos byte a byte en las consultas de verificación.
- Re-ejecutar no duplica ni modifica entradas.
- Un código preexistente conserva nombre, color, patrón, orden, estado activo y demás valores administrativos.
- Nombre exacto/equivalente bajo otro código y conflicto doble: error explícito; rollback conserva catálogo, intervalos y el CHECK anterior.
- Profundidad editable e independencia del booleano sanitario conservadas. Los tests SVG/PDF siguen pasando.

El contenedor de prueba usó PostgreSQL 16 con `--network none`, sin puertos, sin volúmenes ni bind mounts y con datos en tmpfs. No se leyó configuración de conexión del piloto. El script verifica estas condiciones antes de escribir.

Para aplicar posteriormente `010` rige el [procedimiento controlado actualizado del informe principal](RSP10_DISENO_Y_VALIDACION.md#e-sello-sanitario-y-despliegue-controlado). El runner conserva el ledger `000..009` y aplica únicamente la corrección pendiente. Las expectativas vigentes son once migraciones hasta `010`; el fallo artificial de pruebas pasó a `011_control_failure.sql`.

## Validaciones de esta revisión

| Comprobación | Resultado |
| --- | --- |
| Suite frontend, Chrome Headless | PASS, 362 tests; incluye login web y configuración Android simulada |
| Suite backend | PASS, 315 tests, incluidos catálogo/perfil/PDF |
| Build web productivo | PASS |
| Build nativo productivo con `https://api.raulsilvaperforaciones.com` | PASS |
| Capacitor sync Android | PASS, 7 plugins |
| SHA-256 de assets nativos | PASS, 215 archivos idénticos |
| Gradle `test lint assembleDebug` | PASS |
| Responsive a 320, 360, 390, 430, 768 y 1280 px | PASS: 24 mediciones de Home/login/usuarios/catálogo a altura 900 px |
| Home/login a altura 568 px, mismos seis anchos | PASS: 12 mediciones adicionales, incluida pulsación táctil simulada |
| PostgreSQL aislado: migración y cuatro escenarios de conflicto | PASS |
| UTF-8 y `git diff --check` | PASS |

Las comprobaciones del navegador usan DOM/Shadow DOM reales, medidas geométricas y fixtures locales. Se inspeccionaron capturas móviles y de escritorio. La prueba reducida a 568 px no equivale al teclado nativo Android: ese comportamiento debe confirmarse físicamente. Persisten únicamente los avisos de build ya conocidos de Stencil y deprecaciones Gradle.

Los logs locales están en `docs/evidence/rsp10/final-*.log`, ignorados por Git. [Resultados y hash del APK debug](evidence/rsp10/final-results.json). No se generó ni instaló un APK release.

## Evidencia y estado Git

- [Galería de estos ajustes](evidence/rsp10/final-adjustment/index.html).
- [Geometría a 900 px de altura](evidence/rsp10/final-adjustment/geometry.json) y [a 568 px](evidence/rsp10/final-compact/geometry.json).
- [Estado Git completo, diff stat y archivos para futuro commit](evidence/rsp10/git-review.txt). Incluye también la renovación anterior, todavía sin commit.

**Pronto para revisión humana y posterior commit por el usuario.** Revisar especialmente Home en el teléfono, ojo con teclado Android abierto y acceso administrativo desde el menú. No hubo commit, push, PR, cambio de rama, instalación, migración del piloto ni cambios de credenciales, identidad o versión Android.
