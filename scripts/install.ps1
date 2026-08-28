$ErrorActionPreference = 'Stop'

$releaseBase = 'https://github.com/bharathgedela/notes_app/releases/latest/download'
$assetName = 'Noteleaf-Setup.exe'
$installerPath = Join-Path ([System.IO.Path]::GetTempPath()) $assetName
$checksumsPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Noteleaf-SHA256SUMS.txt'

Write-Host 'Downloading the latest Noteleaf installer...'
try {
  Invoke-WebRequest -Uri "$releaseBase/$assetName" -OutFile $installerPath -UseBasicParsing
  Invoke-WebRequest -Uri "$releaseBase/SHA256SUMS.txt" -OutFile $checksumsPath -UseBasicParsing
} catch {
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
