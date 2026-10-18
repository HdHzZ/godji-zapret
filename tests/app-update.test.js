const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {createAppUpdater, isNewer, REPOSITORY} = require('../src/app-update');
const name = 'GodjiZapret-1.2.2-Setup.exe';
const prefix = REPOSITORY + '/releases/download/v1.2.2/';
const payload = Buffer.from('installer fixture');
const checksum = crypto.createHash('sha256').update(payload).digest('hex');
const metadata = JSON.stringify({tag_name:'v1.2.2',assets:[{browser_download_url:prefix+name},{browser_download_url:prefix+'SHA256SUMS.txt'}]});

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godji-update-test-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const opened = [];
  const updater = createAppUpdater({
    directory,localVersion:'1.2.1',
    request:async url => ({status:200,text:url.endsWith('SHA256SUMS.txt') ? `${checksum}  ${name}\n` : metadata}),
    download:async (url, dest, progress) => {fs.writeFileSync(dest,payload);progress?.(100);},
    openInstaller:async file => {opened.push(file);return '';},
    ...overrides
  });
  return {updater,directory,opened};
}
test('stable versions compare numerically and reject invalid versions', () => {
  assert.equal(isNewer('v1.10.0','1.9.9'),true);
  assert.equal(isNewer('1.2.2','1.2.2'),false);
  assert.equal(isNewer('1.2.1','1.2.2'),false);
  assert.throws(() => isNewer('1.2.3-beta','1.2.2'));
});
test('new release is offered and equal/older versions are not', async t => {
  assert.equal((await setup(t).updater.check()).hasUpdate,true);
  assert.equal((await setup(t,{localVersion:'1.2.2'}).updater.check()).hasUpdate,false);
  assert.equal((await setup(t,{localVersion:'1.3.0'}).updater.check()).hasUpdate,false);
});
test('rate-limited API falls back to release page', async t => {
  const {updater} = setup(t,{request:async url => {
    if (url.includes('api.github')) return {status:403,text:''};
    if (url.endsWith('/latest')) return {status:200,url:REPOSITORY+'/releases/tag/v1.2.2',text:''};
    return {status:200,text:`<a href="${prefix+name}">Setup</a><a href="${prefix}SHA256SUMS.txt">SHA</a>`};
  }});
  const result = await updater.check(); assert.equal(result.success,true); assert.equal(result.remoteVersion,'1.2.2');
});
test('offline check reports failure and never claims the app is current', async t => {
  const {updater} = setup(t,{request:async () => {throw Error('offline');}});
  const result = await updater.check();assert.equal(result.success,false);assert.match(result.message,/GitHub/);
});
test('verified installer is opened only after its SHA-256 matches', async t => {
  const {updater,opened} = setup(t); const result = await updater.apply();
  assert.equal(result.success,true,result.message);assert.equal(opened.length,1);assert.deepEqual(fs.readFileSync(opened[0]),payload);
});
test('corrupt installer is removed and never launched', async t => {
  const {updater,directory,opened} = setup(t,{download:async (url,dest) => fs.writeFileSync(dest,'corrupt')});
  assert.equal((await updater.apply()).success,false);assert.equal(opened.length,0);assert.deepEqual(fs.readdirSync(directory),[]);
});
test('missing checksum and download failures cannot launch the installer', async t => {
  const missing = setup(t,{request:async url => ({status:200,text:url.endsWith('SHA256SUMS.txt') ? '' : metadata})});
  assert.equal((await missing.updater.apply()).success,false);assert.equal(missing.opened.length,0);
  const failed = setup(t,{download:async (url,dest) => {fs.writeFileSync(dest,'partial');throw Error('connection reset');}});
  assert.equal((await failed.updater.apply()).success,false);assert.equal(failed.opened.length,0);assert.deepEqual(fs.readdirSync(failed.directory),[]);
});
test('no downgrade is downloaded', async t => {
  const {updater,opened} = setup(t,{localVersion:'1.3.0',download:async () => assert.fail('unexpected download')});
  assert.equal((await updater.apply()).success,false);assert.equal(opened.length,0);
});
test('installer URLs from another repository are rejected', async t => {
  const {updater} = setup(t,{request:async () => ({status:200,text:metadata.replaceAll('HdHzZ/godji-zapret','other/repo')})});
  assert.equal((await updater.check()).success,false);
});
test('parallel update requests are serialized', async t => {
  let unblock; const gate = new Promise(resolve => {unblock = resolve;});
  const {updater} = setup(t,{download:async (url,dest) => {await gate;fs.writeFileSync(dest,payload);}});
  const first = updater.apply();assert.equal((await updater.apply()).success,false);unblock();const completed = await first;assert.equal(completed.success,true,completed.message);
});

