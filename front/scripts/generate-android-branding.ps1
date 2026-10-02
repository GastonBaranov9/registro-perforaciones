$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$frontRoot = Split-Path $PSScriptRoot -Parent
$resRoot = Join-Path $frontRoot 'android/app/src/main/res'
$icon = [Drawing.Image]::FromFile((Join-Path $frontRoot 'branding/rs_icono_piloto.png'))
$splash = [Drawing.Image]::FromFile((Join-Path $frontRoot 'branding/rs_splash_piloto.png'))
$outputs = [Collections.Generic.List[string]]::new()
function Save-ScaledImage($Source, [string]$Relative, [int]$Width, [int]$Height, [double]$Scale = 1) {
    $target = Join-Path $resRoot $Relative
    [IO.Directory]::CreateDirectory((Split-Path $target -Parent)) | Out-Null
    $bitmap = [Drawing.Bitmap]::new($Width, $Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $ratio = [Math]::Min($Width / $Source.Width, $Height / $Source.Height) * $Scale
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
    $sizes = @(@('mdpi',320,480), @('hdpi',480,800), @('xhdpi',720,1280), @('xxhdpi',960,1600), @('xxxhdpi',1280,1920))
    foreach ($size in $sizes) {
        Save-ScaledImage $splash "drawable-port-$($size[0])/splash.png" $size[1] $size[2]
        Save-ScaledImage $splash "drawable-land-$($size[0])/splash.png" $size[2] $size[1]
    }
    Save-ScaledImage $splash 'drawable/splash.png' 480 800
    $files = @('branding/rs_icono_piloto.png','branding/rs_splash_piloto.png') + $outputs.ToArray()
    $hashes = [ordered]@{}
    foreach ($file in $files) { $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $frontRoot $file) -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText((Join-Path $frontRoot 'branding/android-assets.json'), ($hashes | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output "Branding Android generado: $($outputs.Count) PNG derivados; proporciones conservadas."
} finally { $icon.Dispose(); $splash.Dispose() }
