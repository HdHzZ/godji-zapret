const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const {createOwnedProcesses} = require('../src/owned-processes');
const {createActivityPoller} = require('../src/renderer/activity-poller');
const {scopeProtocolTest} = require('../src/protocol-test');

test('process discovery is shared and cached without spawning commands on every poll',async () => {
  let count = 0, now = 0;
  const processes = createOwnedProcesses({executables:[path.resolve('test-core/bin/winws1.exe')],run:async () => {count++;return '123\n123\n';},alive:() => true,now:() => now});
  const results = await Promise.all([processes.list(),processes.list(),processes.list()]);
  assert.deepEqual(results[0],[123]);assert.equal(count,1);
  await processes.list();assert.equal(count,1);
  now = 30001;await processes.list();assert.equal(count,2);
});
test('stopping revalidates paths and kills only owned PIDs, never by executable name',async () => {
  const calls = [];
  const executable = path.resolve("test core/O'Name/bin/winws1.exe");
  const processes = createOwnedProcesses({executables:[executable],alive:() => true,run:async (file,args) => {calls.push({file,args});return file === 'powershell.exe' ? '456' : '';}});
  await processes.stop();
  const script = calls[0].args.at(-1);
  assert(script.includes('ExecutablePath'));assert(script.includes("O''Name"));
  assert.deepEqual(calls[1],{file:'taskkill.exe',args:['/PID','456','/T','/F']});
  assert(!calls.some(call => call.args.includes('/IM')));
});
test('ended processes disappear from the cached status without a new system query',async () => {
  let alive = true, calls = 0;
  const processes = createOwnedProcesses({executables:[path.resolve('fake.exe')],run:async () => {calls++;return '123';},alive:() => alive});
  assert.deepEqual(await processes.list(),[123]);alive = false;
  assert.deepEqual(await processes.list(),[]);assert.equal(calls,1);
});
test('a failed discovery cannot be misinterpreted as permission to stop another process',async () => {
  let kills = 0;
  const processes = createOwnedProcesses({executables:[path.resolve('fake.exe')],run:async file => {if(file === 'taskkill.exe') kills++;throw Error('denied');}});
  await assert.rejects(processes.stop(),/denied/);assert.equal(kills,0);
});
test('visibility poller schedules nothing while hidden and never overlaps requests',async () => {
  let visible = false, polls = 0, timer = null, release;
  const poller = createActivityPoller({visible:() => visible,poll:() => {polls++;return new Promise(resolve => {release = resolve;});},setTimer:fn => {timer = fn;return 1;},clearTimer:() => {timer = null;}});
  await poller.wake();assert.equal(polls,0);assert.equal(timer,null);
  visible = true;const first = poller.wake();const second = poller.wake();await Promise.resolve();assert.equal(polls,1);
  visible = false;poller.pause();release();await Promise.all([first,second]);assert.equal(timer,null);
  visible = true;const third = poller.wake();await Promise.resolve();release();await third;assert(timer);
  poller.stop();assert.equal(timer,null);
});
test('bat launcher waits for its child without monitoring loops or global TCP changes',() => {
  const source = fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const begin = source.indexOf('function buildHiddenBat('), end = source.indexOf('function runHiddenBat(',begin);
  let result;
  const context = {path,zapretCoreDir:path.resolve('fixtures/core'),runDir:path.resolve('fixtures/run'),fs:{readFileSync:() => '@echo off\ncall service.bat status_zapret\ncall service.bat check_updates\ncall service.bat load_game_filter\nstart "core" /min "%BIN%winws1.exe" --test',writeFileSync:(file,text) => {result = text;}}};
  vm.runInNewContext(source.slice(begin,end),context);context.buildHiddenBat('general.bat');
  assert(result.includes('start /b /wait'));assert(result.includes('load_game_filter'));
  assert(!/tasklist|status_zapret|check_updates|tcp_enable|godjiwait/.test(result));
});
test('diagnostics do not change system networking and synchronous shell commands are absent',() => {
  const source = fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  assert(!source.includes('execSync'));assert(!source.includes('netsh interface tcp set'));assert(!source.includes('/IM winws'));
  assert(source.includes('transparent: false'));assert(source.includes('requestSingleInstanceLock'));
});
test('protocol test termination and snapshots are confined to this copy of the engine',() => {
  const source = '$rootDir = Split-Path $PSScriptRoot\n$targetDir = $rootDir\nGet-Process -Name "winws" -ErrorAction SilentlyContinue | Stop-Process -Force\nGet-CimInstance Win32_Process -Filter "Name=\'winws.exe\'"';
  const scoped = scopeProtocolTest(source,{coreDir:path.resolve('my core'),strategiesDir:path.resolve('test configs')});
  assert(scoped.includes('$_.Path -eq'));assert(scoped.includes('$_.ExecutablePath -eq'));assert(!scoped.includes('Get-Process -Name "winws"'));
  assert.throws(() => scopeProtocolTest('unknown format',{coreDir:'x',strategiesDir:'y'}));
});
