$ErrorActionPreference = 'Stop'

$releaseBase = 'https://github.com/bharathgedela/notes_app/releases/latest/download'
$assetName = 'Noteleaf-Setup.exe'
$installerPath = Join-Path ([System.IO.Path]::GetTempPath()) $assetName
$checksumsPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Noteleaf-SHA256SUMS.txt'

function Invoke-DownloadWithProgress {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $true
  $client = [System.Net.Http.HttpClient]::new($handler)

  try {
    $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    [void]$response.EnsureSuccessStatusCode()
    $totalBytes = $response.Content.Headers.ContentLength
    $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $outputStream = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)

    try {
      $buffer = New-Object byte[] (1024 * 1024)
      [long]$downloadedBytes = 0
      $lastProgress = -1

      while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $outputStream.Write($buffer, 0, $read)
        $downloadedBytes += $read
        $downloadedMb = $downloadedBytes / 1MB

        if ($null -ne $totalBytes -and $totalBytes -gt 0) {
          $percentage = [Math]::Min(99, [int][Math]::Floor(($downloadedBytes * 100.0) / $totalBytes))
          if ($percentage -ne $lastProgress) {
            $totalMb = $totalBytes / 1MB
            Write-Host -NoNewline ("`rDownloading: {0,3}% ({1:N1} MB / {2:N1} MB)" -f $percentage, $downloadedMb, $totalMb)
            $lastProgress = $percentage
          }
        } elseif ([int][Math]::Floor($downloadedMb) -ne $lastProgress) {
          Write-Host -NoNewline ("`rDownloaded: {0:N1} MB" -f $downloadedMb)
          $lastProgress = [int][Math]::Floor($downloadedMb)
        }
      }

      if ($null -ne $totalBytes -and $totalBytes -gt 0) {
        $totalMb = $totalBytes / 1MB
        Write-Host ("`rDownloading: 100% ({0:N1} MB / {0:N1} MB)" -f $totalMb)
      } else {
        Write-Host ("`rDownloaded: {0:N1} MB (complete)" -f ($downloadedBytes / 1MB))
      }
    } finally {
      $outputStream.Dispose()
      $inputStream.Dispose()
      $response.Dispose()
    }
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

Write-Host 'Downloading the latest Noteleaf installer...'
try {
  Invoke-DownloadWithProgress -Uri "$releaseBase/$assetName" -OutFile $installerPath
  Write-Host 'Downloading and verifying the release checksum...'
  Invoke-WebRequest -Uri "$releaseBase/SHA256SUMS.txt" -OutFile $checksumsPath -UseBasicParsing
} catch {
  Write-Host ''
  Remove-Item -LiteralPath $installerPath, $checksumsPath -Force -ErrorAction SilentlyContinue
  throw 'A published Noteleaf Windows release could not be downloaded. Check https://github.com/bharathgedela/notes_app/releases and try again.'
}

$checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s\*?$([regex]::Escape($assetName))$" } | Select-Object -First 1
if (-not $checksumLine) { throw "The release checksum for $assetName is missing." }

$expectedHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  throw 'The Noteleaf installer checksum did not match. Installation was stopped.'
}

Write-Host 'Checksum verified. Opening Noteleaf Setup...'
$process = Start-Process -FilePath $installerPath -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Noteleaf Setup exited with code $($process.ExitCode)." }

Remove-Item -LiteralPath $installerPath, $checksumsPath -Force -ErrorAction SilentlyContinue
Write-Host 'Noteleaf installation finished.'
