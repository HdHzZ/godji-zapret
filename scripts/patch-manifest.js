// afterPack-хук electron-builder: вшивает в собранный .exe манифест
// requireAdministrator (двойной клик / запуск через шелл сразу просят UAC).
// ВАЖНО: не импортируем JS-обёртку rcedit (она ломается на ESM/CJS),
// а вызываем сам rcedit.exe из node_modules как внешнюю программу.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findRceditBin() {
  // 1) Надёжно: через package.json пакета (require.resolve не выполняет код пакета)
  let pkgDir = null;
  try { pkgDir = path.dirname(require.resolve('rcedit/package.json')); } catch (e) {}
  // 2) Запасной путь: node_modules в корне проекта
  if (!pkgDir) {
    const guess = path.join(process.cwd(), 'node_modules', 'rcedit');
    if (fs.existsSync(guess)) pkgDir = guess;
  }
  if (!pkgDir) return null;

  const binDir = path.join(pkgDir, 'bin');
  if (!fs.existsSync(binDir)) return null;
  // x64 предпочтительнее на x64-сборке
  const candidates = ['rcedit-x64.exe', 'rcedit.exe', 'rcedit-ia32.exe'];
  for (const c of candidates) {
    const p = path.join(binDir, c);
    if (fs.existsSync(p)) return p;
  }
  // вдруг лежит без расширения / другое имя
  const any = fs.readdirSync(binDir).find(f => /rcedit.*\.exe$/i.test(f));
  return any ? path.join(binDir, any) : null;
}

module.exports = async function (context) {
  const dir = context.appOutDir;
  if (!dir || !fs.existsSync(dir)) return;

  const bin = findRceditBin();
  if (!bin) {
    console.warn('⚠️ rcedit.exe не найден в node_modules — манифест НЕ вшит! Выполни: npm i -D rcedit');
    return;
  }
  console.log('🔧 rcedit bin:', bin);

  const exes = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.exe'));
  for (const exe of exes) {
    const full = path.join(dir, exe);
    const r = spawnSync(bin, [full, '--set-requested-execution-level', 'requireAdministrator'], { windowsHide: true });
    if (r.status === 0) console.log('✅ requireAdministrator вшит в', exe);
    else console.warn('⚠️ rcedit вернул код', r.status, 'для', exe, (r.stderr ? r.stderr.toString() : '').trim());
  }
};