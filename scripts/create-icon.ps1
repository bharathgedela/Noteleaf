$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets'))
$sourcePath = Join-Path $assetDirectory 'noteleaf-logo.png'
$windowsPngPath = Join-Path $assetDirectory 'icon.png'
$macPngPath = Join-Path $assetDirectory 'icon-mac.png'
$icoPath = Join-Path $assetDirectory 'icon.ico'

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing master logo: $sourcePath"
}

function New-ResizedPngBytes {
  param(
    [Parameter(Mandatory)] [System.Drawing.Image] $Source,
    [Parameter(Mandatory)] [int] $Size
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $scale = [Math]::Min($Size / $Source.Width, $Size / $Source.Height)
    $width = [Math]::Max(1, [int][Math]::Round($Source.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($Source.Height * $scale))
    $x = [int][Math]::Floor(($Size - $width) / 2)
    $y = [int][Math]::Floor(($Size - $height) / 2)
    $graphics.DrawImage($Source, [System.Drawing.Rectangle]::new($x, $y, $width, $height))
    $stream = [System.IO.MemoryStream]::new()
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      return ,$stream.ToArray()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  [System.IO.File]::WriteAllBytes($windowsPngPath, [byte[]](New-ResizedPngBytes -Source $source -Size 512))
  [System.IO.File]::WriteAllBytes($macPngPath, [byte[]](New-ResizedPngBytes -Source $source -Size 1024))

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $frames = @($sizes | ForEach-Object {
    [PSCustomObject]@{ Size = $_; Bytes = [byte[]](New-ResizedPngBytes -Source $source -Size $_) }
  })

  $stream = [System.IO.File]::Create($icoPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$frames.Count)
    $offset = 6 + (16 * $frames.Count)
    foreach ($frame in $frames) {
      $dimension = if ($frame.Size -eq 256) { [Byte]0 } else { [Byte]$frame.Size }
      $writer.Write($dimension)
      $writer.Write($dimension)
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$frame.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
} finally {
  $source.Dispose()
}

Write-Host "Created Noteleaf icons in $assetDirectory"
