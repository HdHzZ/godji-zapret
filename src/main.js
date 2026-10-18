const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn, execSync, execFile } = require('child_process');
const extractZip = require('extract-zip');

// === FIX: Windows 11 + прозрачное окно => интерфейс "исчезает" (баг GPU-композитинга) ===
// На Win11 отключаем аппаратное ускорение, чтобы градиенты/эффекты рисовались
// программным растеризатором. На Win10 ускорение оставляем (там всё работало).
if (process.platform === 'win32') {
  const build = parseInt((os.release().split('.')[2] || '0'), 10);
  if (build >= 22000) { // 22000+ = Windows 11
    app.disableHardwareAcceleration();
  }
}

// ==========================================
// ФИКС ПРОЗРАЧНОСТИ: кэш Electron — вне OneDrive/Dropbox
// ==========================================
const userDataPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'GodjiZapret');
try { app.setPath('userData', userDataPath); } catch (e) { console.warn('setPath userData:', e.message); }

// ==========================================
// ПУТИ
// ==========================================
const isDev = !app.isPackaged;
const appDir = isDev ? path.join(__dirname, '..') : path.dirname(app.getPath('exe'));
const zapretCoreDir = path.join(appDir, 'zapret-core');
if (!fs.existsSync(zapretCoreDir)) fs.mkdirSync(zapretCoreDir, { recursive: true });

const LISTS_DIR = path.join(zapretCoreDir, 'lists');
const UTILS_DIR = path.join(zapretCoreDir, 'utils');
const GAME_FLAG = path.join(UTILS_DIR, 'game_filter.enabled');
const IPSET_FILE = path.join(LISTS_DIR, 'ipset-all.txt');
const IPSET_BACKUP = IPSET_FILE + '.backup';
const IPSET_MARKER = '203.0.113.113/32';
const IPSET_URL = 'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/ipset-service.txt';
const HOSTS_URL = 'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/hosts';
const VERSION_FILE = path.join(zapretCoreDir, '_godji_version.txt');

// Рабочая папка клиента: ВСЕ временные файлы запуска пишем СЮДА (локально, writable),
// а НЕ в zapret-core. Это позволяет запускать программу с read-only сетевого диска
// (серверный D:), читая настройки админа оттуда, и убирает гонки между клиентами.
const runDir = path.join(userDataPath, 'run');
if (!fs.existsSync(runDir)) { try { fs.mkdirSync(runDir, { recursive: true }); } catch (e) {} }

// ===== Яндекс Диск (публичная папка GodjiUpdates, без OAuth) =====

// ==========================================
// ДИАГНОСТИЧЕСКИЙ ЛОГ СТАРТА (пишется до любых проверок)
// ==========================================
const _logDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GodjiZapret');
const _logFile = path.join(_logDir, 'startup.log');
function logStartup(msg) {
  try {
    if (!fs.existsSync(_logDir)) fs.mkdirSync(_logDir, { recursive: true });
    fs.appendFileSync(_logFile, `[${new Date().toISOString()}] ${msg}\r\n`);
  } catch (e) {}
}

// ==========================================
// АДМИН + АВТО-РЕСТАРТ + ЛОГ
// ==========================================
function isAdmin() { try { execSync('net session', { stdio: 'ignore' }); return true; } catch (e) { return false; } }

logStartup('==================== START ====================');
logStartup('app version : ' + app.getVersion());
logStartup('argv        : ' + process.argv.join(' | '));
logStartup('execPath    : ' + process.execPath);
logStartup('isPackaged  : ' + app.isPackaged);
logStartup('cwd         : ' + process.cwd());
logStartup('LOCALAPPDATA: ' + (process.env.LOCALAPPDATA || 'N/A'));
const _admin = isAdmin();
logStartup('isAdmin     : ' + _admin);

if (!_admin) {
  logStartup('NOT admin -> attempting elevation via powershell RunAs');
  const cwd = isDev ? path.join(__dirname, '..') : appDir;
  const argList = process.argv.slice(1).map(a => a.replace(/'/g, "''")).join("' '");
  try {
    spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${process.execPath}' -ArgumentList '${argList}' -WorkingDirectory '${cwd}' -Verb RunAs`], { detached: true, stdio: 'ignore' }).unref();
    logStartup('powershell restart spawned -> quitting non-admin instance');
  } catch (e) {
    logStartup('ERROR spawning powershell restart: ' + e.message);
  }
  app.quit();
} else {
  logStartup('Running as ADMIN -> continuing normal startup');
}

// ==========================================
// КЛУБНЫЙ ПАТЧ winws.exe -> winws1.exe
// ВАЖНО: это ЗАПИСЬ в zapret-core, поэтому выполняется ОДИН РАЗ админом на сервере.
// У клиента (read-only шара) шаг становится пустым и записи не требует.
// ==========================================
function patchForClub() {
  try {
    const binDir = path.join(zapretCoreDir, 'bin');
    if (!fs.existsSync(binDir)) return;
    const oldExe = path.join(binDir, 'winws.exe'), newExe = path.join(binDir, 'winws1.exe');
    if (fs.existsSync(oldExe) && !fs.existsSync(newExe)) { fs.renameSync(oldExe, newExe); console.log('✅ winws.exe -> winws1.exe'); }
    else if (fs.existsSync(oldExe) && fs.existsSync(newExe)) { try { fs.unlinkSync(oldExe); } catch (e) {} }
    if (!fs.existsSync(newExe)) return;
    for (const b of fs.readdirSync(zapretCoreDir).filter(f => f.toLowerCase().endsWith('.bat'))) {
      const bp = path.join(zapretCoreDir, b);
      try { let t = fs.readFileSync(bp, 'utf8'); if (t.includes('winws.exe')) { fs.writeFileSync(bp, t.split('winws.exe').join('winws1.exe')); console.log('  ↳ пропатчен:', b); } } catch (e) {}
    }
  } catch (e) { console.warn('patchForClub warning:', e.message); }
}

// ==========================================
// СОСТОЯНИЕ ЗАЩИТЫ
// ==========================================
function isProcessRunning(name) {
  try { return execSync(`tasklist /FI "IMAGENAME eq ${name}.exe" /FO CSV /NH`, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().toLowerCase().includes(`${name}.exe`); }
  catch (e) { return false; }
}
function checkZapretRunning() { return isProcessRunning('winws1') || isProcessRunning('winws'); }

// ==========================================
// СКАЧИВАНИЕ
// ==========================================
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*', 'Connection': 'keep-alive' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) { file.close(); fs.unlink(destPath, () => {}); downloadFile(res.headers.location, destPath).then(resolve).catch(reject); return; }
      if (res.statusCode !== 200) { file.close(); fs.unlink(destPath, () => {}); reject(new Error(`Failed to download (${res.statusCode})`)); return; }
      res.pipe(file); file.on('finish', () => file.close(resolve));
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// ===== универсальный HTTP/HTTPS GET со следованием редиректам =====
function requestUrl(url, cb) {
  const lib = url.startsWith('https') ? https : http;
  const req = lib.get(url, { headers: { 'User-Agent': 'Godji-Zapret-App', 'Accept': '*/*' } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      res.resume();
      const loc = res.headers.location;
      if (!loc) return cb.error(new Error('redirect without location'));
      return requestUrl(new URL(loc, url).toString(), cb);
    }
    cb.response(res);
  });
  req.on('error', (e) => cb.error(e));
}

// ===== GitHub API: последний релиз ядра =====
const {createReleaseClient} = require('./release-client');
let releaseError = '';
async function requestReleaseText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await net.fetch(url, {signal:controller.signal, headers:{'User-Agent':'Godji-Zapret-App'}});
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw Error('Слишком большой ответ сервера');
    return {status:response.status,url:response.url,text};
  } finally {clearTimeout(timer);}
}
const releaseClient = createReleaseClient(requestReleaseText);
async function getLatestRelease() {
  try { const release = await releaseClient.latest(); releaseError = ''; return release; }
  catch (error) { releaseError = error.message; return null; }
}
async function downloadCoreArchive(url, destination) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await net.fetch(url, {signal:controller.signal});
    if (!response.ok || !response.body) throw Error('Скачивание ядра: HTTP ' + response.status);
    await require('stream/promises').pipeline(require('stream').Readable.fromWeb(response.body), fs.createWriteStream(destination));
  } finally {clearTimeout(timer);}
}
function readVersionFile() { try { if (!fs.existsSync(VERSION_FILE)) return null; const v = fs.readFileSync(VERSION_FILE, 'utf8').trim(); return v || null; } catch (e) { return null; } }

const {createAppUpdater} = require('./app-update');
const appUpdater = createAppUpdater({
  request:requestReleaseText,
  localVersion:app.getVersion(),
  directory:path.join(userDataPath,'updates'),
  openInstaller:async installer => {
    runZapretService(false);
    const telegram = await telegramProxy.action('stop');
    if (!telegram.success) return 'Не удалось остановить Telegram-прокси: ' + telegram.message;
    return shell.openPath(installer);
  },
  download:async (url,destination,onProgress) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),180000);
    try {
      const response = await net.fetch(url,{signal:controller.signal});
      if (!response.ok || !response.body) throw Error('Не удалось скачать установщик: HTTP ' + response.status);
      const total = Number(response.headers.get('content-length'));
      let received = 0;
      const stream = require('stream').Readable.fromWeb(response.body);
      stream.on('data',chunk => {received += chunk.length; if(onProgress) onProgress(total > 0 ? Math.min(100,Math.floor(received / total * 100)) : -1);});
      await require('stream/promises').pipeline(stream,fs.createWriteStream(destination));
    } finally {clearTimeout(timer);}
  }
});
async function checkAppUpdate() {return appUpdater.check();}
async function applyAppUpdate(onProgress) {return appUpdater.apply(onProgress);}

// ==========================================
// РАСПАКОВКА ЯДРА
// ==========================================
function moveFilesFromSubfolder() {
  return new Promise((resolve, reject) => {
    fs.readdir(zapretCoreDir, (err, files) => {
      if (err) { reject(err); return; }
      const vf = files.find(f => f.startsWith('zapret-discord-youtube-') && fs.statSync(path.join(zapretCoreDir, f)).isDirectory());
      if (!vf) { resolve(); return; }
      const src0 = path.join(zapretCoreDir, vf);
      function copyDir(s, d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { const a = path.join(s, e.name), b = path.join(d, e.name); if (e.isDirectory()) copyDir(a, b); else { try { fs.copyFileSync(a, b); } catch (x) {} } } }
      try { copyDir(src0, zapretCoreDir); try { fs.rmSync(src0, { recursive: true, force: true }); } catch (e) {} resolve(); } catch (e) { reject(e); }
    });
  });
}
let coreUpdatePending = false;
async function downloadAndExtractZapret() {
  if (coreUpdatePending) return {success:false,message:'Обновление ядра уже выполняется.'};
  if (checkZapretRunning()) return {success:false,message:'Сначала выключите защиту, затем обновите ядро.'};
  coreUpdatePending = true;
  let stage, backup;
  function removeStage(directory) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(appDir) || !path.basename(directory).startsWith('.godji-core-')) throw Error('Некорректный путь временной папки');
    fs.rmSync(directory,{recursive:true,force:true});
  }
  try {
    const latest = await getLatestRelease();
    if (!latest) throw Error(releaseError || 'Не удалось проверить последнюю версию. Установленное ядро сохранено.');
    const savedConfig = fs.existsSync(path.join(zapretCoreDir,'best-config.txt')) ? fs.readFileSync(path.join(zapretCoreDir,'best-config.txt'),'utf8').trim() : null;
    stage = fs.mkdtempSync(path.join(appDir,'.godji-core-stage-'));
    const archive = path.join(stage,'download.zip'), extracted = path.join(stage,'extracted');
    await downloadCoreArchive(latest.url,archive);
    await extractZip(archive,{dir:extracted});
    let newCore = extracted;
    if (!fs.existsSync(path.join(newCore,'general.bat'))) {
      const folder = fs.readdirSync(extracted).find(name => name.startsWith('zapret-discord-youtube-') && fs.statSync(path.join(extracted,name)).isDirectory());
      if (folder) newCore = path.join(extracted,folder);
    }
    if (!fs.existsSync(path.join(newCore,'general.bat')) || !fs.existsSync(path.join(newCore,'bin','winws.exe')) && !fs.existsSync(path.join(newCore,'bin','winws1.exe'))) throw Error('Архив не содержит корректного ядра Zapret. Старое ядро сохранено.');
    if (savedConfig && path.basename(savedConfig) === savedConfig && fs.existsSync(path.join(newCore,savedConfig))) fs.writeFileSync(path.join(newCore,'best-config.txt'),savedConfig);
    fs.writeFileSync(path.join(newCore,'_godji_version.txt'),latest.tag);
    backup = path.join(appDir,'.godji-core-backup-' + Date.now());
    fs.renameSync(zapretCoreDir,backup);
    try { fs.renameSync(newCore,zapretCoreDir); }
    catch (error) { fs.renameSync(backup,zapretCoreDir); backup = null; throw error; }
    patchForClub();
    try { removeStage(backup); backup = null; } catch (error) { console.warn('Core backup retained:',error.message); }
    return {success:true,message:'Zapret ' + latest.tag + ' установлен.'};
  } catch (error) {return {success:false,message:error.message};}
  finally {coreUpdatePending = false; if(stage) {try{removeStage(stage);}catch(error){console.warn(error.message);}}}
}
async function checkForUpdates() {
  const latest = await getLatestRelease();
  if (!latest) return { success: false, message: releaseError || 'Не удалось проверить релиз. Установленное ядро сохранено.' };
  const local = readVersionFile(); const localLabel = local || 'не установлено';
  if (local && local === latest.tag) return { success: true, hasUpdate: false, message: `Ядро актуально: ${latest.tag}` };
  return { success: true, hasUpdate: true, currentVersion: localLabel, newVersion: latest.tag, message: `Доступно ядро ${latest.tag} (у вас ${localLabel}). Нажмите «СКАЧАТЬ ZAPRET» для обновления.` };
}

// ==========================================
// ТЕСТ ПРОТОКОЛОВ
// ==========================================
let testTotal = 0, testFinished = false, testTimer = null;
function readBestFromResultsFile() { try { const dir = path.join(zapretCoreDir, 'utils', 'test results'); if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(x => x.startsWith('test_results_')).sort(); if (!f.length) return null; const m = fs.readFileSync(path.join(dir, f[f.length - 1]), 'utf8').match(/Best strategy:\s*(.+)/i); return m ? m[1].trim() : null; } catch (e) { return null; } }
function finishTest(best) {
  if (testFinished) return; testFinished = true; if (testTimer) { clearTimeout(testTimer); testTimer = null; }
  if (!best) best = readBestFromResultsFile(); if (!best) best = 'general.bat'; saveBestConfig(best);
  if (mainWindow) { mainWindow.webContents.send('test-progress', 100); mainWindow.webContents.send('test-complete', { success: true, bestConfig: best, message: `Лучший протокол: ${best}` }); }
  console.log('✅ Тесты завершены. Лучший конфиг:', best);
}
function runTests() {
  const script = path.join(zapretCoreDir, 'utils', 'test zapret.ps1');
  if (!fs.existsSync(script)) return { success: false, message: 'test zapret.ps1 не найден. Сначала «СКАЧАТЬ ZAPRET».' };
  testTotal = 0; testFinished = false; if (testTimer) clearTimeout(testTimer);
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::Out.AutoFlush = $true; $ProgressPreference = 'SilentlyContinue'; & '${script}'`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  ps.stdin.on('error', () => {}); ps.stdin.write('1\n'); ps.stdin.write('1\n'); ps.stdin.end();
  testTimer = setTimeout(() => { try { ps.kill(); } catch (e) {} finishTest(null); }, 12 * 60 * 1000);
  ps.stdout.on('data', (data) => {
    const text = data.toString(); process.stdout.write(text);
    const tot = text.match(/Total configs:\s*(\d+)/); if (tot) testTotal = parseInt(tot[1]);
    const re = /\[\s*(\d+)\s*\/\s*(\d+)\s*\]/g; let m;
    while ((m = re.exec(text)) !== null) { const n = parseInt(m[1]); const t = parseInt(m[2]) || testTotal || 20; testTotal = t; if (mainWindow) mainWindow.webContents.send('test-progress', Math.max(0, Math.min(99, Math.round(((n - 1) / t) * 100)))); }
    const bm = text.match(/Best config:\s*(.+)/); if (bm) { try { ps.kill(); } catch (e) {} finishTest(bm[1].trim()); }
  });
  ps.stderr.on('data', (data) => process.stderr.write(data));
  ps.on('close', () => finishTest(null));
  ps.on('error', (err) => { if (testFinished) return; testFinished = true; if (testTimer) clearTimeout(testTimer); if (mainWindow) mainWindow.webContents.send('test-complete', { success: false, message: 'Ошибка запуска: ' + err.message }); });
  return { success: true, message: 'Тесты запущены' };
}
function saveBestConfig(name) { fs.writeFileSync(path.join(zapretCoreDir, 'best-config.txt'), name); }

// ==========================================
// СКРЫТЫЙ ЗАПУСК (winws1) — read-only friendly
// ==========================================
function buildHiddenBat(configName) {
  const orig = path.join(zapretCoreDir, configName);             // читаем с сервера (read-only ок)
  let text = fs.readFileSync(orig, 'utf8').replace(/\r\n/g, '\n');

  const serverRoot = zapretCoreDir.endsWith(path.sep) ? zapretCoreDir : (zapretCoreDir + path.sep);
  text = text.replace(/%~dp0/gi, serverRoot);

  const lines = text.split('\n');
  const patched = ['@echo off', `cd /d "${serverRoot}"`];
  for (let raw of lines) {
    let line = raw.replace(/[ \t]+$/, '');
    const low = line.trim().toLowerCase();
    if (low === '@echo off') continue;
    if (low.startsWith('cd /d')) continue;
    if (/winws\d*\.exe/i.test(line) && /\bstart\b/i.test(line) && !/(^|\s)\/b(\s|$)/i.test(line)) line = line.replace(/\bstart\b/i, 'start /b');
    patched.push(line);
  }
  const copyPath = path.join(runDir, '_godji_copy.bat');
  fs.writeFileSync(copyPath, patched.join('\r\n'));

  const logPath = path.join(runDir, '_godji_run.log');
  const wrapper = path.join(runDir, '_godji_run.bat');
  fs.writeFileSync(wrapper, ['@echo off', `call "${copyPath}" > "${logPath}" 2>&1`, ':godjiwait', 'timeout /t 2 /nobreak >nul', 'tasklist /FI "IMAGENAME eq winws1.exe" /NH 2>nul | find /I "winws1.exe" >nul', 'if not errorlevel 1 goto godjiwait', 'tasklist /FI "IMAGENAME eq winws.exe" /NH 2>nul | find /I "winws.exe" >nul', 'if not errorlevel 1 goto godjiwait', 'exit /b'].join('\r\n'));
  return wrapper;
}
function runHiddenBat(wrapperBat) {
  const vbs = path.join(path.dirname(wrapperBat), '_godji_run.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "cmd /c ""${wrapperBat.replace(/"/g, '""')}""", 0, False`);
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
function runZapretService(status) {
  if (!status) {
    console.log('🛑 Остановка winws1 / winws...');
    try { execSync('taskkill /F /IM winws1.exe /T', { windowsHide: true, stdio: 'ignore' }); } catch (e) {}
    try { execSync('taskkill /F /IM winws.exe /T', { windowsHide: true, stdio: 'ignore' }); } catch (e) {}
    return true;
  }
  patchForClub();
  let configName = 'general.bat'; const cfgPath = path.join(zapretCoreDir, 'best-config.txt');
  if (fs.existsSync(cfgPath)) configName = fs.readFileSync(cfgPath, 'utf8').trim() || 'general.bat';
  if (!fs.existsSync(path.join(zapretCoreDir, configName))) { console.error('❌ Конфиг не найден:', configName); return false; }
  try { runHiddenBat(buildHiddenBat(configName)); console.log('🚀 Скрытый запуск:', configName); return true; } catch (e) { console.error('❌', e.message); return false; }
}

// ==========================================
// СЛУЖБЫ: статус / удаление сервиса / скан конфликтов
// ==========================================
function runHide(cmd) { try { return execSync(cmd, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : ''); } }
function svcExists(name) { return /(RUNNING|STOPPED|STOP_PENDING|START_PENDING)\b/i.test(runHide(`sc query "${name}"`)); }
function svcRunning(name) { return /RUNNING/i.test(runHide(`sc query "${name}"`)); }
const CONFLICT_SERVICES = ['zapret', 'WinDivert', 'WinDivert14', 'GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2'];
function removeZapretService() {
  if (svcExists('zapret')) { runHide('net stop zapret'); runHide('sc delete zapret'); }
  runHide('taskkill /F /IM winws.exe /T');
  if (svcExists('WinDivert')) { runHide('net stop WinDivert'); runHide('sc delete WinDivert'); }
  runHide('net stop WinDivert14'); runHide('sc delete WinDivert14');
  const still = svcExists('zapret');
  return { success: !still, message: still ? 'Службу zapret не удалось удалить (возможно, нужен перезапуск ПК).' : 'Служба zapret успешно удалена.' };
}
function scanServices() { const found = []; for (const name of CONFLICT_SERVICES) if (svcExists(name)) found.push({ name, running: svcRunning(name) }); return found; }
function removeServices(names) { const results = []; for (const n of names) { if (svcExists(n)) { runHide(`net stop "${n}"`); runHide(`sc delete "${n}"`); } results.push({ name: n, removed: !svcExists(n) }); } runHide('taskkill /F /IM winws.exe /T'); return results; }

// ==========================================
// НАСТРОЙКИ
// ==========================================
function runCmd(cmd) { try { return { out: execSync(cmd, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString(), code: 0 }; } catch (e) { return { out: (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : ''), code: e.status || 1 }; } }
function countLines(file) { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length > 0).length; } catch (e) { return 0; } }
function getGameFilter() { if (!fs.existsSync(GAME_FLAG)) return 'disabled'; try { const m = fs.readFileSync(GAME_FLAG, 'utf8').trim().toLowerCase(); return ['all', 'tcp', 'udp'].includes(m) ? m : 'disabled'; } catch (e) { return 'disabled'; } }
function setGameFilter(mode) { if (mode === 'disabled' || !mode) { try { fs.unlinkSync(GAME_FLAG); } catch (e) {} return getGameFilter(); } if (!fs.existsSync(UTILS_DIR)) fs.mkdirSync(UTILS_DIR, { recursive: true }); fs.writeFileSync(GAME_FLAG, mode.toLowerCase()); return getGameFilter(); }
function getIpsetStatus() { if (!fs.existsSync(IPSET_FILE)) return 'none'; if (countLines(IPSET_FILE) === 0) return 'any'; try { if (fs.readFileSync(IPSET_FILE, 'utf8').includes(IPSET_MARKER)) return 'none'; } catch (e) {} return 'loaded'; }
function setIpsetMode(target) { const cur = getIpsetStatus(); if (target === cur) return cur; if (!fs.existsSync(LISTS_DIR)) fs.mkdirSync(LISTS_DIR, { recursive: true }); if (target === 'none') { if (cur === 'loaded' && !fs.existsSync(IPSET_BACKUP)) { try { fs.copyFileSync(IPSET_FILE, IPSET_BACKUP); } catch (e) {} } fs.writeFileSync(IPSET_FILE, IPSET_MARKER + '\r\n'); } else if (target === 'any') { fs.writeFileSync(IPSET_FILE, ''); } else if (target === 'loaded') { if (fs.existsSync(IPSET_BACKUP)) { try { fs.copyFileSync(IPSET_BACKUP, IPSET_FILE); } catch (e) { return cur; } } else return cur; } return getIpsetStatus(); }
async function updateIpset() { try { if (!fs.existsSync(LISTS_DIR)) fs.mkdirSync(LISTS_DIR, { recursive: true }); await downloadFile(IPSET_URL, IPSET_FILE); return { success: true, status: getIpsetStatus(), message: 'Список IPSet обновлён' }; } catch (e) { return { success: false, message: e.message }; } }
async function updateHosts() {
  const hostsFile = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  const tempFile = path.join(os.tmpdir(), 'godji_hosts.txt');
  try { await downloadFile(HOSTS_URL, tempFile); } catch (e) { return { success: false, message: 'Не удалось скачать hosts: ' + e.message }; }
  let need = false;
  try { const tl = fs.readFileSync(tempFile, 'utf8').split(/\r?\n/).filter(l => l.trim().length); const first = tl[0] || '', last = tl[tl.length - 1] || ''; const sys = fs.existsSync(hostsFile) ? fs.readFileSync(hostsFile, 'utf8') : ''; if (first && !sys.includes(first)) need = true; if (last && !sys.includes(last)) need = true; } catch (e) { need = true; }
  if (!need) { try { fs.unlinkSync(tempFile); } catch (e) {} return { success: true, updated: false, message: 'Hosts актуален' }; }
  try { spawn('notepad.exe', [tempFile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  try { spawn('explorer.exe', ['/select,' + hostsFile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  return { success: true, updated: true, message: 'Hosts устарел. Скопируйте содержимое открывшегося Блокнота в системный hosts (он выделен в проводнике).' };
}
function listStrategies() {
  let files = []; try { files = fs.readdirSync(zapretCoreDir).filter(f => f.toLowerCase().endsWith('.bat')); } catch (e) {}
  files = files.filter(f => { const l = f.toLowerCase(); return !l.startsWith('service') && l !== '_godji_run.bat' && l !== '_godji_copy.bat'; });
  files.sort((a, b) => a.replace(/\d+/g, m => m.padStart(8, '0')).localeCompare(b.replace(/\d+/g, m => m.padStart(8, '0'))));
  let current = 'general.bat'; const cfg = path.join(zapretCoreDir, 'best-config.txt'); if (fs.existsSync(cfg)) { const v = fs.readFileSync(cfg, 'utf8').trim(); if (v) current = v; }
  return { list: files, current };
}
function setStrategy(name) { fs.writeFileSync(path.join(zapretCoreDir, 'best-config.txt'), name); return name; }
function runDiagnostics() {
  const res = []; const add = (s, t) => res.push({ status: s, text: t });
  { const r = runCmd('sc query BFE'); if (/RUNNING/i.test(r.out)) add('ok', 'Base Filtering Engine работает'); else add('err', 'Base Filtering Engine НЕ запущена — нужна для zapret'); }
  { const r = runCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable'); if (/0x1/i.test(r.out)) { const s = runCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer'); const m = s.out.match(/ProxyServer\s+REG_\w+\s+(.+)/i); add('warn', 'Включён системный прокси' + (m ? ': ' + m[1].trim() : '') + '. Проверьте его корректность'); } else add('ok', 'Системный прокси не мешает'); }
  { const r = runCmd('netsh interface tcp show global'); if (/timestamps[^\n]*enabled/i.test(r.out)) add('ok', 'TCP timestamps включены'); else { runCmd('netsh interface tcp set global timestamps=enabled'); const r2 = runCmd('netsh interface tcp show global'); if (/timestamps[^\n]*enabled/i.test(r2.out)) add('ok', 'TCP timestamps включены автоматически'); else add('err', 'Не удалось включить TCP timestamps'); } }
  { const r = runCmd('tasklist /FI "IMAGENAME eq AdguardSvc.exe" /FO CSV /NH'); if (/adguardsvc\.exe/i.test(r.out)) add('err', 'Найден AdGuard — может ломать Discord'); else add('ok', 'AdGuard не найден'); }
  const svc = runCmd('sc query type= service state= all').out.toLowerCase();
  if (svc.includes('killer')) add('err', 'Найдены службы Killer — конфликтуют с zapret'); else add('ok', 'Killer не найден');
  if (/intel[^\n]*connectivity[^\n]*network/.test(svc)) add('err', 'Intel Connectivity Network Service конфликтует с zapret'); else add('ok', 'Intel Connectivity не мешает');
  if (svc.includes('tracsrvwrapper') || svc.includes('epwd')) add('err', 'Найден Check Point — конфликтует'); else add('ok', 'Check Point не найден');
  if (svc.includes('smartbyte')) add('err', 'Найден SmartByte — конфликтует'); else add('ok', 'SmartByte не найден');
  { let has = false; try { has = fs.readdirSync(path.join(zapretCoreDir, 'bin')).some(f => f.endsWith('.sys')); } catch (e) {} if (has) add('ok', 'WinDivert64.sys на месте'); else add('err', 'WinDivert64.sys НЕ найден в bin\\'); }
  { const vpn = svc.split('\n').filter(l => l.includes('vpn')); if (vpn.length) add('warn', 'Найдены VPN-службы — отключите VPN'); else add('ok', 'VPN не обнаружен'); }
  { const hf = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts'); try { const t = fs.readFileSync(hf, 'utf8').toLowerCase(); if (t.includes('youtube.com') || t.includes('youtu.be')) add('warn', 'В hosts есть записи youtube — возможны проблемы'); else add('ok', 'hosts чист от youtube'); } catch (e) { add('ok', 'hosts не прочитан'); } }
  return res;
}

// ==========================================
// ОКНО
// ==========================================
const { createTelegramProxy } = require('./telegram-proxy');
const telegramProxy = createTelegramProxy({
  executable: path.join(app.isPackaged ? process.resourcesPath : appDir, 'tg-proxy', 'GodjiTelegramProxy', 'GodjiTelegramProxy.exe'),
  dataDir: userDataPath, shell
});
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({ width: 456, height: 576, frame: false, transparent: true, resizable: false, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true } });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')); mainWindow.setMenuBarVisibility(false);
}
app.whenReady().then(() => {
  try { patchForClub(); } catch (e) {}
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: false, name: 'GodjiZapret' }); } catch (e) {}
  }
  logStartup('app ready -> creating window');
  createWindow();
});

// ==========================================
// IPC
// ==========================================
ipcMain.handle('download-zapret', () => downloadAndExtractZapret());
ipcMain.handle('check-updates', () => checkForUpdates());
ipcMain.handle('run-tests', () => runTests());
let statusRequest = null;
ipcMain.handle('check-status', () => {
  if (!statusRequest) {
    statusRequest = new Promise((resolve, reject) => {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq winws*'],
        { windowsHide: true, timeout: 5000 }, (error, stdout) => {
          if (error) return reject(error);
          resolve({ running: /^"winws(?:1)?\.exe"/im.test(stdout) });
        });
    }).finally(() => { statusRequest = null; });
  }
  return statusRequest;
});
ipcMain.handle('get-game-filter', () => getGameFilter());
ipcMain.handle('set-game-filter', (e, mode) => setGameFilter(mode));
ipcMain.handle('get-ipset-status', () => getIpsetStatus());
ipcMain.handle('set-ipset-mode', (e, target) => setIpsetMode(target));
ipcMain.handle('update-ipset', () => updateIpset());
ipcMain.handle('update-hosts', () => updateHosts());
ipcMain.handle('run-diagnostics', () => runDiagnostics());
ipcMain.handle('list-strategies', () => listStrategies());
ipcMain.handle('set-strategy', (e, name) => setStrategy(name));
ipcMain.handle('remove-zapret-service', () => removeZapretService());
ipcMain.handle('scan-services', () => scanServices());
ipcMain.handle('remove-services', (e, names) => removeServices(names));
ipcMain.handle('check-app-update', () => checkAppUpdate());
ipcMain.handle('apply-app-update', () => applyAppUpdate((pct) => { if (mainWindow) mainWindow.webContents.send('app-update-progress', pct); }));
let protectionOperation = null;
ipcMain.handle('toggle-zapret', (e, enabled) => {
  if (typeof enabled !== 'boolean') return {success:false,message:'Некорректная команда'};
  if (protectionOperation) return {success:false,message:'Дождитесь завершения предыдущей операции'};
  protectionOperation = (async () => {
    const zapretOk = runZapretService(enabled);
    const telegram = await telegramProxy.action(enabled ? 'start' : 'stop');
    return {success:zapretOk && telegram.success, message:!zapretOk ? 'Не удалось запустить Zapret: проверьте ядро и стратегию.' : (telegram.message || ''), telegram:telegram.state};
  })().finally(() => { protectionOperation = null; });
  return protectionOperation;
});
ipcMain.handle('telegram-status', () => telegramProxy.status());
ipcMain.handle('telegram-action', (e, action) => telegramProxy.action(action));
ipcMain.on('open-admin-panel', () => {});
ipcMain.on('close-app', () => app.quit());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
