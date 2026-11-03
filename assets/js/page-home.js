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
// Local, illustrative examples only. Selecting one changes the preview, never contacts an AI
// provider and never runs a task on the visitor's machine. Text is written without innerHTML.
(function () {
  const examples = {
    files: {
      request: 'Tidy up my Downloads folder. Keep the important stuff.',
      reply: 'A little order, without losing a thing.',
      steps: ['Look through the folder', 'Sort documents, images and installers', 'Keep the originals. Check the result.'],
      result: 'Organized. Nothing deleted.',
    },
    day: {
      request: 'Help me plan my day. Leave some room to breathe.',
      reply: 'Let’s make a little space for what matters.',
      steps: ['Recall your priorities', 'Draft a manageable to-do list', 'Add the reminders you asked for'],
      result: 'A plan, with breathing room.',
    },
    research: {
      request: 'Research the options and save a short summary.',
      reply: 'The useful bits, without all the tabs.',
      steps: ['Search for relevant sources', 'Read and compare the findings', 'Save a summary with source links'],
      result: 'Research saved. Sources included.',
    },
  };
  const buttons = Array.from(document.querySelectorAll('[data-demo]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const example = examples[button.dataset.demo];
      if (!example) return;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      const values = { demoRequest: example.request, demoReply: example.reply, demoResult: example.result };
      example.steps.forEach((step, index) => { values['demoStep' + (index + 1)] = step; });
      for (const [id, value] of Object.entries(values)) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      }
    });
  }
})();

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
  const missing = (data && data.missing) || new Set();
  const mine = pickFor((data && data.assets) || [], who);
  // Listed, but this deploy is not holding it. The hero button is the most tempting one on the
  // site and the easiest to make a liar, so it becomes a way to the page that explains it.
  const unreachable = Boolean(mine) && missing.has(mine.url);

  if (!hero) return;
  if (!mine || unreachable) {
    // Nothing to hand them: point at the list, and say why in the small print. This is the
    // phone case, the unreleased-platform case, the not-on-this-server case, and the
    // no-manifest case, in one branch.
    hero.href = '/download';
    hero.removeAttribute('download');
    if (heroOs) heroOs.textContent = 'your system';
    hero.textContent = 'See the downloads';
    if (meta) {
      meta.textContent = unreachable
        ? 'The build for this machine is listed, but this server does not have it yet. The download page says what is there.'
        : who.mobile
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
