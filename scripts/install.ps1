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

  $downloadErrors = New-Object System.Collections.Generic.List[string]
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue

  if ($null -ne $curl) {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    # curl's standard progress meter includes live numeric Total and Received percentages.
    & $curl.Source `
      --fail `
      --location `
      --ipv4 `
      --tlsv1.2 `
      --retry 3 `
      --retry-delay 2 `
      --connect-timeout 30 `
      --user-agent 'Noteleaf-Installer' `
      --output $OutFile `
      $Uri

    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile) -and (Get-Item -LiteralPath $OutFile).Length -gt 0) {
      return
    }

    $downloadErrors.Add("curl.exe exited with code $LASTEXITCODE")
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }

  try {
    # Windows PowerShell 5.1 can otherwise negotiate an older TLS version.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Invoke-WebRequest `
      -Uri $Uri `
      -OutFile $OutFile `
      -UseBasicParsing `
      -MaximumRedirection 10 `
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

Write-Host 'Downloading the latest Noteleaf installer...'
Write-Host 'The Received column below shows the live download percentage.'
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
