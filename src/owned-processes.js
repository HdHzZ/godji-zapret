const path = require('path');
const {execFile} = require('child_process');

function execute(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {windowsHide:true,timeout:8000}, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}
function isAlive(pid) {
  try {process.kill(pid, 0);return true;} catch (error) {return error.code === 'EPERM';}
}
// Discovery is cached; every termination revalidates the executable path.
function createOwnedProcesses({executables, run = execute, alive = isAlive, now = Date.now, ttl = 30000}) {
  const paths = executables.map(file => path.resolve(file));
  const quote = value => "'" + value.replace(/'/g,"''") + "'";
  const names = [...new Set(paths.map(file => path.basename(file)))];
  const filter = names.map(name => "Name='" + name.replace(/'/g,"''") + "'").join(' OR ');
  const command = `$paths = @(${paths.map(quote).join(',')}); Get-CimInstance Win32_Process -Filter ${quote(filter)} | Where-Object { $paths -contains $_.ExecutablePath } | ForEach-Object { $_.ProcessId }`;
  let pids = [], updated = -Infinity, pending = null;
  async function list({fresh = false} = {}) {
    if (fresh || now() - updated >= ttl) {
      if (!pending) pending = run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command]).then(stdout => {
        pids = [...new Set(stdout.trim().split(/\s+/).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
        updated = now(); return pids;
      }).finally(() => {pending = null;});
      await pending;
    }
    pids = pids.filter(alive);
    return [...pids];
  }
  async function stop() {
    const ids = await list({fresh:true});
    for (const pid of ids) {
      try {await run('taskkill.exe',['/PID',String(pid),'/T','/F']);}
      catch (error) {if ((await list({fresh:true})).includes(pid)) throw error;}
    }
    pids = []; updated = -Infinity;
  }
  async function foreign() {
    const output = await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command.replace('$paths -contains','$paths -notcontains')]);
    return output.trim().split(/\s+/).map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  }
  return {list, stop, foreign, invalidate:() => {updated = -Infinity;}};
}
module.exports = {createOwnedProcesses,execute};
