$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $PSScriptRoot '..\assets'
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
$pngPath = Join-Path $assetDirectory 'icon.png'
$icoPath = Join-Path $assetDirectory 'icon.ico'

$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 52
$diameter = $radius * 2
$path.AddArc(12, 12, $diameter, $diameter, 180, 90)
$path.AddArc(244 - $diameter, 12, $diameter, $diameter, 270, 90)
$path.AddArc(244 - $diameter, 244 - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(12, 244 - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 51, 67, 62))
$graphics.FillPath($background, $path)
$font = [System.Drawing.Font]::new('Georgia', 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$foreground = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$graphics.DrawString('N', $font, $foreground, [System.Drawing.RectangleF]::new(0, -3, 256, 256), $format)
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$stream.Dispose()
$foreground.Dispose()
$format.Dispose()
$font.Dispose()
$background.Dispose()
$path.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
