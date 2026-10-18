# TG WS Proxy engine for Godji

Source: https://github.com/Flowseal/tg-ws-proxy/tree/v1.11.1 (MIT).
The proxy and utils directories are unmodified upstream sources. godji_launcher.py reads the local Godji config and starts the console engine with its supported command line options. No Windows service or login item is installed.

Build from this directory with Python and PyInstaller:

    python -m pip install certifi "httpx[http2]==0.28.1" "cryptography==46.0.5" pyinstaller
    python -m PyInstaller --noconfirm --onedir --console --name GodjiTelegramProxy --distpath ../../tg-proxy --workpath ../../build/tg-engine --specpath ../../build/tg-engine --collect-all certifi godji_launcher.py

The Electron build copies tg-proxy into resources. The default listener is 127.0.0.1:1444. Settings and logs live in LOCALAPPDATA/GodjiZapret/telegram-data/TgWsProxy. Connect Telegram once using the panel button; confirm the link inside Telegram.
