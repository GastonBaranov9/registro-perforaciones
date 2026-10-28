# Etapa móvil 01: aislamiento Android e iOS

Trabajo local desde `de69b489dc0bce69d49fe7393a7101f8b23ebe81`, rama
`feature/rsp-mobile-multiplataforma`. No hay despliegue, laboratorio en marcha,
APK/IPA instalada ni prueba física completada. Producción web/API 027 no se interviene.

## Selección de variante

La selección explícita `RSP_MOBILE_VARIANT=lab` se comparte entre el build Angular,
Capacitor y Gradle. Sin esa variable se conserva la identidad productiva
`uy.com.raulsilva.perforaciones` y su nombre original.

Laboratorio usa `uy.com.raulsilva.perforaciones.pruebas` y
**Raúl Silva Perforaciones - Pruebas**. Gradle aplica `applicationIdSuffix` sólo
en laboratorio, conserva el namespace Java de MainActivity y superpone recursos
debug para nombre, package_name y custom_url_scheme. Comprueba además el ID
efectivo de la variante. No altera los recursos productivos. El FileProvider ya
usa `${applicationId}`. Son paquetes diferentes, por lo que el sistema no puede
instalar uno como actualización del otro: quedan separados UID, sandbox,
Preferences, credenciales y archivos/colas. No se habilita almacenamiento compartido.

Sólo se admite **debug** de laboratorio, no release ni firma de distribución.
La configuración rechaza las variables de firma en modo lab. Capacitor selecciona
el mismo bundle ID de pruebas para el futuro proyecto iOS. No se creó ese proyecto.
Keychain debe continuar sin grupos compartidos ni sincronización iCloud; la
implementación existente usa almacenamiento del dispositivo, no credenciales web.

## Backend autorizado y cadena de artefactos

`front/mobile-lab.example.json` es deliberadamente inoperante: origen vacío y
allowlist vacía. Después de aprobar un HTTPS real, copiar el esquema a un archivo
privado **fuera del repositorio**, sin utilizar directorios productivos. Completar:
Usar el nombre `mobile-lab.private.json`; Git excluye además ese nombre y el
directorio `mobile-lab.private/` como defensa ante una copia accidental al repositorio.

- `appId`: exactamente `uy.com.raulsilva.perforaciones.pruebas`.
- `backendOrigin`: origin HTTPS exacto (sin barra final, path, usuario o parámetros).
- `allowedOrigins`: lista explícita, no vacía, sin duplicados, que contenga ese origen.

`NATIVE_LAB_CONFIG` señala esa ruta absoluta. Si se define también
`NATIVE_BACKEND_ORIGIN`, debe coincidir exactamente. No hay destino de laboratorio
operativo preautorizado en Git. Los dominios institucional, www, app y api reales
se rechazan incluso si aparecen en la allowlist; también variantes con puerto o
punto DNS final. Se rechazan HTTP, parámetros mezclados, overrides de identidad y
`NODE_TLS_REJECT_UNAUTHORIZED=0`. No se incorporan excepciones TLS nativas.
El laboratorio exige un hostname DNS concreto: rechaza comodines, caracteres
inválidos, localhost y direcciones IP. Los fixtures `.invalid` no son destinos operativos.

El build usa el modo runtime development existente para autenticación nativa,
pero con configuración de origen ya cerrada por el contrato lab. Genera en
`front/dist/mobile-lab/browser`, separado de `dist/front/browser` productivo.
Incluye permanentemente **ENTORNO DE PRUEBAS**, reserva espacio sobre Ionic y
contempla el safe area. Sólo aparece en el HTML generado para laboratorio.

Se deriva WSS de HTTPS y se incluye en CSP. `rsp-native-build.json` registra modo,
identidad, origen, WSS y SHA-256 de los assets. El verificador comprueba el JS
compilado, CSP, ausencia de hosts productivos, banner e integridad de los archivos.
`preBuild` de Android verifica además `capacitor.config.json`: rechaza assets de
otra variante, destinos diferentes, contenido modificado y configuración de red
remota/mixed content. No basta con cambiar una variable de Gradle.
La revisión de cierre reforzó la CSP: debe existir una única meta efectiva con
la política completa esperada, sin orígenes adicionales. También se inspeccionan
los archivos Cordova que Capacitor agrega después de Angular.

El manifiesto no es una firma criptográfica contra un desarrollador que modifique
el código; es una barrera contra mezclas accidentales en el procedimiento normal.
Después de este cambio, los assets nativos anteriores sin manifiesto deben
regenerarse y sincronizarse antes de empaquetar. La identidad, autenticación y
reglas de backend de producción permanecen iguales.

Secuencia futura, desde `front`, **sólo tras autorizar el laboratorio y la APK**:

```powershell
$env:RSP_MOBILE_VARIANT = 'lab'
$env:NATIVE_LAB_CONFIG = '<ruta absoluta privada del JSON aprobado>'
npm.cmd run build:native:lab
npx.cmd cap sync android
npm.cmd run verify:native-assets
Set-Location android
.\gradlew.bat assembleDebug
```

Mantener esas variables durante toda la secuencia. No usar assets del ensayo
sintético para distribuir. Antes de instalar, inspeccionar el APK final con las
herramientas SDK (ID, nombre, manifest, assets y origen), calcular SHA-256 y pedir
autorización de instalación. No desinstalar el piloto ni borrar su almacenamiento.

## Docker independiente, aún sin levantar

`ops/mobile-lab/compose.json` es Compose válido expresado en JSON, independiente de
`docker-compose.production.yaml`. Reutiliza solamente Dockerfiles de código fuente.

| Recurso | Laboratorio |
|---|---|
| Proyecto | `rsp-mobile-lab` |
| PostgreSQL / usuario / base | servicio `postgres` / `rsp_mobile_lab` / `rsp_mobile_lab` |
| Persistencia | `rsp-mobile-lab_lab_db`, `rsp-mobile-lab_lab_files` |
| Redes | `rsp-mobile-lab_lab_db` interna; `rsp-mobile-lab_lab_edge` propia |
| Acceso al host | únicamente `127.0.0.1:18080` del proxy |
| Imágenes | `rsp-mobile-lab-api`, `rsp-mobile-lab-front`, `rsp-mobile-lab-proxy`, etiquetadas por SHA |
| Migrador | perfil `setup`, migraciones existentes 000–027 sin alterarlas |
| Cuenta inicial | `admin@rsp-mobile-lab.invalid`, contraseña nueva por stdin |

No hay puertos PostgreSQL publicados, volúmenes externos, bind mounts de datos,
redes de otros proyectos ni env files productivos. La API conserva su usuario
sin privilegios y su directorio de fotografías dentro del volumen propio.
No se importa ninguna copia de producción. Una instancia vacía utiliza su propio
contador y política; nunca se copian ni imponen los valores empresariales actuales.

`validate.mjs` rechaza proyectos, rutas, montajes, hosts PG, imágenes y redes
incompatibles. La validación de ambiente rechaza variables Compose/PG heredadas,
exige tres secretos hexadecimales aleatorios independientes, SHA completo y
coherencia con el origen permitido. No imprime los secretos. Los controles no
autorizan ejecutar Compose directamente con overrides manuales, `-p rsp-pilot`,
otros env files ni perfiles ajenos; esos usos quedan fuera del procedimiento.
Se verifican también los argumentos de construcción, contratos completos de
entorno y destinos de base, y se rechazan overrides de contexto/host Docker y
env files Compose. Los errores de la CLI no vuelcan diffs que puedan contener secretos.

La API del lab se prepara en `NODE_ENV=production` para conservar sus comprobaciones
de cookies, proxy, autenticación y TLS externo. Eso exige una **clave Maps propia**
en `LAB_MAP_KEY`: no copiar la real ni introducir una ficticia para el arranque.
Hasta configurar ese requisito el laboratorio no está listo para iniciarse.
No se modifica Google Maps productivo ni su proveedor.

Comprobaciones locales sin iniciar servicios:

```powershell
node ops/mobile-lab/validate.mjs
docker compose -f ops/mobile-lab/compose.json --env-file ops/mobile-lab/.env.example config --no-interpolate --quiet
```

Para la futura puesta en marcha se requiere otra autorización: elegir el host,
confirmar puerto y recursos disponibles, preparar archivo de entorno privado
independiente, generar secretos, habilitar HTTPS privado y completar el JSON de
orígenes. Ejecutar `node ops/mobile-lab/validate.mjs --environment` con ese ambiente
y `RSP_MOBILE_VARIANT=lab`. Verificar checkout/SHA e inventario 000–027 de la imagen
antes de ejecutar el migrador. Luego crear **únicamente** los recursos de lab,
migrar su base vacía, ejecutar el bootstrap oficial por stdin y levantar API,
front y proxy. No iniciar la API antes de terminar las migraciones. No se preparan
comandos destructivos ni una importación/restauración de producción.

`synthetic-data.json` es una guía de carga posterior, no un seed que se ejecute.
El administrador creará en el lab cuentas operador_administrativo y perforador
con contraseñas independientes para probar sus roles. Los casos LAB A/B no son
perforaciones reales. Confirmar aislamiento y health/login antes de autorizar
escrituras desde teléfonos.

## HTTPS desde Android, iPhone e iPad

Recomendación para un único propietario: **Tailscale privado + Serve HTTPS**,
sin Funnel, sin subnet routing y sin exit node. Serve publica el proxy loopback
sólo dentro de la tailnet y administra un certificado válido; no se ignoran errores
TLS. Seleccionar ACL/grants para que únicamente los dispositivos del propietario
alcancen ese servicio, sin acceso a otros puertos de la PC productiva.

Alternativas: un subdominio público restringido requiere DNS/túnel/acceso y tiene
mayor exposición; una capa de login adicional puede interferir con autenticación
nativa/WebSocket. Una VPN convencional con DNS y certificado público es viable,
pero requiere más gestión. Una CA casera instalada en los teléfonos añade manejo
de confianza y se descarta para esta etapa.

Pendiente de autorización: instalar/configurar Tailscale en servidor y dispositivos,
activar certificados HTTPS, definir nombre real no sensible (certificados visibles
en Certificate Transparency), restricciones de acceso y proxy local 18080. Verificar
Host, `/api`, WSS, cookies, auth nativa y TLS desde cada dispositivo. Registrar el
origin real en la allowlist sólo después de esa revisión. No se realizó nada de esto.

Fuente: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## iOS desde Windows, sin generar proyecto todavía

La selección de identidad/origen está preparada en Capacitor. En una etapa
autorizada se agregará `@capacitor/ios` 8.5.0 como dependencia directa y se creará
un workflow manual de GitHub Actions con runner macOS y Xcode 26 o superior.
Fijar versiones/actions, checkout exacto, Node compatible, `npm ci`, variables lab
y archivo de orígenes validado. Ejecutar build lab, `cap add ios` y `cap sync ios`.
Conservar el proyecto generado en un cambio revisado para no perder configuraciones
en sucesivas compilaciones. Configurar bundle ID `.pruebas`, nombre de pruebas,
`TARGETED_DEVICE_FAMILY=1,2` (universal iPhone/iPad), permisos de cámara, biblioteca
y ubicación y plugins Swift Package Manager compatibles.

Antes de empaquetar se adaptará el verificador de assets/identidad a los artefactos
Xcode, igual que el control Android. Primero compilar para simulador sin firma;
después resolver firma de desarrollo/distribución y prueba física mediante una
autorización separada. No hay workflow, proyecto Xcode, IPA, certificados, cuenta
Apple solicitada ni secretos incorporados en esta etapa.

Fuente: [requisitos Capacitor 8](https://capacitorjs.com/docs/updating/8-0).

## Protocolo físico pendiente

1. Confirmar ID de pruebas, banner y backend aislado antes del primer login.
2. Probar credenciales de operador/perforador, caducidad de sesión y logout nativo.
3. Cámara y galería: permiso concedido/denegado, orientación, foto recuperable y
   persistencia después de cerrar. Usar objetos sintéticos, no clientes/documentos reales.
4. GPS: permiso, coordenadas reales seleccionadas, disponibilidad/error del hardware;
   no inventar coordenadas si el iPad no dispone de GPS o no hay señal.
5. Crear borrador ficticio con sello/prefiltros, apagar conectividad, cerrar/reabrir,
   comprobar campos/fotografía. Reconectar y sincronizar sólo al lab; reintentar
   sin recrear claves idempotentes y comprobar ausencia de duplicados.
6. Comprobar registros antiguos sintéticos sin prefiltro, edición online, etiquetas,
   geometría 0.13, perfil, PDF online, apertura y exportación nativa.
7. iPhone: primero navegación Safari; después prueba nativa independiente. Safari
   **no** valida Keychain, Filesystem ni cola nativa de iOS.
8. iOS: suspender/reanudar, recuperar red y verificar que la sincronización continúa
   sin duplicados. iPad: vertical/horizontal, formularios, gráficos, tablas, fotos,
   selección de archivos y presentación de compartir PDF.

La edición offline de pozos existentes y la generación completa de PDF offline
**no forman parte del alcance actual comprobado**. No borrar almacenamiento ni
colas para resolver un fallo. Ningún dispositivo físico está validado en esta etapa.

## Ensayos y límites

Inventario de código/configuración de esta etapa:

- Modificados: `.gitignore`, `front/capacitor.config.ts`, `front/package.json`,
  `front/android/app/build.gradle`, `front/scripts/build-native.mjs`,
  `front/scripts/native-backend-config.mjs`, `front/scripts/verify-native-assets.mjs`.
- Nuevos en frontend: `front/mobile-lab.example.json`,
  `front/android/app/src/mobileLab/res/values/strings.xml` y, en `front/scripts/`,
  `mobile-build-config.cjs`, `native-artifact.mjs`, `native-lab-isolation.test.mjs`,
  `verify-native-selection.mjs`, `test-mobile-lab-build.mjs`, `test-mobile-lab-gradle.mjs`.
- Nuevos en operaciones: `ops/mobile-lab/compose.json`, `.env.example`,
  `validate.mjs`, `synthetic-data.json`, `proxy/Dockerfile` y
  `proxy/default.conf.template` (todas esas rutas bajo `ops/mobile-lab/`).
- Documento nuevo: `docs/MOVIL_01_AISLAMIENTO.md`.

Ensayos automatizados de origen/identidad/artefactos/Compose, regresiones de contratos
nativos y build real Angular con HTTPS sintético inexistente. El ensayo Gradle
consulta variantes reales sin APK y comprueba la presencia de la barrera preBuild.
Los archivos temporales contienen sólo fixtures; no se necesitan datos de producción.
Resultados iniciales: 67 casos únicos aprobados. En el cierre se repitieron esos
controles y se agregaron casos negativos: 86/86 aprobados. Builds Angular lab y
native-production correctos con destinos sintéticos, sin conexiones a sus APIs;
análisis de assets aprobado. Modelos Gradle production/lab verificados,
overlay debug correcto y release lab rechazado mediante dry-run. Compose validado
por el contrato local y por renderizado Compose con valores sintéticos, sin
iniciar el motor ni servicios. `git diff --check` sin errores. Angular emitió la
advertencia `empty-glob` de Stencil; Gradle mantiene advertencias de flatDir y
deprecaciones para Gradle 9. No se desactivó ningún control para ocultarlas.
Los assets sintéticos generados en `dist/mobile-lab` están ignorados por Git y no
se deben sincronizar ni distribuir. No se levantó el laboratorio ni se ejecutaron
migraciones, instalaciones ni push. El cierre autoriza únicamente un commit local.

La revisión examinó los 21 archivos originales y añadió `.gitignore` (22 archivos
en total). Además de reforzar CSP/Compose y el rechazo de orígenes incorrectos,
se corrigió la guía sintética para usar el nombre real del rol `administracion`.
No se cambió el bootstrap, ningún rol real, migración ni código empresarial.
La comprobación Android alcanza assets compilados y modelos Gradle efectivos;
no se generó APK final ni se verificó una instalación. Esa revisión del paquete
y las pruebas físicas siguen pendientes, al igual que iOS y el backend HTTPS.

Pendiente posterior: **PERFIL CONSTRUCTIVO EN BLANCO Y NEGRO**, utilizando nuevamente
la fotografía de referencia del propietario. No implementar por suposición;
conservar geometría, profundidades, intervalos, sello y prefiltro de grosor 0.13.
