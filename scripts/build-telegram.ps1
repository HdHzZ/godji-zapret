$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'vendor\tg-ws-proxy'
Push-Location -LiteralPath $source
try {
    python -m PyInstaller --noconfirm --onedir --console --name GodjiTelegramProxy --distpath (Join-Path $projectRoot 'tg-proxy') --workpath (Join-Path $projectRoot 'build\tg-engine') --specpath (Join-Path $projectRoot 'build\tg-engine') --collect-all certifi godji_launcher.py
    if ($LASTEXITCODE -ne 0) { throw 'Telegram proxy build failed.' }
} finally { Pop-Location }
