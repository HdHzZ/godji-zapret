const path = require('path');
function scopeProtocolTest(source, {coreDir, strategiesDir}) {
  const quote = value => "'" + value.replace(/'/g,"''") + "'";
  const executable = quote(path.join(coreDir,'bin','winws1.exe'));
  const getProcess = 'Get-Process -Name "winws" -ErrorAction SilentlyContinue';
  const getSnapshot = 'Get-CimInstance Win32_Process -Filter "Name=\'winws.exe\'"';
  if (!source.includes(getProcess) || !source.includes(getSnapshot) || !source.includes('$rootDir = Split-Path $PSScriptRoot')) throw Error('Формат теста изменился: безопасный запуск этой версии пока не поддерживается.');
  return source.replace('$rootDir = Split-Path $PSScriptRoot','$rootDir = ' + quote(coreDir))
    .replace('$targetDir = $rootDir','$targetDir = ' + quote(strategiesDir))
    .replaceAll(getProcess,'Get-Process -Name "winws1" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ' + executable + ' }')
    .replaceAll(getSnapshot,'(Get-CimInstance Win32_Process -Filter "Name=\'winws1.exe\'" | Where-Object { $_.ExecutablePath -eq ' + executable + ' })');
}
module.exports = {scopeProtocolTest};
