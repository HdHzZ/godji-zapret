const repo = 'https://github.com/Flowseal/zapret-discord-youtube';
function createReleaseClient(request) {
  async function latest() {
    let apiError;
    try {
      const response = await request('https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest');
      if (response.status !== 200) throw Error(`GitHub API: HTTP ${response.status}`);
      const json = JSON.parse(response.text);
      const asset = (json.assets || []).find(a => /^zapret-discord-youtube.*\.zip$/i.test(a.name));
      if (!json.tag_name || !asset || !asset.browser_download_url?.startsWith(repo + '/releases/download/')) throw Error('GitHub API не вернул архив ядра');
      return {tag:json.tag_name,url:asset.browser_download_url,source:'api'};
    } catch (error) { apiError = error.message; }
    try {
      const release = await request(repo + '/releases/latest');
      if (release.status !== 200 || !release.url.startsWith(repo + '/releases/tag/')) throw Error('Страница последнего релиза недоступна');
      const tag = decodeURIComponent(new URL(release.url).pathname.split('/').pop());
      const assets = await request(repo + '/releases/expanded_assets/' + encodeURIComponent(tag));
      if (assets.status !== 200) throw Error(`Страница архивов: HTTP ${assets.status}`);
      const links = [...assets.text.matchAll(/href="([^"\s]+)"/g)].map(m => m[1].replace(/&amp;/g,'&'));
      const archive = links.find(link => link.startsWith('/Flowseal/zapret-discord-youtube/releases/download/') && /\/zapret-discord-youtube[^/]*\.zip$/i.test(link));
      if (!archive) throw Error('Архив ядра отсутствует в релизе');
      return {tag,url:new URL(archive,repo).href,source:'release-page'};
    } catch (error) { throw Error(`${apiError}; ${error.message}. Установленное ядро сохранено. Повторите проверку позже.`); }
  }
  return {latest};
}
module.exports = {createReleaseClient};
