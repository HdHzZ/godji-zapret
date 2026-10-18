# Godji Zapret

Приложение для Windows с графическим управлением Zapret и локальным Telegram-прокси.

## Установка

Скачайте `GodjiZapret-…-Setup.exe` из [последнего релиза](https://github.com/HdHzZ/godji-zapret/releases/latest). Установщик позволяет выбрать диск и папку, создаёт ярлыки. Для работы Zapret требуются права администратора. Автозапуск выключен.

Основная кнопка включает и выключает оба компонента. В панели управления доступны отдельные команды Telegram-прокси, стратегии Zapret и диагностика. При первом подключении Telegram нажмите «Подключить Telegram» и подтвердите прокси в Telegram Desktop. Адрес по умолчанию: `127.0.0.1:1444`.

## Обновления

«Обновление Godji» проверяет стабильные GitHub Releases этого репозитория. При согласии пользователя приложение скачивает полный установщик и проверяет SHA-256 по `SHA256SUMS.txt` из того же релиза. Затем открывается мастер установки. Старые версии поверх новых не предлагаются. При недоступности API используется страница релизов GitHub.

Обновления ядра Zapret проверяются отдельно в репозитории Flowseal. Данные Telegram-прокси находятся в `%LOCALAPPDATA%\GodjiZapret\telegram-data\TgWsProxy`.

## Разработка и сборка

Нужны Windows x64, Node.js 20+ и Python 3.12+.

```powershell
npm ci
npm test
npm run icon
npm run prepare:core
python -m pip install -r vendor/tg-ws-proxy/requirements-build.txt
npm run build:telegram
npm start
npm run build:installer
```

`prepare:core` скачивает официальный пакет Zapret по закреплённой версии из скрипта. В исходный код не включены `node_modules`, собранные приложения, настройки, журналы или исполняемые файлы ядер.

## Выпуск новой версии

1. Измените версию в `package.json` и `package-lock.json`, проверьте `npm test`.
2. Отправьте коммит и тег `vX.Y.Z` в GitHub.
3. Выполните `npm run build:installer`, затем `npm run release` (нужен авторизованный GitHub CLI). Скрипт сформирует `SHA256SUMS.txt` и опубликует стабильный релиз с установщиком. Его увидит проверка обновлений в приложении.

Первую версию с GitHub-обновлениями необходимо установить вручную поверх прежней.

Лицензии компонентов: [THIRD_PARTY.md](THIRD_PARTY.md).
