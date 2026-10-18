$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'zapret-core'
$version = '1.10.3'
$expectedHash = '244314ae1c24538a0d751601da8e0c925c843371eec4456eb15f14c4fd6b7058'
if (Test-Path -LiteralPath $destination) {
    throw 'zapret-core already exists. Preserve your settings and move it aside before preparing a fresh core.'
}
$stage = Join-Path $projectRoot '.core-download'
if (-not (Test-Path -LiteralPath $stage)) { New-Item -ItemType Directory -Path $stage | Out-Null }
$archive = Join-Path $stage 'core.zip'
$url = "https://github.com/Flowseal/zapret-discord-youtube/releases/download/$version/zapret-discord-youtube-$version.zip"
if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive }
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($archive)
try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha.Dispose() }
if ($actualHash -ne $expectedHash) { throw 'Zapret archive SHA-256 mismatch.' }
$extracted = Join-Path $stage 'extracted'
[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')
[IO.Compression.ZipFile]::ExtractToDirectory($archive, $extracted)
$source = $extracted
if (-not (Test-Path -LiteralPath (Join-Path $source 'general.bat'))) {
    $source = (Get-ChildItem -LiteralPath $extracted -Directory | Where-Object { $_.Name -like 'zapret-discord-youtube-*' } | Select-Object -First 1).FullName
}
if (-not $source -or -not (Test-Path -LiteralPath (Join-Path $source 'bin\winws.exe'))) { throw 'The archive does not contain the expected Zapret engine.' }
Move-Item -LiteralPath $source -Destination $destination
[IO.File]::WriteAllText((Join-Path $destination '_godji_version.txt'), $version)
# Remove only the checked, fixed staging directory inside this project.
$resolvedStage = [IO.Path]::GetFullPath($stage)
if ($resolvedStage -ne [IO.Path]::GetFullPath((Join-Path $projectRoot '.core-download'))) { throw 'Invalid staging directory.' }
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
Write-Output "Prepared Zapret $version (SHA-256 verified)."
