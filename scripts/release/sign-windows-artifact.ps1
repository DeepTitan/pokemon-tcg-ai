param(
  [Parameter(Mandatory = $true)]
  [string]$File
)

$ErrorActionPreference = 'Stop'

foreach ($name in @('SIGNTOOL_PATH', 'ARTIFACT_SIGNING_DLIB', 'ARTIFACT_SIGNING_METADATA')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Missing required Artifact Signing environment variable: $name"
  }
}

if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
  throw "The file to sign does not exist: $File"
}

& $env:SIGNTOOL_PATH sign `
  /v `
  /debug `
  /fd SHA256 `
  /tr http://timestamp.acs.microsoft.com `
  /td SHA256 `
  /dlib $env:ARTIFACT_SIGNING_DLIB `
  /dmdf $env:ARTIFACT_SIGNING_METADATA `
  /d 'Trace' `
  $File

if ($LASTEXITCODE -ne 0) {
  throw "Microsoft Artifact Signing failed for $File with exit code $LASTEXITCODE."
}
