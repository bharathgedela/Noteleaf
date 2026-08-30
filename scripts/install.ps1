$ErrorActionPreference = 'Stop'

$releaseBase = 'https://github.com/bharathgedela/Noteleaf/releases/latest/download'
$fallbackBase = 'https://raw.githubusercontent.com/bharathgedela/Noteleaf/installer-fallback'
$assetName = 'Noteleaf-Setup.exe'
$installerPath = Join-Path ([System.IO.Path]::GetTempPath()) $assetName
$checksumsPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Noteleaf-SHA256SUMS.txt'

function Invoke-NoteleafDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$Retries = 2,
    [switch]$CurlOnly
  )

  $downloadErrors = New-Object System.Collections.Generic.List[string]
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue

  if ($null -ne $curl) {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    $curlArguments = @(
      '--fail',
      '--location',
      '--ipv4',
      '--tlsv1.2',
      '--retry', [string]$Retries,
      '--retry-delay', '2',
      '--connect-timeout', '10',
      '--user-agent', 'Noteleaf-Installer',
      '--progress-bar',
      '--output', $OutFile
    )
    & $curl.Source @curlArguments $Uri

    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile) -and (Get-Item -LiteralPath $OutFile).Length -gt 0) {
      return
    }

    $downloadErrors.Add("curl.exe exited with code $LASTEXITCODE")
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    if ($CurlOnly) { throw ($downloadErrors -join '; ') }
  }

  try {
    # Windows PowerShell 5.1 can otherwise negotiate an older TLS version.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Invoke-WebRequest `
      -Uri $Uri `
      -OutFile $OutFile `
      -UseBasicParsing `
      -MaximumRedirection 10 `
      -TimeoutSec 30 `
      -Headers @{ 'User-Agent' = 'Noteleaf-Installer' }

    if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -eq 0) {
      throw 'PowerShell created an empty download.'
    }
    return
  } catch {
    $exceptionMessages = New-Object System.Collections.Generic.List[string]
    $exception = $_.Exception
    while ($null -ne $exception) {
      if ($exception.Message) { $exceptionMessages.Add($exception.Message) }
      $exception = $exception.InnerException
    }
    $downloadErrors.Add("PowerShell: $($exceptionMessages -join ' -> ')")
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }

  throw ($downloadErrors -join '; ')
}

function Invoke-RawInstallerFallback {
  $fallbackDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("Noteleaf-installer-parts-$([Guid]::NewGuid().ToString('N'))")
  $manifestName = 'Noteleaf-Setup.parts.txt'
  $manifestPath = Join-Path $fallbackDirectory $manifestName
  [void](New-Item -ItemType Directory -Path $fallbackDirectory -Force)

  try {
    Write-Host 'Using the raw GitHub fallback that avoids the blocked release-assets server...'
    Invoke-NoteleafDownload -Uri "$fallbackBase/$manifestName" -OutFile $manifestPath

    $partNames = @(Get-Content -LiteralPath $manifestPath | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($partNames.Count -eq 0) { throw 'The fallback installer manifest is empty.' }

    for ($partIndex = 0; $partIndex -lt $partNames.Count; $partIndex++) {
      $partName = $partNames[$partIndex]
      if ($partName -notmatch '^Noteleaf-Setup\.exe\.part\d{3}\.bin$') {
        throw "The fallback installer manifest contains an invalid part name: $partName"
      }
      $partPath = Join-Path $fallbackDirectory $partName
      Write-Host "Downloading installer part $($partIndex + 1) of $($partNames.Count)..."
      Invoke-NoteleafDownload -Uri "$fallbackBase/$partName" -OutFile $partPath
    }

    Write-Host 'Reassembling the Noteleaf installer...'
    $outputStream = [System.IO.File]::Open($installerPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      foreach ($partName in $partNames) {
        $partStream = [System.IO.File]::OpenRead((Join-Path $fallbackDirectory $partName))
        try { $partStream.CopyTo($outputStream) } finally { $partStream.Dispose() }
      }
    } finally {
      $outputStream.Dispose()
    }

    Invoke-NoteleafDownload -Uri "$fallbackBase/SHA256SUMS.txt" -OutFile $checksumsPath
  } finally {
    Remove-Item -LiteralPath $fallbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Downloading the latest Noteleaf installer...'
try {
  # Fail over quickly when a VM or network blocks release-assets.githubusercontent.com.
  Invoke-NoteleafDownload -Uri "$releaseBase/$assetName" -OutFile $installerPath -Retries 0 -CurlOnly
  Write-Host 'Downloading and verifying the release checksum...'
  Invoke-NoteleafDownload -Uri "$releaseBase/SHA256SUMS.txt" -OutFile $checksumsPath -Retries 0 -CurlOnly
} catch {
  $releaseDownloadError = $_.Exception.Message
  Remove-Item -LiteralPath $installerPath, $checksumsPath -Force -ErrorAction SilentlyContinue
  Write-Warning "The normal GitHub release host is unavailable: $releaseDownloadError"
  try {
    Invoke-RawInstallerFallback
  } catch {
    $fallbackDownloadError = $_.Exception.Message
    Remove-Item -LiteralPath $installerPath, $checksumsPath -Force -ErrorAction SilentlyContinue
    throw "The Noteleaf installer could not be downloaded from either GitHub host. Release download: $releaseDownloadError. Raw fallback: $fallbackDownloadError"
  }
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
