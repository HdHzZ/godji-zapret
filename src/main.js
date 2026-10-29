const { app, BrowserWindow, ipcMain, shell, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn, exec, execFile } = require('child_process');
const extractZip = require('extract-zip');

// Opaque windows use the compositor. Opt in only for a broken GPU driver.
if (process.env.GODJI_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();

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
async function isAdmin() {try {await execute('net.exe',['session']);return true;}catch{return false;}}
async function ensureAdmin() {
  if (await isAdmin()) return true;
  const quote = value => "'" + value.replace(/'/g,"''") + "'";
  const args = process.argv.slice(1);
  const argumentList = args.length ? ' -ArgumentList @(' + args.map(quote).join(',') + ')' : '';
  const command = 'Start-Process -FilePath ' + quote(process.execPath) + argumentList + ' -WorkingDirectory ' + quote(appDir) + ' -Verb RunAs -WindowStyle Hidden';
  const helper = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{detached:true,windowsHide:true,stdio:'ignore'});
  helper.on('error',error => logStartup(error.message));helper.unref();
  app.quit();return false;
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
const {createOwnedProcesses,execute} = require('./owned-processes');
const zapretProcesses = createOwnedProcesses({executables:['winws.exe','winws1.exe'].map(name => path.join(zapretCoreDir,'bin',name))});
async function checkZapretRunning() {return (await zapretProcesses.list()).length > 0;}

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
    await runZapretService(false);
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
  if ((await zapretProcesses.list({fresh:true})).length) return {success:false,message:'Сначала выключите защиту, затем обновите ядро.'};
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
let testTotal = 0, testFinished = false, testTimer = null, testProcess = null;
function readBestFromResultsFile() { try { const dir = path.join(zapretCoreDir, 'utils', 'test results'); if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(x => x.startsWith('test_results_')).sort(); if (!f.length) return null; const m = fs.readFileSync(path.join(dir, f[f.length - 1]), 'utf8').match(/Best strategy:\s*(.+)/i); return m ? m[1].trim() : null; } catch (e) { return null; } }
function finishTest(best) {
  if (testFinished) return; testFinished = true; if (testTimer) { clearTimeout(testTimer); testTimer = null; }
  if (!best) best = readBestFromResultsFile(); if (!best) best = 'general.bat'; saveBestConfig(best);
  if (mainWindow) { mainWindow.webContents.send('test-progress', 100); mainWindow.webContents.send('test-complete', { success: true, bestConfig: best, message: `Лучший протокол: ${best}` }); }
  console.log('✅ Тесты завершены. Лучший конфиг:', best);
}
function runTests() {
  if(testProcess) return {success:false,message:'Тест уже выполняется.'};
  const original = path.join(zapretCoreDir,'utils','test zapret.ps1');
  if(!fs.existsSync(original)) return {success:false,message:'Сначала скачайте ядро Zapret.'};
  const strategiesDir = path.join(runDir,'test-strategies'); fs.mkdirSync(strategiesDir,{recursive:true});
  let script = path.join(runDir,'protocol-test.ps1');
  try {
    for(const name of listStrategies().list) buildHiddenBat(name,path.join(strategiesDir,name));
    const source = require('./protocol-test').scopeProtocolTest(fs.readFileSync(original,'utf8'),{coreDir:zapretCoreDir,strategiesDir});
    fs.writeFileSync(script,'\ufeff' + source);
  } catch(error) {return {success:false,message:error.message};}
  if (!fs.existsSync(script)) return { success: false, message: 'test zapret.ps1 не найден. Сначала «СКАЧАТЬ ZAPRET».' };
  testTotal = 0; testFinished = false; if (testTimer) clearTimeout(testTimer);
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::Out.AutoFlush = $true; $ProgressPreference = 'SilentlyContinue'; & '${script}'`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  testProcess = ps;
  ps.stdin.on('error', () => {}); ps.stdin.write('1\n'); ps.stdin.write('1\n'); ps.stdin.end();
  function failTest(message) {
    if(testFinished) return;
    testFinished = true;clearTimeout(testTimer);testTimer = null;
    if(mainWindow) mainWindow.webContents.send('test-complete',{success:false,message});
  }
  testTimer = setTimeout(() => { failTest('Время теста истекло. Попробуйте другую стратегию вручную.'); try {ps.kill();} catch {} zapretProcesses.stop().catch(error => logStartup(error.message)); }, 12 * 60 * 1000);
  ps.stdout.on('data', (data) => {
    const text = data.toString(); process.stdout.write(text);
    const tot = text.match(/Total configs:\s*(\d+)/); if (tot) testTotal = parseInt(tot[1]);
    const re = /\[\s*(\d+)\s*\/\s*(\d+)\s*\]/g; let m;
    while ((m = re.exec(text)) !== null) { const n = parseInt(m[1]); const t = parseInt(m[2]) || testTotal || 20; testTotal = t; if (mainWindow) mainWindow.webContents.send('test-progress', Math.max(0, Math.min(99, Math.round(((n - 1) / t) * 100)))); }
    const bm = text.match(/Best config:\s*(.+)/); if (bm) { try { ps.kill(); } catch (e) {} finishTest(bm[1].trim()); }
  });
  ps.stderr.on('data', (data) => process.stderr.write(data));
  ps.on('close', code => {testProcess = null;zapretProcesses.invalidate();if(code === 0) finishTest(null);else failTest('Тест завершился с ошибкой. Проверьте журнал запуска.');});
  ps.on('error', error => {testProcess = null;failTest('Ошибка запуска: ' + error.message);});
  return { success: true, message: 'Тесты запущены' };
}
function saveBestConfig(name) { fs.writeFileSync(path.join(zapretCoreDir, 'best-config.txt'), name); }

// ==========================================
// СКРЫТЫЙ ЗАПУСК (winws1) — read-only friendly
// ==========================================
function buildHiddenBat(configName,destination = path.join(runDir,'_godji_copy.bat')) {
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
    if (/^call\s+(?:"[^"]*service\.bat"|service\.bat)\s+(?:status_zapret|check_updates|tcp_enable)\b/i.test(line.trim())) continue;
    if (low.startsWith('cd /d')) continue;
    if (/winws\d*\.exe/i.test(line) && /\bstart\b/i.test(line)) { line = line.replace(/\bstart\b/i, 'start /b /wait'); }
    patched.push(line);
  }
  const copyPath = destination;
  fs.writeFileSync(copyPath, patched.join('\r\n'));

  return copyPath;
}
function runHiddenBat(batch) {
  const log = fs.openSync(path.join(runDir,'_godji_run.log'),'w');
  let child;
  try {child = spawn('cmd.exe',['/d','/s','/c', '""' + batch + '""'],{windowsVerbatimArguments:true,windowsHide:true,detached:true,stdio:['ignore',log,log]});}
  finally {fs.closeSync(log);}
  child.on('error',error => logStartup('Core launch: ' + error.message));child.unref();
  return new Promise((resolve,reject) => {child.once('spawn',resolve);child.once('error',reject);});
}
async function runZapretService(enabled) {
  if (!enabled) {await zapretProcesses.stop();return true;}
  if ((await zapretProcesses.list({fresh:true})).length) return true;
  if ((await zapretProcesses.foreign()).length) throw Error('Запущен другой экземпляр Zapret. Godji не будет останавливать его или запускать второй фильтр. Сначала выключите другой экземпляр.');
  const cfg = path.join(zapretCoreDir,'best-config.txt');
  const name = fs.existsSync(cfg) ? fs.readFileSync(cfg,'utf8').trim() || 'general.bat' : 'general.bat';
  if (path.basename(name) !== name || !name.toLowerCase().endsWith('.bat') || !fs.existsSync(path.join(zapretCoreDir,name))) return false;
  await runHiddenBat(buildHiddenBat(name));
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve,350));
    if ((await zapretProcesses.list({fresh:true})).length) return true;
  }
  return false;
}

// ==========================================
// СЛУЖБЫ: статус / удаление сервиса / скан конфликтов
// ==========================================
const CONFLICT_SERVICES = ['zapret', 'WinDivert', 'WinDivert14', 'GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2'];
async function scanServices() {
  const found = [];
  for (const name of CONFLICT_SERVICES) {
    const result = await runCmd('sc query "' + name + '"');
    if (result.code === 0) found.push({name,running:/RUNNING/i.test(result.out)});
  }
  return found;
}
async function removeServices(names) {
  const results = [];
  for (const name of Array.isArray(names) ? names : []) {
    if (!CONFLICT_SERVICES.includes(name)) {results.push({name,removed:false});continue;}
    const config = await runCmd('sc qc "' + name + '"');
    if (!config.out.toLowerCase().includes((zapretCoreDir + path.sep).toLowerCase())) {results.push({name,removed:false});continue;}
    await runCmd('sc stop "' + name + '"');
    const deletion = await runCmd('sc delete "' + name + '"');
    results.push({name,removed:deletion.code === 0});
  }
  return results;
}
async function removeZapretService() {
  await zapretProcesses.stop();
  const [result] = await removeServices(['zapret']);
  return {success:true,message:result.removed ? 'Собственное ядро и служба Godji остановлены.' : 'Собственное ядро остановлено. Сторонние службы и общий драйвер WinDivert не изменялись.'};
}

// ==========================================
// НАСТРОЙКИ
// ==========================================
function runCmd(command) {
  return new Promise(resolve => exec(command,{windowsHide:true,timeout:10000,maxBuffer:2*1024*1024},(error,stdout,stderr) => resolve({out:stdout || stderr || '',code:error ? error.code || 1 : 0})));
}
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
async function runDiagnostics() {
  const results = [], add = (status,text) => results.push({status,text});
  const [bfe,proxy,tcp,adguard,services] = await Promise.all(['sc query BFE','reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable','netsh interface tcp show global','tasklist /FI "IMAGENAME eq AdguardSvc.exe" /FO CSV /NH','sc query type= service state= all'].map(runCmd));
  add(/RUNNING/i.test(bfe.out)?'ok':'warn','Base Filtering Engine: ' + (/RUNNING/i.test(bfe.out)?'работает':'проверьте состояние службы'));
  add(/0x1/i.test(proxy.out)?'warn':'ok',/0x1/i.test(proxy.out)?'Включён системный прокси. Godji не изменяет его настройки.':'Системный прокси отключён');
  add('ok','Состояние TCP прочитано. Системные параметры не изменялись.');
  if (tcp.code !== 0) add('warn','Не удалось прочитать параметры TCP');
  add(/adguardsvc\.exe/i.test(adguard.out)?'warn':'ok',/adguardsvc\.exe/i.test(adguard.out)?'Обнаружен AdGuard: проверьте совместимость выбранной стратегии':'AdGuard не обнаружен');
  for (const name of ['killer','smartbyte','tracsrvwrapper','epwd','vpn']) if(services.out.toLowerCase().includes(name)) add('warn','Обнаружена возможная несовместимость: ' + name + '. Служба не изменялась.');
  add(fs.existsSync(path.join(zapretCoreDir,'bin','WinDivert64.sys'))?'ok':'err','Проверка драйвера WinDivert64.sys');
  return results;
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
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({ width: Math.min(480,area.width - 24), height: Math.min(680,area.height - 24), frame: false, transparent: false, backgroundColor: '#11161d', maximizable: false, resizable: false, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, backgroundThrottling: true } });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')); mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.once('did-finish-load',() => {try {os.setPriority(mainWindow.webContents.getOSProcessId(),os.constants.priority.PRIORITY_BELOW_NORMAL);} catch {}});
}
app.whenReady().then(async () => {
  if (!await ensureAdmin()) return;
  if (!app.requestSingleInstanceLock()) {app.quit();return;}
  app.on('second-instance',() => {if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
  try {os.setPriority(process.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);} catch {}
  try { patchForClub(); } catch (e) {}
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: false, name: 'GodjiZapret' }); } catch (e) {}
  }
  logStartup('app ready -> creating window');
  createWindow();
}).catch(error => {logStartup(error.stack || error.message);app.quit();});

// ==========================================
// IPC
// ==========================================
ipcMain.handle('download-zapret', () => downloadAndExtractZapret());
ipcMain.handle('check-updates', () => checkForUpdates());
ipcMain.handle('run-tests', () => runTests());
ipcMain.handle('get-app-version',() => app.getVersion());
ipcMain.handle('check-status',async () => ({running:await checkZapretRunning()}));
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
    const zapretOk = await runZapretService(enabled);
    const telegram = await telegramProxy.action(enabled ? 'start' : 'stop');
    return {success:zapretOk && telegram.success, message:!zapretOk ? 'Не удалось запустить Zapret: проверьте ядро и стратегию.' : (telegram.message || ''), telegram:telegram.state};
  })().finally(() => { protectionOperation = null; });
  return protectionOperation;
});
ipcMain.handle('telegram-status', () => telegramProxy.status());
ipcMain.handle('telegram-action', (e, action) => telegramProxy.action(action));
ipcMain.on('open-admin-panel', () => {});
ipcMain.on('minimize-app',() => mainWindow?.minimize());
ipcMain.on('close-app', () => app.quit());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
