# Perfil constructivo e intervalos sin cañería

Implementación local sobre `wip/sello-sanitario-constructivo`, base `d5cedc5`.
El árbol estaba limpio al comenzar. Sin commit, push, merge, deploy ni acceso a
producción. No se modificó la numeración real 3282.

## Comportamiento

- Migración nueva `021_intervalos_sin_tuberia.sql`: columna booleana con default
  **solamente en PostgreSQL** y restricción que impide material en tramos abiertos.
  Los registros existentes quedan en `false`; sus materiales permanecen intactos.
- Contratos HTTP: `sin_tuberia` opcional **sin default ni normalización del body**.
  `true` requiere `material_tuberia: null`; `false` o ausencia mantienen las
  validaciones anteriores de escritura. El material nulo histórico se sigue
  leyendo y representando como tubería de material no especificado.
- Los selectores comparten la conversión PVC / Acero / Sin cañería. Sólo una
  elección del usuario modifica el estado; abrir un borrador no le añade defaults.
- Se conserva el estado en altas, ediciones, CRUD, históricos, consultas de
  informes, reconstrucción de datos técnicos y JSON offline. No se cambió
  `huellaOffline()` ni el protocolo de identidad o reintento.
- Un filtro es tubería instalada: se rechaza toda intersección de profundidad con
  un tramo abierto. Los límites contiguos se permiten. En CRUD la comprobación
  bloquea el pozo dentro de la transacción de escritura, compatible con el bloqueo
  de la edición completa/histórica.
- Sello: límites exteriores gráficos 0,06 y 0,94 de la columna. Sus caras
  interiores coinciden con el componente correspondiente; ancho mínimo habitual
  por lateral 0,24 (antes 0,06). Se segmenta ante cambios de diámetro, conservando
  exactamente desde/hasta y todas las capas geológicas.
- Cota cero explícita y sobresaliente de 18 unidades gráficas, sólo en superficie
  y con tubería/componente instalado llegando a cero. No se guardan alturas ni
  espesores ficticios en la base.
- Tramos abiertos: colección independiente `perforaciones_abiertas`, contorno
  discontinuo con contraste, etiqueta y tabla explícitas. Los contornos de tubo
  se interrumpen en esos tramos y respetan los diámetros de los tramos instalados.
  Los registros antiguos no se reinterpretan como abiertos.
- Tabla PDF: “Perforación y cañerías”; columna “Cañería / material”.

## Archivos de aplicación

Migración y backend:

```text
api/db/migrations/021_intervalos_sin_tuberia.sql                 [nuevo]
api/src/models/schemas.ts
api/src/services/compatibilidad-entubamiento.ts                 [nuevo]
api/src/services/intervalo-diametro-services.ts
api/src/services/intervalos-filtro-service.ts
api/src/services/pozo-completo-service.ts
api/src/services/historicos-service.ts
api/src/services/generar-informe-consultas.ts
api/src/pdf/perfil-litologico.ts
api/src/pdf/pdf-generate.ts
```

Frontend:

```text
front/src/app/shared/types/schemas.ts
front/src/app/shared/utils/intervalo-diametro.ts                 [nuevo]
front/src/app/shared/utils/datos-tecnicos-borrador.ts
front/src/app/shared/utils/tecnicos-persistidos.ts
front/src/app/shared/components/perfil-litologico/perfil-litologico.component.ts
front/src/app/shared/components/perfil-litologico/perfil-litologico.component.html
front/src/app/shared/components/perfil-litologico/perfil-litologico.component.css
front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.ts
front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.html
front/src/app/routes/pozos/pages/pozos-detail/pozos-detail.page.html
front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/components/intervalo-diam-form.component/intervalo-diam-form.component.ts
front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/components/intervalo-diam-form.component/intervalo-diam-form.component.html
front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-list/intervalos-diametros-list.page.html
```

Tests y evidencia nuevos:

```text
api/test/intervalos-sin-tuberia.test.ts
api/test/intervalos-sin-tuberia.postgres.local.ts
api/test/perfil-constructivo-casos.ts
api/test/perfil-constructivo.visual.ts
front/src/app/shared/utils/intervalo-diametro.spec.ts
front/src/app/routes/pozos/pages/tecnica/intervalos-diamentros/components/intervalo-diam-form.component/intervalo-diam-form.component.spec.ts
```

Tests existentes ajustados/ampliados:

```text
api/test/perfil-litologico.test.ts
api/test/intervalos-filtro-update.test.ts
api/test/pdf-historicos.test.ts
front/src/app/shared/components/perfil-litologico/perfil-litologico.component.spec.ts
front/src/app/routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component.spec.ts
front/src/app/core/native/offline.spec.ts
```

## Verificaciones

- Backend focalizado: **81/81**.
- Frontend focalizado, Chrome Headless: **112/112**.
- PostgreSQL descartable: **7/7** (prueba principal y seis subcasos).
  Contenedor único, puerto aleatorio en loopback, almacenamiento tmpfs, sin
  volúmenes compartidos ni `.env`. La numeración sintética comienza en 900000.
  El contenedor se elimina al terminar. La migración por sí sola no cambia el contador.
- Compilación API y compilación de producción frontend: correctas.
  Frontend emite el aviso de Stencil `empty-glob`, sin impedir la compilación.
- `npm.cmd run check:utf8`: correcto.
- Suite completa API: **425 aprobados de 430; cinco fallos preexistentes**.
  Se reprodujeron los mismos cinco en una copia temporal de `d5cedc5`:
  tres casos PDF de `numeracion-perforacion.test.ts` cargan sello como litología;
  `operador-administrativo.test.ts` no contempla SQL de sello en su mock;
  `sesion-desactivada-auditoria.test.ts` espera 200 y obtiene 500.
  No se alteraron estos módulos ni sus pruebas ajenas al cambio.
- `git diff --check`: sin errores. Diff limitado a este requerimiento.

Comando backend focalizado, desde `api`:

```powershell
node --test --experimental-strip-types test/intervalos-sin-tuberia.test.ts test/perfil-litologico.test.ts test/intervalo-diametro-update.test.ts test/intervalos-filtro-update.test.ts test/pozo-completo.test.ts test/pdf-historicos.test.ts test/historicos.test.ts test/sello-sanitario-constructivo.test.ts
```

Integración reproducible, desde `api`, con Docker local disponible:

```powershell
node --experimental-strip-types test/intervalos-sin-tuberia.postgres.local.ts
```

## Revisión visual local sin crear perforaciones

Desde la raíz del repositorio:

```powershell
node --experimental-strip-types api/test/perfil-constructivo.visual.ts --serve
```

Requiere las dependencias ya instaladas de `api` y `front`, y Chrome local
(`CHROME_BIN` permite indicar otra ruta). Compila el **componente Angular real**
con los modelos del generador real y genera los PDF con el renderizador real.
No llama a la API ni consulta PostgreSQL.

1. Abrir la URL `http://127.0.0.1:<puerto>/?caso=A` que imprime el comando.
   Basalto 0–20, PVC 8" 0–20, sello 0–10. Revisar espesor, contacto, cota cero y
   sobresaliente. Abrir también `%TEMP%\rsp-perfil-constructivo-evidencia\caso-A.pdf`.
2. Cambiar la URL a `?caso=C`. PVC 8" 0–20 y abierto 8" 20–50. Comprobar que las
   líneas de cañería terminan en 20 m y que el tramo abierto conserva diámetro,
   etiqueta y litología. Comparar con `caso-C.pdf`.
3. `?caso=B`: sello exclusivamente 5–12. `?caso=F`: cambios de diámetro y cañería
   posterior al tramo abierto. `?caso=D`: material nulo legado.
4. Ctrl+C cierra el servidor temporal. Las capturas `preview-*.png`, los modelos
   `casos.json` y los PDF permanecen en la carpeta de evidencia.

Para probar los formularios contra una base local propia, aplicar primero la
migración 021 **en esa base descartable** y ejecutar API/frontend compatibles.
Seleccionar Sin cañería, guardar, reabrir y cambiar a PVC o Acero. No aplicar
migraciones contra el entorno real como parte de esta revisión.

## Límites pendientes

- Las tres imágenes de referencia no estaban disponibles en el mensaje recibido;
  la implementación se basó en los requisitos escritos.
- La revisión visual de los casos A y C (preview y PDF) fue aprobada por el
  usuario. Pendientes impresión física y prueba en dispositivo Android real.
  Offline se verificó con tests y PostgreSQL local.
- Las PNG auxiliares de PDF se obtuvieron con WinRT y se inspeccionaron; ese
  proceso de Windows falló durante su cierre nativo. El helper quedó fuera del
  repositorio. La generación de los PDF fuente y las capturas Angular finaliza
  correctamente con el script reproducible anterior.

## Validación funcional final — 2026-10-20

Rama confirmada: `wip/sello-sanitario-constructivo`, HEAD `d5cedc5`. Se conservaron
los 36 archivos de la implementación local mediante comparación SHA-256 antes
y después de las pruebas. En esta validación sólo se actualizó este documento;
no se modificó código ni geometría. No se hicieron commits ni operaciones remotas.

### Resultados

- **PostgreSQL 16 descartable: 8/8 pruebas correctas.** Migraciones 000–020,
  fila antigua con material nulo, aplicación de 021 y segundo pase sin pendientes.
  La migración conserva filas, material y contador; rechaza `sin_tuberia=true`
  con material PVC. El contador de laboratorio comenzó en 900000.
- **46 solicitudes HTTP verificadas**, con Fastify, autenticación por cookie,
  CSRF, autorización, servicios y PostgreSQL reales. No se simularon persistencia
  ni consultas. El cliente de prueba usó `app.inject`; no fue una sesión manual
  completa de navegador.
- **Histórico A:** alta y reintento idempotente, profundidad 20 m, Basalto
  0–20 m (entrada de catálogo «Basalto marrón»), PVC 0–20 m y sello independiente
  0–10 m. Guardado, detalle, litología, perfil y PDF correctos. El alta histórica
  no consume el contador automático.
- **Normal C:** PVC de 8 pulgadas 0–20 m y Sin cañería de 8 pulgadas 20–50 m.
  Lectura posterior y reemplazo completo conservan medidas, estado y material
  nulo. El perfil persistido termina los contornos de cañería en 20 m y mantiene
  la perforación abierta hasta 50 m.
- **Edición:** transiciones Sin cañería → PVC → Acero → Sin cañería por CRUD
  normal y edición histórica, conservando diámetro y extremos. La edición
  histórica parcial conserva intervalos omitidos y sello independiente.
- **PDF persistido:** descarga HTTP de A/C antes y después de editar; archivos
  válidos, litología y sello presentes. En C se verificaron también los textos
  «Sin cañería», «Perforación sin cañería» y «20-50 m» en el PDF serializado.
- **Offline:** solicitudes antiguas sin el campo y nuevas con tramo abierto,
  sesión de perforador, misma clave en el reintento, mismo ID y misma huella.
  No se agregaron campos a los cuerpos antiguos. Los conflictos filtro/tramo
  abierto se rechazaron en ambos sentidos.
- **Frontend Chrome Headless: 143/143 correctas**, incluyendo formularios
  técnicos, selector individual, reconstrucción de datos, históricos, borradores
  y sincronización offline. Son tests de componentes/servicios, no una prueba
  de interfaz completa contra PostgreSQL.
- **Suite API completa: 425/430 correctas.** Se reprodujeron exactamente los
  cinco fallos preexistentes en la copia de HEAD: 14/19 en los tres archivos
  afectados. Los 213 archivos fuente/test de esa copia coinciden con HEAD,
  normalizando únicamente finales de línea CRLF/LF.
- `git diff --check`: correcto. No quedaron contenedores del ensayo. No se
  leyó `.env` ni se conectó a producción; la numeración real 3282 no se tocó.

### Cinco fallos preexistentes, sin correcciones fuera de alcance

| Archivo | Casos | Resultado reproducido en HEAD |
| --- | ---: | --- |
| `api/test/numeracion-perforacion.test.ts` | 3 | PDF con números 2047, null y undefined: fixture usa sello como litología; `PerfilLitologicoInvalido`. |
| `api/test/operador-administrativo.test.ts` | 1 | Alta normal HTTP: mock no contempla el borrado del sello; 500 frente a 201 esperado. |
| `api/test/sesion-desactivada-auditoria.test.ts` | 1 | Escenario de desactivación/reactivación: actualización devuelve 500 frente a 200 esperado. |

### Evidencia y reproducción

Carpeta local: `%TEMP%\rsp-validacion-final-persistida`.

- `caso-A-persistido.pdf`, `caso-C-persistido.pdf` y sus JSON: respuestas reales
  de detalle, intervalos, litología y perfil después de guardar y editar.
- `http-resultados.json`: las 46 solicitudes y sus estados.
- `resultado-postgres-http.txt`, `verificacion-baseline.txt`,
  `api-completa.log`, `api-base-d5cedc5.log`, `frontend.log`: resultados.
- `validacion-http.ts`: extensión temporal de la integración existente, fuera
  del repositorio. Se ejecuta con `node --experimental-strip-types
  "$env:TEMP/rsp-validacion-final-persistida/validacion-http.ts"` desde `api`,
  con Docker local. Crea y elimina su propia base; no conserva registros para
  navegación manual. `intentos-fixture-previos.log` corresponde a la preparación
  del script temporal, no al resultado final exitoso.

### Verificación manual adicional, si se desea

No hace falta repetir la aprobación geométrica. No se ejecutó una sesión
completa de clics contra la API ni una sincronización en Android físico.
Para comprobarlas, usar exclusivamente una instancia local con PostgreSQL
descartable y migraciones hasta 021:

1. Como administración, crear un histórico con número libre entre 1 y 3281,
   profundidad 20 m, Basalto marrón 0–20, PVC de 8 pulgadas 0–20 y sello 0–10.
   Guardar, salir, volver a entrar al detalle y abrir perfil/PDF. La litología
   debe conservar 0–20 y el sello 0–10 como elemento independiente.
2. Crear una perforación local de 50 m con PVC de 8 pulgadas 0–20 y Sin cañería
   de 8 pulgadas 20–50. Guardar, salir y reabrir. En edición del segundo tramo,
   seleccionar PVC, guardar y reabrir; repetir con Acero y con Sin cañería.
   En cada paso deben conservarse 20, 50 y 8. En el último paso, detalle y PDF
   deben decir Sin cañería y el tubo del perfil terminar en 20 m.
3. En un dispositivo de prueba conectado a esa API local, iniciar sesión como
   perforador, cargar previamente los catálogos y desconectar la red. Crear un
   borrador con los intervalos del paso 2, cerrar y reabrir la aplicación.
   Verificar el tramo abierto, reconectar y sincronizar. Reabrir desde el
   servidor y verificar un único registro con las mismas medidas y estado.

No se detectaron defectos funcionales nuevos. La rama está en condiciones de
preparar el commit de cierre y su integración posterior, dejando explícita la
deuda de los cinco tests preexistentes: la suite general no está completamente
verde.

## Cierre de implementación

El commit de cierre conserva la validación aprobada: PostgreSQL **8/8**, **46**
solicitudes HTTP, frontend Chrome **143/143** y API **425/430**. No se repitieron
suites extensas porque código, pruebas y migración coinciden con lo validado.
Los cinco fallos reproducidos sobre `d5cedc5` permanecen documentados y fuera
del alcance de este cierre.

Quedan explícitamente pendientes:

- Prueba manual completa de interfaz contra PostgreSQL descartable.
- Validación de sincronización en Android físico.
- Verificación final antes del despliegue productivo, incluyendo el resultado
  integrado y la aplicación de la migración 021 en un entorno de ensayo.

Este cierre no integra cambios a `feature/rsp-10-pilot-apk` ni autoriza push o
despliegue. Producción y la numeración automática real 3282 permanecen intactas.
