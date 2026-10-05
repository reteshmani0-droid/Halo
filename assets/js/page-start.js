/**
 * The get started page.
 *
 * One job that is not in the markup: filling in the two values a machine needs to report to
 * this site, so that connecting a PC is a copy and a paste rather than opening the source of a
 * page to find `config.js`. The anon key is meant to be public (every visitor already downloads
 * it with this page) and what it may read is decided by row level security in the database, so
 * printing it here gives nothing away.
 */
(async function () {
  const cfg = window.HALO_CONFIG || {};
  const { $, toast, renderOneClick } = window.HaloUI;

  await renderOneClick('#one', { alt: '/download' });

  // The fleet switch is read here as well as inside the button, because a page about installing
  // something should say up front that the thing is switched off — before the visitor has
  // downloaded it, installed it and worked out why it will not answer.
  try {
    const fleet = await window.HaloUI.fleetStatus();
    const note0 = $('#fleetNote');
    if (fleet.lockdown && note0) {
      note0.hidden = false;
      note0.textContent = 'Halo is switched off at the moment. '
        + (fleet.message || 'The operator has not said why.')
        + ' Installations still work as files; they stand down until it is switched back on.';
    }
  } catch (_) { /* a page about installing things should not fail over a status read */ }

  const sup = cfg.supabase || {};
  const card = $('#connect');
  const note = $('#connectNote');
  if (!card) return;

  if (!sup.url || !sup.anonKey) {
    // No project behind this site: the honest answer is the setup instructions, not two empty
    // boxes that look like a bug.
    note.hidden = false;
    note.className = 'note bad';
    note.innerHTML = 'This site has no Supabase project configured yet, so there is nothing for a '
      + 'machine to connect to. Whoever runs the deploy adds the project URL and anon key to '
      + '<code>assets/js/config.js</code> (see <code>web/README.md</code>), and this card fills itself in.';
    return;
  }

  card.hidden = false;
  $('#projUrl').textContent = sup.url;
  $('#anonKey').textContent = sup.anonKey;

  /**
   * Copy, with a way out.
   *
   * `navigator.clipboard` needs a secure context, and this page is also served over plain http
   * on a LAN during setup, where it refuses. Rather than a button that does nothing there, the
   * fallback selects the text so the copy is one keystroke away.
   */
  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
      return;
    } catch (_) { /* not a secure context, or the browser said no */ }
    const code = document.querySelector(btn.dataset.copy || '');
    if (code && window.getSelection) {
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Selected. Press Ctrl+C.');
      return;
    }
    toast('Select the value and copy it.');
  }

  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => {
      const el = document.querySelector(btn.dataset.copy || '');
      if (el) copy(String(el.textContent || '').trim(), btn);
    });
  }
})();
