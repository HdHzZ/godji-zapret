const container = document.getElementById('buttonContainer');
const btn = document.getElementById('powerBtn');
const particlesContainer = document.getElementById('particles');
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

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function startParticles() {
    if (particlesContainer.childElementCount || reducedMotion.matches) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 16; i++) {
        const p = document.createElement('div'); p.className = 'particle';
        const angle = i * Math.PI * 2 / 16;
        p.style.left = (150 + Math.cos(angle) * 135) + 'px';
        p.style.top = (150 + Math.sin(angle) * 135) + 'px';
        p.style.setProperty('--tx', (Math.cos(angle) * 12) + 'px');
        p.style.setProperty('--ty', (Math.sin(angle) * 12) + 'px');
        p.style.animationDelay = (-i * 0.23) + 's';
        fragment.appendChild(p);
    }
    particlesContainer.appendChild(fragment);
}
function stopParticles() { particlesContainer.replaceChildren(); }

function applyVisualState(active) {
    isActive = active;
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', active ? 'Выключить защиту' : 'Включить защиту');
    const was = container.classList.contains('active');
    if (active === was) return;
    if (active) { container.classList.add('active'); statusText.textContent = 'ЗАЩИТА АКТИВНА'; statusText.style.color = '#00ff88'; startParticles(); }
    else { container.classList.remove('active'); statusText.textContent = 'НАЖМИТЕ ДЛЯ ВКЛЮЧЕНИЯ'; statusText.style.color = '#666'; stopParticles(); }
    isActive = active;
}
let togglePending = false;
let telegramPending = false;
function showTelegram(state) {
    const label = state.ready ? 'РАБОТАЕТ' : state.running ? 'ЗАПУСК / ОШИБКА ПОРТА' : 'ВЫКЛЮЧЕН';
    document.getElementById('telegramSummary').textContent = 'TELEGRAM · ' + label;
    document.getElementById('telegramStatus').textContent = state.error ? label + ' — ' + state.error : label;
    document.getElementById('telegramSummary').classList.toggle('ready', !!state.ready);
}
async function refreshTelegram() {
    if (!window.electronAPI?.telegramStatus || telegramPending) return;
    telegramPending = true;
    try { showTelegram(await window.electronAPI.telegramStatus()); }
    catch (e) { document.getElementById('telegramStatus').textContent = 'Ошибка проверки: ' + e.message; }
    finally { telegramPending = false; }
}
function showProtection(zapret, telegram) {
    applyVisualState(zapret.running || telegram.running);
    showTelegram(telegram);
    statusText.textContent = zapret.running && telegram.ready ? 'ЗАЩИТА АКТИВНА' : zapret.running || telegram.running ? 'РАБОТАЕТ ЧАСТИЧНО' : 'НАЖМИТЕ ДЛЯ ВКЛЮЧЕНИЯ';
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
    container.classList.remove('ignition'); void container.offsetWidth; container.classList.add('ignition');
    statusText.textContent = desired ? 'ЗАПУСК СЕРВИСОВ…' : 'ОСТАНОВКА СЕРВИСОВ…';
    try {
        const result = await window.electronAPI.toggleZapret(desired);
        if (!result.success) alert(result.message || 'Не удалось выполнить команду');
        const [zapret, telegram] = await Promise.all([window.electronAPI.checkStatus(), window.electronAPI.telegramStatus()]); showProtection(zapret, telegram);
    } catch (e) { statusText.textContent = 'ОШИБКА: ' + e.message; }
    finally { togglePending = false; btn.disabled = false; }
}
document.querySelectorAll('[data-tg]').forEach(button => button.addEventListener('click', async () => {
    const controls = document.querySelectorAll('[data-tg]'); controls.forEach(b => b.disabled = true);
    document.getElementById('telegramStatus').textContent = 'Выполнение команды…';
    try { const result = await window.electronAPI.telegramAction(button.dataset.tg); if (!result.success) alert(result.message); await pollStatus(); }
    catch (e) { alert('Telegram: ' + e.message); }
    finally { controls.forEach(b => b.disabled = false); }
}));

function openAdminPanel() { document.body.classList.add('admin-open'); adminPanel.classList.add('active'); loadSettings(); refreshTelegram(); }
function closeAdminPanel() { document.body.classList.remove('admin-open'); adminPanel.classList.remove('active'); }

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

document.querySelectorAll('#gameSeg .seg-btn').forEach(b => b.addEventListener('click', async () => { const m = b.dataset.mode; highlightSeg('gameSeg', await window.electronAPI.setGameFilter(m)); if (m !== 'disabled') alert('Перезапустите защиту (выкл/вкл Godji), чтобы Game Filter применился.'); }));
document.querySelectorAll('#ipsetSeg .seg-btn').forEach(b => b.addEventListener('click', async () => { const t = b.dataset.mode; const res = await window.electronAPI.setIpsetMode(t); highlightSeg('ipsetSeg', res); if (t === 'loaded' && res !== 'loaded') alert('Нет бэкапа списка. Нажмите «ОБНОВИТЬ СПИСОК IPSET».'); else alert('Перезапустите защиту для применения IPSet.'); }));

const updateIpsetBtn = document.getElementById('updateIpsetBtn');
if (updateIpsetBtn) updateIpsetBtn.addEventListener('click', async () => { updateIpsetBtn.disabled = true; const o = updateIpsetBtn.textContent; updateIpsetBtn.textContent = 'ОБНОВЛЕНИЕ...'; const r = await window.electronAPI.updateIpset(); updateIpsetBtn.disabled = false; updateIpsetBtn.textContent = o; if (r.success) { highlightSeg('ipsetSeg', r.status); alert(r.message); } else alert('Ошибка: ' + r.message); });

const updateHostsBtn = document.getElementById('updateHostsBtn');
if (updateHostsBtn) updateHostsBtn.addEventListener('click', async () => { updateHostsBtn.disabled = true; const o = updateHostsBtn.textContent; updateHostsBtn.textContent = 'ПРОВЕРКА...'; const r = await window.electronAPI.updateHosts(); updateHostsBtn.disabled = false; updateHostsBtn.textContent = o; alert(r.message); });

const applyStrategy = document.getElementById('applyStrategy');
if (applyStrategy) applyStrategy.addEventListener('click', async () => { const sel = document.getElementById('strategySelect'); if (!sel || !sel.value) return; await window.electronAPI.setStrategy(sel.value); const cur = document.getElementById('currentStrategy'); if (cur) cur.textContent = 'Текущая: ' + sel.value; alert('Стратегия сохранена. Перезапустите защиту для применения.'); });

const diagBtn = document.getElementById('diagBtn');
if (diagBtn) diagBtn.addEventListener('click', async () => {
    const box = document.getElementById('diagResults'), orig = diagBtn.querySelector('span').textContent;
    diagBtn.disabled = true; diagBtn.querySelector('span').textContent = 'ПРОВЕРКА...'; if (box) box.innerHTML = '';
    try { const res = await window.electronAPI.runDiagnostics(); if (box) { box.innerHTML = ''; res.forEach(r => { const d = document.createElement('div'); d.className = 'diag-item diag-' + r.status; d.textContent = (r.status === 'ok' ? '✓' : r.status === 'warn' ? '!' : '✗') + '  ' + r.text; box.appendChild(d); }); } }
    catch (e) { if (box) box.innerHTML = '<div class="diag-item diag-err">Ошибка диагностики: ' + e.message + '</div>'; }
    diagBtn.disabled = false; diagBtn.querySelector('span').textContent = orig;
});

// ===== СЛУЖБЫ СИСТЕМЫ =====
const removeServiceBtn = document.getElementById('removeServiceBtn');
if (removeServiceBtn) removeServiceBtn.addEventListener('click', async () => {
    removeServiceBtn.disabled = true; const o = removeServiceBtn.textContent; removeServiceBtn.textContent = 'УДАЛЕНИЕ...';
    const r = await window.electronAPI.removeZapretService();
    removeServiceBtn.disabled = false; removeServiceBtn.textContent = o;
    alert(r.message);
});
let scannedNames = [];
const scanServicesBtn = document.getElementById('scanServicesBtn');
const serviceList = document.getElementById('serviceList');
const removeFoundBtn = document.getElementById('removeFoundBtn');
if (scanServicesBtn) scanServicesBtn.addEventListener('click', async () => {
    scanServicesBtn.disabled = true; const o = scanServicesBtn.textContent; scanServicesBtn.textContent = 'СКАНИРОВАНИЕ...';
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
    removeFoundBtn.disabled = true; const o = removeFoundBtn.textContent; removeFoundBtn.textContent = 'УДАЛЕНИЕ...';
    const res = await window.electronAPI.removeServices(scannedNames);
    removeFoundBtn.disabled = false; removeFoundBtn.textContent = o;
    const failed = res.filter(r => !r.removed).map(r => r.name);
    if (failed.length) alert('Не удалось удалить: ' + failed.join(', '));
    else { alert('Все найденные службы удалены.'); if (serviceList) serviceList.innerHTML = '<div class="diag-item diag-ok">✓  Службы удалены</div>'; removeFoundBtn.style.display = 'none'; scannedNames = []; }
});

// ===== КНОПКИ =====
btn.addEventListener('click', toggleState);
if (closeBtn) closeBtn.addEventListener('click', () => { if (window.electronAPI) window.electronAPI.closeApp(); else window.close(); });
if (adminBtn) adminBtn.addEventListener('click', openAdminPanel);
if (closeAdminBtn) closeAdminBtn.addEventListener('click', closeAdminPanel);

if (downloadZapretBtn) downloadZapretBtn.addEventListener('click', async () => {
    const span = downloadZapretBtn.querySelector('span'), o = span.textContent; span.textContent = 'СКАЧИВАНИЕ...'; downloadZapretBtn.disabled = true;
    try { const r = await window.electronAPI.downloadZapret(); if (r.success) { span.textContent = 'ГОТОВО! ✅'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 2500); alert(r.message); } else { span.textContent = 'ОШИБКА ❌'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 3000); alert(r.message); } }
    catch (e) { span.textContent = 'ОШИБКА ❌'; setTimeout(() => { span.textContent = o; downloadZapretBtn.disabled = false; }, 3000); alert('Критическая ошибка: ' + e.message); }
});

// ПРОВЕРИТЬ ОБНОВЛЕНИЕ ЯДРА
if (updateBtn) updateBtn.addEventListener('click', async () => {
    const span = updateBtn.querySelector('span'), o = span.textContent; span.textContent = 'ПРОВЕРКА...'; updateBtn.disabled = true;
    try { const r = await window.electronAPI.checkUpdates(); if (r.success) { if (r.hasUpdate) { alert(`🔄 ${r.message}`); span.textContent = 'ЕСТЬ ОБНОВЛЕНИЕ'; } else { alert(`✅ ${r.message}`); span.textContent = 'АКТУАЛЬНО ✅'; } } else { alert(`❌ ${r.message}`); span.textContent = 'ОШИБКА ❌'; } }
    catch (e) { alert('Ошибка сети: ' + e.message); span.textContent = 'ОШИБКА ❌'; }
    setTimeout(() => { span.textContent = o; updateBtn.disabled = false; }, 2500);
});

// Обновление Godji через GitHub Releases
if (updateAppBtn) updateAppBtn.addEventListener('click', async () => {
    const span = updateAppBtn.querySelector('span'), o = span.textContent; span.textContent = 'ПРОВЕРКА...'; updateAppBtn.disabled = true;
    try {
        const r = await window.electronAPI.checkAppUpdate();
        if (!r.success) { alert(`❌ ${r.message}`); span.textContent = 'ОШИБКА ❌'; }
        else if (r.configured === false) { alert(r.message); span.textContent = 'ИСТОЧНИК НЕ НАСТРОЕН'; }
        else if (!r.hasUpdate) { alert(`✅ ${r.message}`); span.textContent = 'АКТУАЛЬНО ✅'; }
        else if (!r.canApply) {
            alert(`${r.message}\n\nСкачайте полный установщик из GitHub Releases.`);
            span.textContent = 'ЕСТЬ ОБНОВЛЕНИЕ';
        } else {
            if (confirm(`${r.message}\n\nСкачать проверенный установщик? Godji закроется, затем завершите обновление в мастере установки.`)) {
                appUpdating = true;
                testProgressContainer.style.display = 'block';
                testProgressFill.style.width = '0%'; testProgressText.textContent = 'СКАЧИВАНИЕ...';
                const res = await window.electronAPI.applyAppUpdate();
                appUpdating = false; testProgressContainer.style.display = 'none';
                if (res.success) { alert(res.message); if (window.electronAPI) window.electronAPI.closeApp(); }
                else { alert(`❌ ${res.message}`); span.textContent = 'ОШИБКА ❌'; }
            } else { span.textContent = 'ЕСТЬ ОБНОВЛЕНИЕ'; }
        }
    } catch (e) { appUpdating = false; testProgressContainer.style.display = 'none'; alert('Ошибка: ' + e.message); span.textContent = 'ОШИБКА ❌'; }
    setTimeout(() => { span.textContent = o; updateAppBtn.disabled = false; }, 2500);
});

// Глобальный listener прогресса скачивания нового exe оболочки
if (window.electronAPI && window.electronAPI.onAppUpdateProgress) {
    window.electronAPI.onAppUpdateProgress((pct) => {
        if (!appUpdating) return;
        if (pct < 0) { testProgressText.textContent = 'СКАЧИВАНИЕ...'; }
        else { testProgressFill.style.width = pct + '%'; testProgressText.textContent = pct + '%'; }
    });
}

if (testBtn) testBtn.addEventListener('click', async () => {
    const span = testBtn.querySelector('span'), o = span.textContent; span.textContent = 'ТЕСТИРОВАНИЕ...'; testBtn.disabled = true;
    testProgressContainer.style.display = 'block'; testProgressFill.style.width = '0%'; testProgressText.textContent = '0%';
    window.electronAPI.onTestProgress((p) => { testProgressFill.style.width = p + '%'; testProgressText.textContent = p + '%'; });
    window.electronAPI.onTestComplete((r) => { testProgressContainer.style.display = 'none'; if (r.success) { alert(`✅ Тестирование завершено!\n\nЛучший протокол: ${r.bestConfig}\n\nКнопка Godji теперь использует его.`); span.textContent = 'ТЕСТ ЗАВЕРШЕН ✅'; } else { alert(`❌ ${r.message}`); span.textContent = 'ОШИБКА ❌'; } setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); });
    try { const r = await window.electronAPI.runTests(); if (!r.success) { testProgressContainer.style.display = 'none'; alert(`❌ ${r.message}`); span.textContent = 'ОШИБКА ❌'; setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); } }
    catch (e) { testProgressContainer.style.display = 'none'; alert('Ошибка: ' + e.message); span.textContent = 'ОШИБКА ❌'; setTimeout(() => { span.textContent = o; testBtn.disabled = false; }, 3000); }
});

setTimeout(pollStatus, 600);
setInterval(pollStatus, 5000);
document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('animations-paused', document.hidden);
    if (!document.hidden) pollStatus();
});
container.addEventListener('animationend', (event) => {
    if (event.animationName === 'ignitionWave') container.classList.remove('ignition');
});
console.log('Godji Zapret UI загружен');
console.log('Electron API доступен:', !!window.electronAPI);