/**
 * The landing page.
 *
 * Two jobs: put the right download under the visitor's cursor, and keep the version stamps
 * honest. Both come from the manifest, so a button can never name one file and link to
 * another: the label is written from the asset that was found, not from what was guessed
 * about the visitor's system.
 *
 * A link that names a system wins over the guess (`/?os=macos&arch=x64`), which is what makes
 * a download link something you can send to somebody with a specific machine. On a phone, and
 * on a system with nothing published, the button becomes a way to the list rather than a guess
 * that downloads the wrong 90 MB.
 */
(async function () {
  const cfg = window.HALO_CONFIG || {};
  const { $, visitor, wanted, pickFor, archShort, OS_LABEL, bytes, assetUrl, renderDownloads } = window.HaloUI;

  const version = cfg.version || '';
  for (const id of ['#brandVersion', '#footVersion']) {
    const el = $(id);
    if (el && version) el.textContent = version;
  }

  const who = wanted() || visitor();
  const hero = $('#heroDownload');
  const heroOs = $('#heroOs');
  const meta = $('#heroMeta');
  const data = await renderDownloads('#dlBox');
  const mine = pickFor((data && data.assets) || [], who);

  if (!hero) return;
  if (!mine) {
    // Nothing to hand them: point at the list, and say why in the small print. This is the
    // phone case, the unreleased-platform case, and the no-manifest case, in one branch.
    hero.href = '/download';
    hero.removeAttribute('download');
    if (heroOs) heroOs.textContent = 'your system';
    hero.textContent = 'See the downloads';
    if (meta) {
      meta.textContent = who.mobile
        ? 'Halo installs on a desktop. Open this page on the machine you want it on, or send yourself the link.'
        : 'Free and open source. Your model key stays on your machine.';
    }
    return;
  }

  const osName = OS_LABEL[mine.platform] || mine.platform;
  if (heroOs) heroOs.textContent = osName + ' (' + archShort(mine.arch) + ')';
  const url = assetUrl(mine);
  if (url) {
    hero.href = url;
    hero.setAttribute('download', '');
  }
  // textContent, so a file name goes in as it is: escaping here would print `&amp;` at
  // somebody reading a perfectly ordinary name.
  if (meta && mine.size) {
    meta.textContent = 'Free and open source. ' + (mine.file || '') + ' · ' + bytes(mine.size)
      + '. Your model key stays on your machine.';
  }
})();
