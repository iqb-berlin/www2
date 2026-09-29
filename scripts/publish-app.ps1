<#
.SYNOPSIS
  Publish a ClickOnce app to the www2 /it/ section.

.DESCRIPTION
  Zips a Visual Studio ClickOnce publish folder (the one containing setup.exe,
  <App>.application and "Application Files\") and uploads it to
  https://<server>/it/api/apps/<App>. The server validates the archive, swaps
  it in atomically and keeps the previous version for a rollback.

  Before publishing in Visual Studio set
    Installation URL  = https://<server>/it/dl/<App>/
    Update location   = https://<server>/it/dl/<App>/
  The script refuses to upload a manifest whose deploymentProvider points
  somewhere else unless -Force is given.

.PARAMETER App
  App id, e.g. IQB-Kodieren. This becomes the folder name under /it/dl/.

.PARAMETER PublishDir
  The ClickOnce publish folder.

.PARAMETER Server
  Base URL of the www2 server. Default: https://www2.iqb.hu-berlin.de

.PARAMETER Token
  Your personal upload token. Falls back to $env:WWW2_UPLOAD_TOKEN.

.PARAMETER Force
  Upload even if the deploymentProvider in the manifest does not point at this server.

.EXAMPLE
  .\publish-app.ps1 -App IQB-Kodieren -PublishDir C:\src\IQB-Kodieren\publish
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $App,
  [Parameter(Mandatory = $true)] [string] $PublishDir,
  [string] $Server = 'https://www2.iqb.hu-berlin.de',
  [string] $Token = $env:WWW2_UPLOAD_TOKEN,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($App -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw "Invalid app id '$App'" }
if (-not $Token) { throw 'No upload token: pass -Token or set $env:WWW2_UPLOAD_TOKEN' }
$Server = $Server.TrimEnd('/')
$dir = (Resolve-Path $PublishDir).Path

if (-not (Test-Path (Join-Path $dir 'setup.exe'))) { throw "setup.exe not found in $dir" }
$manifests = @(Get-ChildItem -Path $dir -Filter '*.application' -File)
if ($manifests.Count -ne 1) { throw "Expected exactly one *.application in $dir, found $($manifests.Count)" }
if (-not (Test-Path (Join-Path $dir 'Application Files'))) { throw "'Application Files' folder not found in $dir" }

[xml] $xml = Get-Content -Path $manifests[0].FullName -Raw
$version = $xml.assembly.assemblyIdentity.version
$provider = $xml.assembly.deployment.deploymentProvider.codebase
$expected = "$Server/it/dl/$App/"
Write-Host "App:      $App"
Write-Host "Version:  $version"
Write-Host "Provider: $provider"
if ($provider -and -not $provider.ToLower().StartsWith($expected.ToLower())) {
  if ($Force) {
    Write-Warning "deploymentProvider does not start with $expected (continuing because of -Force)"
  } else {
    throw "deploymentProvider must start with $expected - set 'Installation URL' / 'Update location' in Visual Studio, or use -Force"
  }
}

$zip = Join-Path ([IO.Path]::GetTempPath()) ("$App-" + [Guid]::NewGuid().ToString('N') + '.zip')
try {
  # CreateFromDirectory writes forward slashes and no wrapper folder (unlike Compress-Archive).
  [IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
  $size = (Get-Item $zip).Length
  Write-Host ("Uploading {0:N1} MB to {1}/it/api/apps/{2} ..." -f ($size / 1MB), $Server, $App)

  $headers = @{ Authorization = "Bearer $Token" }
  try {
    $response = Invoke-WebRequest -Uri "$Server/it/api/apps/$App" -Method Put -InFile $zip `
      -ContentType 'application/zip' -Headers $headers -TimeoutSec 600 -UseBasicParsing
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.GetResponseStream) {
      $reader = New-Object IO.StreamReader($resp.GetResponseStream())
      $body = $reader.ReadToEnd()
      throw "Upload failed ($([int]$resp.StatusCode)): $body"
    }
    throw
  }
  $result = $response.Content | ConvertFrom-Json
  Write-Host ("Published {0} {1} (previous: {2}) as {3}" -f $result.id, $result.version, ($result.previousVersion ?? '-'), $result.publishedBy)
  foreach ($w in $result.warnings) { Write-Warning $w }
} finally {
  if (Test-Path $zip) { Remove-Item $zip -Force }
}
