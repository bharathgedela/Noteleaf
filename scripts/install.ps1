$ErrorActionPreference = 'Stop'

$releaseBase = 'https://github.com/bharathgedela/Noteleaf/releases/latest/download'
$assetName = 'Noteleaf-Setup.exe'
$installerPath = Join-Path ([System.IO.Path]::GetTempPath()) $assetName
$checksumsPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Noteleaf-SHA256SUMS.txt'

function Invoke-NoteleafDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  # Windows PowerShell 5.1 can otherwise negotiate an older TLS version.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  Invoke-WebRequest `
    -Uri $Uri `
    -OutFile $OutFile `
    -UseBasicParsing `
    -MaximumRedirection 10 `
    -Headers @{ 'User-Agent' = 'Noteleaf-Installer' }
}

Write-Host 'Downloading the latest Noteleaf installer...'
try {
  Invoke-NoteleafDownload -Uri "$releaseBase/$assetName" -OutFile $installerPath
  Write-Host 'Downloading and verifying the release checksum...'
  Invoke-NoteleafDownload -Uri "$releaseBase/SHA256SUMS.txt" -OutFile $checksumsPath
} catch {
  $downloadError = $_.Exception.Message
  Remove-Item -LiteralPath $installerPath, $checksumsPath -Force -ErrorAction SilentlyContinue
  throw "A published Noteleaf Windows release could not be downloaded. Check https://github.com/bharathgedela/Noteleaf/releases and try again. Details: $downloadError"
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
