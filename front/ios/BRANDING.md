# Branding iOS — etapa móvil 04C

Base: `9140b5d7c24be52e3a6f957e649d43340247f4e3`, rama móvil. Se sustituyen exclusivamente el ícono y el splash genéricos de Capacitor. No cambia la identidad `uy.com.raulsilva.perforaciones`, iOS mínimo 15.0, familia iPhone/iPad, permisos, privacidad, dependencias Swift, API/WSS, workflow ni firma.

## Originales y derivados

Se usan solamente `front/branding/rs_icono_piloto.png` (1254 × 1254) y `rs_splash_piloto.png` (941 × 1672), comprobados contra sus hashes aprobados y `android-assets.json`. Los originales y todos los recursos Android permanecen intactos. Ambos PNG originales son RGB de 8 bits, sin alfa ni perfil ICC; se interpretan como sRGB, sin retoque cromático. Se conserva el diseño, incluida la forma redondeada ya dibujada en el original del ícono; no se añade otra máscara.

| Recurso final | Dimensiones | Formato / uso |
| --- | --- | --- |
| `App/App/Assets.xcassets/AppIcon.appiconset/rs-icon-1024.png` | 1024 × 1024 | PNG RGB 8-bit, sin alfa/tRNS, sRGB explícito; universal iOS |
| `App/App/Assets.xcassets/Splash.imageset/rs-splash.png` | 941 × 1672 | PNG RGB 8-bit, sin alfa/tRNS, sRGB explícito; un único recurso universal 1x |

AppIcon usa la entrada universal `platform=ios`, `size=1024x1024`, sin variantes oscuras inventadas. Xcode deriva los tamaños necesarios del catálogo: [documentación de Apple](https://developer.apple.com/documentation/xcode/configuring-your-app-icon). Se inspeccionaron referencias del ícono a 40, 60, 84 y 180 píxeles; las letras RS y las ondas siguen distinguibles. La máscara y el resultado efectivo de iOS requieren revisión en simulador/dispositivo.

El splash conserva exactamente su raster comprimido IDAT original. Sólo se reorganizan chunks y se sustituyen metadatos auxiliares por la declaración sRGB. No se recorta, estira, amplía en el archivo, recolorea ni inventa contenido. Un solo PNG evita tres copias idénticas y no finge aportar detalle de resolución inexistente.

## LaunchScreen

`LaunchScreen.storyboard` usa una UIView con fondo fijo **#0694FC**, RGB (6,148,252), muestreado en el píxel (800,700) del splash original. La UIImageView se ancla a los cuatro lados del área segura y usa `scaleAspectFit`. No depende de colores de sistema que puedan aparecer blancos/negros al cambiar de apariencia.

La imagen completa queda centrada y mantiene proporciones. Las franjas azules son deliberadas: permiten conservar logo, fotografía y texto en iPad y en paisaje, donde una imagen vertical no puede cubrir toda la pantalla sin recortarse o deformarse. El blanco dentro del arte original se conserva. La resolución del splash original limita su nitidez cuando el sistema lo amplía; no se generó detalle artificial ni una variante horizontal nueva.

Se revisaron referencias geométricas de iPhone 393 × 852 / 852 × 393 e iPad 820 × 1180 / 1180 × 820; las pruebas incluyen además 375 × 667 y 507 × 1180, con áreas seguras. Las referencias temporales no se versionan. **No son capturas de Xcode ni una validación física.** Las insets reales las determina UIKit; las usadas en las referencias sólo ilustran casos representativos.

Es una pantalla estática de lanzamiento; no contiene animaciones, código ni comportamiento dinámico. [Limitaciones y configuración de launch screens de Apple](https://help.apple.com/xcode/mac/current/en.lproj/dev765148f31.html).

## Reproducción y verificación

Desde `front`, con Node 24.18.0 y dependencias del lockfile:

```powershell
# Regeneración explícita en Windows 11 / Windows PowerShell 5.1:
node scripts/ios-branding.mjs --generate
node scripts/ios-branding.mjs --verify
npm.cmd run test:ios
```

El generador utiliza System.Drawing incluido en Windows para reducir el ícono con interpolación bicúbica, bordes reflejados y salida RGB de 24 bits. No instala paquetes ni usa servicios de generación de imágenes. Node valida CRC, raster, dimensiones y canal de color; emite PNG sRGB sin metadatos temporales. `branding.json` registra hashes de fuentes y salidas; no contiene fechas, secretos ni rutas privadas.

La regeneración está fijada al entorno Windows evaluado; no se promete igualdad entre versiones distintas de codecs/GDI+. Cualquier diferencia debe revisarse en Git, no aceptarse automáticamente. macOS usa los recursos versionados y puede ejecutar `node scripts/ios-branding.mjs --verify`; no necesita PowerShell ni instalar un conversor. En macOS el caso de regeneración Windows se marca explícitamente como omitido; los controles de recursos y catálogos continúan ejecutándose.

`prepare:ios` conserva el proyecto existente: no ejecuta `cap add` cuando existe y el configurador no toca el catálogo ni LaunchScreen. Se verificó sobre copia temporal que conserva el branding y su manifest. El guard existente de archivos versionados detectará cambios inesperados durante el próximo build macOS. No se cambió ningún script de preparación/compilación ni el workflow manual.

## Pruebas y alcance

- Generador ejecutado dos veces sobre destino temporal: todos los archivos idénticos byte por byte entre ejecuciones y contra los versionados.
- **83/83 contratos iOS**, incluidos 12 nuevos de branding: integridad, RGB/sRGB, catálogos, idempotencia, conservación, CRC/PNG truncado/alfa/sRGB ausente y rechazo de recorte, estiramiento, fondo dinámico o salida del área segura.
- **173/173 contratos nativos**, que incluyen los 83 iOS; no se cuentan nuevamente. Probes Gradle existentes inspeccionan modelos sintéticos y no generan APK.
- **140/140 regresiones Angular** de autenticación, almacenamiento seguro simulado, offline e interceptor/WebSocket. Total **313 casos únicos**.
- Sintaxis Node y `git diff --check` correctos. Verificador Android: dos originales y 26 derivados sin cambios. APK existente: `958676df4f0088e0ed3b5629e714ed2a9eb3f811e359789a2bb42a37cb1166e6`.
- `Package.resolved` conserva SHA-256 `56a364979903d2990a2eaad3fb86781113e286e27d4c7d63a7945dc9722ae9df`. Workflow, Xcode/SDK/runtime 26.2 y todas las barreras anteriores intactos.

Se reemplazan los cuatro PNG genéricos por dos PNG de marca; se actualizan ambos `Contents.json` y LaunchScreen. Se añaden este documento, `branding.json`, `scripts/ios-branding.mjs` y contratos en `scripts/native-ios.test.mjs`. No se incluyen previews, cachés, artefactos de app, certificados ni material empresarial nuevo.

## Pendientes separados

Después de revisar y autorizar la publicación, corresponde autorizar otra compilación de simulador del nuevo SHA y revisar LaunchScreen/AppIcon en iPhone/iPad. No se ejecutó Actions ni Xcode en 04C. Apariencia física, firma Apple, identidad registrada, equipo, aprovisionamiento, privacidad de distribución y TestFlight requieren etapas autorizadas posteriores. No hay instalación ni distribución en esta etapa.

Producción 027 y APK Android no se intervienen. Continúa pendiente el **perfil constructivo en blanco y negro según la fotografía del propietario**, conservando geometría, profundidades, sello y prefiltro 0.13. Ese cambio no forma parte del branding iOS.
