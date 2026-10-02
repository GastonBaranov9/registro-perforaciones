$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$frontRoot = Split-Path $PSScriptRoot -Parent
$resRoot = Join-Path $frontRoot 'android/app/src/main/res'
$icon = [Drawing.Image]::FromFile((Join-Path $frontRoot 'branding/rs_icono_piloto.png'))
$splash = [Drawing.Image]::FromFile((Join-Path $frontRoot 'branding/rs_splash_piloto.png'))
$outputs = [Collections.Generic.List[string]]::new()
function Save-ScaledImage($Source, [string]$Relative, [int]$Width, [int]$Height, [double]$Scale = 1, [string]$Mode = 'contain') {
    $target = Join-Path $resRoot $Relative
    [IO.Directory]::CreateDirectory((Split-Path $target -Parent)) | Out-Null
    $bitmap = [Drawing.Bitmap]::new($Width, $Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        if ($Mode -eq 'portrait') {
            # La fotografía completa conserva su ancho; sólo el terreno del borde inferior
            # se prolonga hasta el borde de teléfonos 9:20.
            $groundStart = [int][Math]::Round($Source.Height * 0.84)
            $groundY = [int][Math]::Round($groundStart * $Width / $Source.Width)
            $graphics.DrawImage($Source, [Drawing.Rectangle]::new(0, 0, $Width, $groundY),
                [Drawing.Rectangle]::new(0, 0, $Source.Width, $groundStart), [Drawing.GraphicsUnit]::Pixel)
            $graphics.DrawImage($Source, [Drawing.Rectangle]::new(0, $groundY, $Width, $Height - $groundY),
                [Drawing.Rectangle]::new(0, $groundStart, $Source.Width, $Source.Height - $groundStart), [Drawing.GraphicsUnit]::Pixel)
            $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png)
            $outputs.Add('android/app/src/main/res/' + $Relative)
            return
        }
        if ($Mode -eq 'landscape') {
            # Extensión del entorno bajo la fotografía íntegra para pantallas anchas.
            $graphics.DrawImage($Source, 0, 0, $Width, $Height)
        }
        $ratio = $(if ($Mode -eq 'cover') { [Math]::Max($Width / $Source.Width, $Height / $Source.Height) }
                   else { [Math]::Min($Width / $Source.Width, $Height / $Source.Height) }) * $Scale
        $w = [int][Math]::Round($Source.Width * $ratio)
        $h = [int][Math]::Round($Source.Height * $ratio)
        $graphics.DrawImage($Source, [int](($Width-$w)/2), [int](($Height-$h)/2), $w, $h)
        $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png)
        $outputs.Add('android/app/src/main/res/' + $Relative)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
    $densities = @(@('mdpi',48,108), @('hdpi',72,162), @('xhdpi',96,216), @('xxhdpi',144,324), @('xxxhdpi',192,432))
    foreach ($density in $densities) {
        $name = $density[0]
        Save-ScaledImage $icon "mipmap-$name/ic_launcher.png" $density[1] $density[1]
        Save-ScaledImage $icon "mipmap-$name/ic_launcher_round.png" $density[1] $density[1]
        # El arte completo queda dentro de la zona segura del ícono adaptativo.
        Save-ScaledImage $icon "mipmap-$name/ic_launcher_foreground.png" $density[2] $density[2] (66.0/108.0)
    }
    # 9:20 cubre teléfonos altos y evita una franja inferior al escalar el bitmap nativo.
    $sizes = @(
        @('mdpi',320,711,480,320), @('hdpi',480,1067,800,480),
        @('xhdpi',720,1600,1280,720), @('xxhdpi',960,2133,1600,960),
        @('xxxhdpi',1280,2844,1920,1280)
    )
    foreach ($size in $sizes) {
        Save-ScaledImage $splash "drawable-port-$($size[0])/splash.png" $size[1] $size[2] 1 'portrait'
        Save-ScaledImage $splash "drawable-land-$($size[0])/splash.png" $size[3] $size[4] 1 'landscape'
    }
    Save-ScaledImage $splash 'drawable/splash.png' 450 1000 1 'portrait'
    $files = @('branding/rs_icono_piloto.png','branding/rs_splash_piloto.png') + $outputs.ToArray()
    $hashes = [ordered]@{}
    foreach ($file in $files) { $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $frontRoot $file) -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText((Join-Path $frontRoot 'branding/android-assets.json'), ($hashes | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output "Branding Android generado: $($outputs.Count) PNG derivados; proporciones conservadas."
} finally { $icon.Dispose(); $splash.Dispose() }
