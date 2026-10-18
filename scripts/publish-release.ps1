$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "dist\GodjiZapret-$version-Setup.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw 'Build the installer first: npm run build:installer' }
$checksums = Join-Path $projectRoot 'dist\SHA256SUMS.txt'
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($installer)
try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha.Dispose() }
[IO.File]::WriteAllText($checksums, "$hash  GodjiZapret-$version-Setup.exe`n", [Text.Encoding]::ASCII)
gh release create "v$version" $installer $checksums --repo HdHzZ/godji-zapret --title "Godji Zapret $version" --generate-notes --verify-tag --latest
if ($LASTEXITCODE -ne 0) { throw 'GitHub release publication failed.' }
