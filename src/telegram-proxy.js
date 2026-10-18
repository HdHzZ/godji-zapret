const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

function createTelegramProxy({ executable, dataDir, shell }) {
  executable = path.resolve(executable);
  const appData = path.join(dataDir, 'telegram-data');
  const configDir = path.join(appData, 'TgWsProxy');
  const configFile = path.join(configDir, 'config.json');
  let pending = Promise.resolve();
  let child = null;
  let lastError = '';
  const exec = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  function config() {
    fs.mkdirSync(configDir, { recursive: true });
    if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, JSON.stringify({host:'127.0.0.1', port:1444, secret:crypto.randomBytes(16).toString('hex'), autostart:false, check_updates:false}, null, 2));
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!['127.0.0.1','localhost','::1'].includes(cfg.host) || !Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535 || !/^[a-f0-9]{32}$/i.test(cfg.secret)) throw Error('В настройках нужны локальный адрес, порт 1–65535 и secret из 32 hex-символов.');
    return cfg;
  }
  async function processes() {
    const literal = executable.replace(/'/g, "''");
    const output = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter "Name='GodjiTelegramProxy.exe'" | Where-Object { $_.ExecutablePath -eq '${literal}' }; $p | ForEach-Object { $_.ProcessId }`]);
    return output.trim().split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
  }
  function portReady(cfg) {
    return new Promise(resolve => {
      const socket = net.createConnection({host:cfg.host, port:cfg.port});
      let finished = false;
      const done = ok => { if (finished) return; finished = true; socket.destroy(); resolve(ok); };
      socket.setTimeout(500); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
    });
  }
  async function status() {
    const installed = fs.existsSync(executable);
    if (!installed) return {installed:false,running:false,ready:false,error:'TG WS Proxy не найден в сборке'};
    const ids = child && child.exitCode === null && child.pid ? [child.pid] : await processes();
    const ready = ids.length > 0 && await portReady(config());
    return {installed, running:ids.length > 0, ready, error:lastError};
  }
  async function start() {
    if (!fs.existsSync(executable)) throw Error('TG WS Proxy не найден. Используйте полную сборку Godji.');
    const cfg = config();
    const ids = await processes();
    if (!ids.length) {
      if (await portReady(cfg)) throw Error('Порт Telegram-прокси уже занят другим приложением.');
      lastError = '';
      const errorLog = fs.openSync(path.join(configDir, 'startup-error.log'), 'w');
      try { child = spawn(executable, [configFile], {cwd:path.dirname(executable), windowsHide:true, detached:true, stdio:['ignore','ignore',errorLog]}); }
      finally { fs.closeSync(errorLog); }
      child.on('error', error => { lastError = error.message; });
      child.unref();
    }
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (lastError) throw Error(lastError);
      if (await portReady(cfg)) { const state = await status(); if (state.running) return state; }
      if (child && child.exitCode !== null) throw Error('TG WS Proxy завершился при запуске. Проверьте журнал.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error('TG WS Proxy не открыл порт за 20 секунд. Проверьте журнал.');
  }
  async function stop() {
    const ids = await processes();
    for (const id of ids) {
      try { await exec('taskkill.exe', ['/PID',String(id),'/T','/F']); }
      catch (error) { if ((await processes()).includes(id)) throw error; }
    }
    child = null; lastError = '';
    return status();
  }
  function action(name) {
    const operation = pending.then(async () => {
      try {
        let state;
        if (name === 'start') state = await start();
        else if (name === 'stop') state = await stop();
        else if (name === 'restart') { await stop(); state = await start(); }
        else if (name === 'connect') {
          const cfg = config(); const state = await status();
          if (!state.ready) throw Error('Сначала запустите Telegram-прокси.');
          if (!/^[a-f0-9]{32}$/i.test(cfg.secret) || !Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw Error('Некорректная конфигурация прокси.');
          await shell.openExternal(`tg://proxy?server=${encodeURIComponent(cfg.host)}&port=${cfg.port}&secret=dd${cfg.secret}`);
        } else if (name === 'logs') {
          const error = await shell.openPath(path.join(configDir, fs.existsSync(path.join(configDir,'proxy.log')) ? 'proxy.log' : 'startup-error.log')); if (error) throw Error(error);
        } else if (name === 'settings') {
          config(); const error = await shell.openPath(configFile); if (error) throw Error(error);
        } else throw Error('Неизвестная команда');
        return {success:true, state:state || await status()};
      } catch (error) { lastError = error.message; return {success:false, message:error.message}; }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return {status, action};
}
module.exports = {createTelegramProxy};
