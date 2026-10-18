const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPOSITORY = 'https://github.com/HdHzZ/godji-zapret';

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw Error('Релиз содержит некорректную стабильную версию');
  return match.slice(1).map(Number);
}
function isNewer(remote, local) {
  const a = versionParts(remote), b = versionParts(local);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function releaseInfo(tag, links) {
  versionParts(tag);
  const version = tag.replace(/^v/, '');
  const name = `GodjiZapret-${version}-Setup.exe`;
  const prefix = `${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/`;
  const installerUrl = links.find(url => url === prefix + name);
  const checksumUrl = links.find(url => url === prefix + 'SHA256SUMS.txt');
  if (!installerUrl || !checksumUrl) throw Error('В релизе отсутствует установщик или SHA256SUMS.txt');
  return {version, name, installerUrl, checksumUrl};
}
function createAppUpdater({request, download, localVersion, directory, openInstaller}) {
  let busy = false;
  async function latest() {
    try {
      const response = await request('https://api.github.com/repos/HdHzZ/godji-zapret/releases/latest');
      if (response.status !== 200) throw Error(`GitHub API: HTTP ${response.status}`);
      const json = JSON.parse(response.text);
      if (json.draft || json.prerelease) throw Error('Релиз не является стабильным');
      return releaseInfo(json.tag_name, (json.assets || []).map(a => a.browser_download_url));
    } catch (apiError) {
      try {
        const response = await request(REPOSITORY + '/releases/latest');
        if (response.status !== 200 || !response.url.startsWith(REPOSITORY + '/releases/tag/')) throw Error('Стабильный релиз не найден');
        const tag = decodeURIComponent(new URL(response.url).pathname.split('/').pop());
        const assets = await request(REPOSITORY + '/releases/expanded_assets/' + encodeURIComponent(tag));
        if (assets.status !== 200) throw Error('Не удалось прочитать файлы релиза');
        const links = [...assets.text.matchAll(/href="([^"\s]+)"/g)].map(m => new URL(m[1].replace(/&amp;/g, '&'), REPOSITORY).href);
        return releaseInfo(tag, links);
      } catch (error) {
        throw Error('Не удалось проверить обновления Godji на GitHub: ' + error.message + '. Повторите позже.');
      }
    }
  }
  async function check() {
    try {
      const release = await latest();
      const hasUpdate = isNewer(release.version, localVersion);
      return {success:true, configured:true, hasUpdate, canApply:true, localVersion, remoteVersion:release.version,
        message:hasUpdate ? `Доступна версия Godji ${release.version} (у вас ${localVersion}).` : `Godji ${localVersion}: более новых версий нет.`};
    } catch (error) { return {success:false,message:error.message}; }
  }
  async function apply(onProgress) {
    if (busy) return {success:false,message:'Обновление уже загружается.'};
    busy = true;
    let partial;
    try {
      const release = await latest();
      if (!isNewer(release.version, localVersion)) return {success:false,message:'Более новой версии нет.'};
      const checksums = await request(release.checksumUrl);
      if (checksums.status !== 200) throw Error('Не удалось получить контрольную сумму установщика');
      const entry = checksums.text.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())).find(match => match && match[2] === release.name);
      if (!entry) throw Error('Контрольная сумма установщика отсутствует');
      fs.mkdirSync(directory, {recursive:true});
      partial = path.join(directory, release.name + '.part');
      await download(release.installerUrl, partial, onProgress);
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(partial)) hash.update(chunk);
      if (hash.digest('hex') !== entry[1].toLowerCase()) throw Error('Контрольная сумма не совпала. Установщик не запущен.');
      const installer = path.join(directory, release.name);
      fs.renameSync(partial, installer); partial = null;
      const error = await openInstaller(installer);
      if (error) throw Error(error);
      return {success:true,message:'Установщик новой версии запущен. Godji сейчас закроется. Завершите обновление в мастере установки.'};
    } catch (error) { return {success:false,message:error.message}; }
    finally {busy = false; if (partial) {try {fs.unlinkSync(partial);} catch {}}}
  }
  return {check, apply};
}
module.exports = {createAppUpdater, isNewer, REPOSITORY};
