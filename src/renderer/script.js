const container = document.getElementById('buttonContainer');
const btn = document.getElementById('powerBtn');
const powerLabel = document.getElementById('powerLabel');
const statusText = document.getElementById('statusText');
const closeBtn = document.getElementById('closeBtn');
const adminBtn = document.getElementById('adminBtn');
const adminPanel = document.getElementById('adminPanel');
const closeAdminBtn = document.getElementById('closeAdminBtn');
const adminButtons = document.getElementById('adminButtons');
const adminSettings = document.getElementById('adminSettings');
const updateBtn = document.getElementById('updateBtn');
const updateAppBtn = document.getElementById('updateAppBtn');
const testBtn = document.getElementById('testBtn');
const downloadZapretBtn = document.getElementById('downloadZapretBtn');
const testProgressContainer = document.getElementById('testProgressContainer');
const testProgressFill = document.getElementById('testProgressFill');
const testProgressText = document.getElementById('testProgressText');

let isActive = false;
let statusPending = false;
let appUpdating = false; // флаг, чтобы глобальный listener прогресса апдейта оболочки не реагировал вхолостую

let noticeTimer;
function notify(message) {
    const notice = document.getElementById('notice'); notice.textContent = message; notice.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => {notice.hidden = true;},10000);
}
document.getElementById('notice').addEventListener('click',() => {document.getElementById('notice').hidden = true;clearTimeout(noticeTimer);});
function applyVisualState(active) {
    isActive = !!active;
    btn.setAttribute('aria-pressed',String(isActive));
    btn.setAttribute('aria-label',isActive ? 'Выключить защиту' : 'Включить защиту');
    powerLabel.textContent = isActive ? 'Отключить' : 'Подключить';
    container.classList.toggle('active',isActive);
}
let togglePending = false;
let telegramPending = false;
function showTelegram(state) {
    const label = state.error ? 'Ошибка' : state.ready ? 'Работает' : state.running ? 'Запускается' : 'Отключён';
    document.getElementById('telegramSummary').textContent = label;
    document.getElementById('telegramStatus').textContent = state.error ? state.error : label;
    document.getElementById('telegramCard').dataset.state = state.error || state.running && !state.ready ? 'warning' : state.ready ? 'ready' : 'off';
}
async function refreshTelegram() {
    if (!window.electronAPI?.telegramStatus || telegramPending) return;
    telegramPending = true;
    try { showTelegram(await window.electronAPI.telegramStatus()); }
    catch (e) { document.getElementById('telegramStatus').textContent = 'Ошибка проверки: ' + e.message; }
    finally { telegramPending = false; }
}
function showProtection(zapret,telegram) {
    applyVisualState(zapret.running || telegram.running);
    showTelegram(telegram);
    document.getElementById('zapretSummary').textContent = zapret.running ? 'Работает' : 'Отключён';
    document.getElementById('zapretCard').dataset.state = zapret.running ? 'ready' : 'off';
    const complete = zapret.running && telegram.ready && !telegram.error;
    statusText.textContent = complete ? 'Всё подключено' : isActive ? 'Подключено частично' : 'Готово к подключению';
    document.getElementById('connectionHint').textContent = complete ? 'Zapret и Telegram работают.' : isActive ? 'Проверьте состояние компонентов в настройках.' : 'Запустите Zapret и Telegram одним нажатием.';
}
async function pollStatus() {
    if (document.hidden || statusPending || togglePending || !window.electronAPI?.checkStatus) return;
    statusPending = true;
    try { const [zapret, telegram] = await Promise.all([window.electronAPI.checkStatus(), window.electronAPI.telegramStatus()]); showProtection(zapret, telegram); }
    catch (e) { console.warn('Status', e); }
    finally { statusPending = false; }
}
async function toggleState() {
    if (togglePending || !window.electronAPI) return;
    const desired = !isActive;
    togglePending = true; btn.disabled = true;
    container.classList.add('ignition','busy'); btn.setAttribute('aria-busy','true');
    statusText.textContent = desired ? 'Подключаем…' : 'Отключаем…';
    powerLabel.textContent = 'Подождите';
    document.getElementById('connectionHint').textContent = 'Это может занять несколько секунд.';
    try {
        const result = await window.electronAPI.toggleZapret(desired);
        if (!result.success) notify(result.message || 'Не удалось выполнить команду');
        const [zapret, telegram] = await Promise.all([window.electronAPI.checkStatus(), window.electronAPI.telegramStatus()]); showProtection(zapret, telegram);
    } catch (e) { notify(e.message); statusText.textContent = 'Не удалось подключиться'; powerLabel.textContent = isActive ? 'Отключить' : 'Повторить'; }
    finally { togglePending = false; btn.disabled = false; container.classList.remove('busy'); btn.setAttribute('aria-busy','false'); }
}
document.querySelectorAll('[data-tg]').forEach(button => button.addEventListener('click', async () => {
    const controls = document.querySelectorAll('[data-tg]'); controls.forEach(b => b.disabled = true);
    document.getElementById('telegramStatus').textContent = 'Выполнение команды…';
    try { const result = await window.electronAPI.telegramAction(button.dataset.tg); if (!result.success) notify(result.message); await pollStatus(); }
    catch (e) { notify('Telegram: ' + e.message); }
    finally { controls.forEach(b => b.disabled = false); }
}));

const homeView = document.getElementById('homeView');
const settingsTabs = [...document.querySelectorAll('[data-tab]')];
function selectSettingsTab(name,focus = false) {
    const chosen = settingsTabs.find(tab => tab.dataset.tab === name);
    if(!chosen) return;
    for(const tab of settingsTabs) {
        const selected = tab === chosen;
        tab.setAttribute('aria-selected',String(selected));tab.tabIndex = selected ? 0 : -1;
        document.getElementById('page-' + tab.dataset.tab).hidden = !selected;
    }
    document.querySelector('.admin-panel-content').scrollTop = 0;
    if(focus) chosen.focus({preventScroll:true});
}
for(const tab of settingsTabs) {
    tab.addEventListener('click',() => selectSettingsTab(tab.dataset.tab));
    tab.addEventListener('keydown',event => {
        const index = settingsTabs.indexOf(tab);
        let next;
        if(event.key === 'ArrowRight') next = (index + 1) % settingsTabs.length;
        if(event.key === 'ArrowLeft') next = (index + settingsTabs.length - 1) % settingsTabs.length;
        if(event.key === 'Home') next = 0;
        if(event.key === 'End') next = settingsTabs.length - 1;
        if(next !== undefined) {event.preventDefault();selectSettingsTab(settingsTabs[next].dataset.tab,true);}
    });
}
function openAdminPanel() {
    adminBtn.setAttribute('aria-expanded','true');
    adminPanel.inert = false;adminPanel.setAttribute('aria-hidden','false');
    document.body.classList.add('admin-open');adminPanel.classList.add('active');
    settingsTabs.find(tab => tab.getAttribute('aria-selected') === 'true').focus({preventScroll:true});
    homeView.inert = true;homeView.setAttribute('aria-hidden','true');
    loadSettings();refreshTelegram();
}
function closeAdminPanel() {
    adminBtn.setAttribute('aria-expanded','false');
    homeView.inert = false;homeView.removeAttribute('aria-hidden');adminBtn.focus({preventScroll:true});
    adminPanel.inert = true;adminPanel.setAttribute('aria-hidden','true');
    document.body.classList.remove('admin-open');adminPanel.classList.remove('active');
}
document.addEventListener('keydown',event => {if(event.key === 'Escape' && adminPanel.classList.contains('active')) closeAdminPanel();});
if(window.electronAPI?.appVersion) window.electronAPI.appVersion().then(version => {
    document.querySelectorAll('.app-version').forEach(label => {label.textContent = 'v' + version;});
}).catch(() => {});

function highlightSeg(id, mode) { const c = document.getElementById(id); if (!c) return; c.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode)); }
async function loadSettings() {
    try {
        highlightSeg('gameSeg', await window.electronAPI.getGameFilter());
        highlightSeg('ipsetSeg', await window.electronAPI.getIpsetStatus());
        const st = await window.electronAPI.listStrategies();
        const sel = document.getElementById('strategySelect'), cur = document.getElementById('currentStrategy');
        if (sel) { sel.innerHTML = ''; st.list.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; if (f === st.current) o.selected = true; sel.appendChild(o); }); }
        if (cur) cur.textContent = 'Текущая: ' + st.current;
    } catch (e) { console.warn('loadSettings', e); }
}

document.querySelectorAll('#gameSeg .seg-btn').forEach(b => b.addEventListener('click', async () => { const m = b.dataset.mode; highlightSeg('gameSeg', await window.electronAPI.setGameFilter(m)); if (m !== 'disabled') notify('Перезапустите защиту (выкл/вкл Godji), чтобы Game Filter применился.'); }));
document.querySelectorAll('#ipsetSeg .seg-btn').forEach(b => b.addEventListener('click', async () => { const t = b.dataset.mode; const res = await window.electronAPI.setIpsetMode(t); highlightSeg('ipsetSeg', res); if (t === 'loaded' && res !== 'loaded') notify('Нет бэкапа списка. Нажмите «ОБНОВИТЬ СПИСОК IPSET».'); else notify('Перезапустите защиту для применения IPSet.'); }));

const updateIpsetBtn = document.getElementById('updateIpsetBtn');
if (updateIpsetBtn) updateIpsetBtn.addEventListener('click', async () => { updateIpsetBtn.disabled = true; const o = updateIpsetBtn.textContent; updateIpsetBtn.textContent = 'Обновляем…'; const r = await window.electronAPI.updateIpset(); updateIpsetBtn.disabled = false; updateIpsetBtn.textContent = o; if (r.success) { highlightSeg('ipsetSeg', r.status); notify(r.message); } else notify('Ошибка: ' + r.message); });

const updateHostsBtn = document.getElementById('updateHostsBtn');
if (updateHostsBtn) updateHostsBtn.addEventListener('click', async () => { updateHostsBtn.disabled = true; const o = updateHostsBtn.textContent; updateHostsBtn.textContent = 'Проверяем…'; const r = await window.electronAPI.updateHosts(); updateHostsBtn.disabled = false; updateHostsBtn.textContent = o; notify(r.message); });

const applyStrategy = document.getElementById('applyStrategy');
if (applyStrategy) applyStrategy.addEventListener('click', async () => { const sel = document.getElementById('strategySelect'); if (!sel || !sel.value) return; await window.electronAPI.setStrategy(sel.value); const cur = document.getElementById('currentStrategy'); if (cur) cur.textContent = 'Текущая: ' + sel.value; notify('Стратегия сохранена. Перезапустите защиту для применения.'); });

const diagBtn = document.getElementById('diagBtn');
if (diagBtn) diagBtn.addEventListener('click', async () => {
    const box = document.getElementById('diagResults'), orig = diagBtn.querySelector('span').textContent;
    diagBtn.disabled = true; diagBtn.querySelector('span').textContent = 'Проверяем…'; if (box) box.innerHTML = '';
    try { const res = await window.electronAPI.runDiagnostics(); if (box) { box.innerHTML = ''; res.forEach(r => { const d = document.createElement('div'); d.className = 'diag-item diag-' + r.status; d.textContent = (r.status === 'ok' ? '✓' : r.status === 'warn' ? '!' : '✗') + '  ' + r.text; box.appendChild(d); }); } }
    catch (e) { if (box) box.innerHTML = '<div class="diag-item diag-err">Ошибка диагностики: ' + e.message + '</div>'; }
    diagBtn.disabled = false; diagBtn.querySelector('span').textContent = orig;
});

// ===== СЛУЖБЫ СИСТЕМЫ =====
const removeServiceBtn = document.getElementById('removeServiceBtn');
if (removeServiceBtn) removeServiceBtn.addEventListener('click', async () => {
    removeServiceBtn.disabled = true; const o = removeServiceBtn.textContent; removeServiceBtn.textContent = 'Выполняем…';
    const r = await window.electronAPI.removeZapretService();
    removeServiceBtn.disabled = false; removeServiceBtn.textContent = o;
    notify(r.message);
});
let scannedNames = [];
const scanServicesBtn = document.getElementById('scanServicesBtn');
const serviceList = document.getElementById('serviceList');
const removeFoundBtn = document.getElementById('removeFoundBtn');
if (scanServicesBtn) scanServicesBtn.addEventListener('click', async () => {
    scanServicesBtn.disabled = true; const o = scanServicesBtn.textContent; scanServicesBtn.textContent = 'Проверяем…';
    if (serviceList) serviceList.innerHTML = '';
    const found = await window.electronAPI.scanServices();
    scanServicesBtn.disabled = false; scanServicesBtn.textContent = o;
    scannedNames = found.map(f => f.name);
    if (!serviceList) return;
    if (!found.length) { serviceList.innerHTML = '<div class="diag-item diag-ok">✓  Конфликтующих служб не найдено</div>'; if (removeFoundBtn) removeFoundBtn.style.display = 'none'; return; }
    serviceList.innerHTML = '';
    found.forEach(f => { const d = document.createElement('div'); d.className = 'diag-item ' + (f.running ? 'diag-err' : 'diag-warn'); d.textContent = (f.running ? '✗  ' : '!  ') + f.name + (f.running ? '  [RUNNING]' : '  [STOPPED]'); serviceList.appendChild(d); });
    if (removeFoundBtn) removeFoundBtn.style.display = 'block';
});
if (removeFoundBtn) removeFoundBtn.addEventListener('click', async () => {
    if (!scannedNames.length) return;
    removeFoundBtn.disabled = true; const o = removeFoundBtn.textContent; removeFoundBtn.textContent = 'Выполняем…';
    const res = await window.electronAPI.removeServices(scannedNames);
    removeFoundBtn.disabled = false; removeFoundBtn.textContent = o;
    const failed = res.filter(r => !r.removed).map(r => r.name);
    if (failed.length) notify('Службы не изменены: ' + failed.join(', '));
    else { notify('Все найденные службы удалены.'); if (serviceList) serviceList.innerHTML = '<div class="diag-item diag-ok">✓  Службы удалены</div>'; removeFoundBtn.style.display = 'none'; scannedNames = []; }
});

// ===== КНОПКИ =====
btn.addEventListener('click', toggleState);
document.getElementById('minimizeBtn').addEventListener('click',() => window.electronAPI?.minimizeApp());
if (closeBtn) closeBtn.addEventListener('click', () => { if (window.electronAPI) window.electronAPI.closeApp(); else window.close(); });
if (adminBtn) adminBtn.addEventListener('click', openAdminPanel);
if (closeAdminBtn) closeAdminBtn.addEventListener('click', closeAdminPanel);

if (downloadZapretBtn) downloadZapretBtn.addEventListener('click', async () => {
    const span = downloadZapretBtn.querySelector('span'), o = span.textContent; span.textContent = 'Загружаем…'; downloadZapretBtn.disabled = true;
    try { const r = await window.electronAPI.downloadZapret(); if (r.success) { span.textContent = 'Готово'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 2500); notify(r.message); } else { span.textContent = 'Ошибка'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 3000); notify(r.message); } }
    catch (e) { span.textContent = 'Ошибка'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 3000); notify('Критическая ошибка: ' + e.message); }
});

// ПРОВЕРИТЬ ОБНОВЛЕНИЕ ЯДРА
if (updateBtn) updateBtn.addEventListener('click', async () => {
    const span = updateBtn.querySelector('span'), o = span.textContent; span.textContent = 'Проверяем…'; updateBtn.disabled = true;
    try { const r = await window.electronAPI.checkUpdates(); if (r.success) { if (r.hasUpdate) { notify(`🔄 ${r.message}`); span.textContent = 'Есть обновление'; } else { notify(`✅ ${r.message}`); span.textContent = 'Актуально'; } } else { notify(`❌ ${r.message}`); span.textContent = 'Ошибка'; } }
    catch (e) { notify('Ошибка сети: ' + e.message); span.textContent = 'Ошибка'; }
    setTimeout(() => { span.textContent = o; updateBtn.disabled = false; }, 2500);
});

// Обновление Godji через GitHub Releases
if (updateAppBtn) updateAppBtn.addEventListener('click', async () => {
    const span = updateAppBtn.querySelector('span'), o = span.textContent; span.textContent = 'Проверяем…'; updateAppBtn.disabled = true;
    try {
        const r = await window.electronAPI.checkAppUpdate();
        if (!r.success) { notify(`❌ ${r.message}`); span.textContent = 'Ошибка'; }
        else if (r.configured === false) { notify(r.message); span.textContent = 'Нет источника'; }
        else if (!r.hasUpdate) { notify(`✅ ${r.message}`); span.textContent = 'Актуально'; }
        else if (!r.canApply) {
            notify(`${r.message}\n\nСкачайте полный установщик из GitHub Releases.`);
            span.textContent = 'Есть обновление';
        } else {
            if (confirm(`${r.message}\n\nСкачать проверенный установщик? Godji закроется, затем завершите обновление в мастере установки.`)) {
                appUpdating = true;
                testProgressContainer.style.display = 'block';
                testProgressFill.style.width = '0%'; testProgressText.textContent = 'Загружаем…';
                const res = await window.electronAPI.applyAppUpdate();
                appUpdating = false; testProgressContainer.style.display = 'none';
                if (res.success) { notify(res.message); if (window.electronAPI) window.electronAPI.closeApp(); }
                else { notify(`❌ ${res.message}`); span.textContent = 'Ошибка'; }
            } else { span.textContent = 'Есть обновление'; }
        }
    } catch (e) { appUpdating = false; testProgressContainer.style.display = 'none'; notify('Ошибка: ' + e.message); span.textContent = 'Ошибка'; }
    setTimeout(() => { span.textContent = o; updateAppBtn.disabled = false; }, 2500);
});

// Глобальный listener прогресса скачивания нового exe оболочки
if (window.electronAPI && window.electronAPI.onAppUpdateProgress) {
    window.electronAPI.onAppUpdateProgress((pct) => {
        if (!appUpdating) return;
        if (pct < 0) { testProgressText.textContent = 'Загружаем…'; }
        else { testProgressFill.style.width = pct + '%'; testProgressText.textContent = pct + '%'; }
    });
}

let testProgressOff, testCompleteOff;
function releaseTestListeners() {testProgressOff?.();testCompleteOff?.();testProgressOff = null;testCompleteOff = null;}
if (testBtn) testBtn.addEventListener('click', async () => {
    releaseTestListeners();
    const span = testBtn.querySelector('span'), o = span.textContent; span.textContent = 'Идёт тест…'; testBtn.disabled = true;
    testProgressContainer.style.display = 'block'; testProgressFill.style.width = '0%'; testProgressText.textContent = '0%';
    testProgressOff = window.electronAPI.onTestProgress((p) => { testProgressFill.style.width = p + '%'; testProgressText.textContent = p + '%'; });
    testCompleteOff = window.electronAPI.onTestComplete((r) => { releaseTestListeners(); testProgressContainer.style.display = 'none'; if (r.success) { notify(`✅ Тестирование завершено!\n\nЛучший протокол: ${r.bestConfig}\n\nКнопка Godji теперь использует его.`); span.textContent = 'Тест завершён'; } else { notify(`❌ ${r.message}`); span.textContent = 'Ошибка'; } setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); });
    try { const r = await window.electronAPI.runTests(); if (!r.success) { releaseTestListeners(); testProgressContainer.style.display = 'none'; notify(`❌ ${r.message}`); span.textContent = 'Ошибка'; setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); } }
    catch (e) { releaseTestListeners(); testProgressContainer.style.display = 'none'; notify('Ошибка: ' + e.message); span.textContent = 'Ошибка'; setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); }
});

const statusPoller = window.createActivityPoller({poll:pollStatus,visible:() => !document.hidden && document.hasFocus(),interval:() => adminPanel.classList.contains('active') ? 15000 : 10000});
function updateActivity() {
    const paused = document.hidden || !document.hasFocus();
    document.body.classList.toggle('animations-paused',paused);
    if(paused) statusPoller.pause(); else statusPoller.wake();
}
document.addEventListener('visibilitychange',updateActivity);
window.addEventListener('focus',updateActivity);
window.addEventListener('blur',updateActivity);
window.addEventListener('pagehide',() => statusPoller.stop());
container.addEventListener('animationend',event => {if(event.animationName === 'coreIgnition') container.classList.remove('ignition');});
updateActivity();
