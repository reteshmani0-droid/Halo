/**
 * The download page.
 *
 * Two things live here: the one click button at the top, which is the build for whoever is
 * reading it, and the complete table of every published file with its size and hash, which is
 * what somebody checks a download against and what a search engine can read.
 *
 * A manifest that has not been generated yet says so, rather than drawing a page of dead
 * links. That is the failure this page was built to avoid: a finished looking page that hands
 * people a 404.
 */
(async function () {
  const { $, esc, renderOneClick, renderDownloads, assetUrl, bytes, wanted, visitor } = window.HaloUI;
  const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

  // Both reads are of the same file, so they are done in sequence rather than twice over: the
  // second call gets the response the first one warmed.
  await renderOneClick('#one', { alt: '#all' });

  const data = await renderDownloads('#dlBox', { who: wanted() || visitor() });
  const tbody = $('#dlTable tbody');
  const assets = (data && data.assets) || [];
  // Filled in by renderDownloads: a build this deploy is not holding. Nothing on the page
  // links one, including the Linux one-liner below and the table of hashes at the bottom.
  const missing = (data && data.missing) || new Set();

  /*
   * The Linux one-liner.
   *
   * Drawn here rather than written into the HTML for two reasons: the address it needs is the
   * deploy's own, which only the browser knows, and it is shown only when a Linux build is
   * really published — a command that fetches nothing is worse than no command. The fleet
   * switch is respected as well, because closing the downloads has to close this too.
   */
  const install = $('#linuxInstall');
  if (install) {
    const fleet = await window.HaloUI.fleetStatus();
    if (fleet.open && assets.some((a) => a.platform === 'linux' && !missing.has(a.url))) {
      $('#linuxCmd').textContent = `curl -fsSL ${location.origin}/install.sh | sh`;
      install.classList.remove('hidden');
    }
  }
  if (!assets.length) {
    const setup = $('#dlSetup');
    setup.classList.remove('hidden');
    setup.querySelector('.note').classList.add('bad');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="dim">Nothing published yet.</td></tr>';
    return;
  }
  tbody.innerHTML = assets.map((a) => {
    const url = assetUrl(a);
    const live = url && !missing.has(a.url);
    return `<tr>
      <td>${live ? `<a href="${esc(url)}">${esc(a.file || a.url || 'download')}</a>` : `<span class="dim">${esc(a.file || 'not built')}${missing.has(a.url) ? ' — not on this server' : ''}</span>`}</td>
      <td>${esc(OS_LABEL[a.platform] || a.platform || '')}</td>
      <td>${esc(a.arch || '')}${a.kind ? ` <span class="dim">${esc(a.kind)}</span>` : ''}</td>
      <td class="nowrap">${a.size ? esc(bytes(a.size)) : '<span class="dim">not built</span>'}</td>
      <td><code class="small">${esc(a.sha256 || 'not built')}</code></td>
    </tr>`;
  }).join('');
})();
