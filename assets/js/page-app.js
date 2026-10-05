/**
 * The dashboard.
 *
 * Reads only. The one action on the page is cutting a machine's access off, which goes
 * through the database function so the audit row is written in the same transaction — the
 * site never updates `revoked_at` directly, and the policy in schema.sql would refuse it if
 * it tried.
 */
(async function () {
  const { $, esc, toast, ago, when, setupNotice, requireSession, signOutButton } = window.HaloUI;

  setupNotice('#setup');
  signOutButton('#navSignOut');
  signOutButton('#signOut2');

  const session = await requireSession();
  if (!session && window.HaloCloud.configured) return;   // the guard already redirected
  if (!session) {
    // No project configured: the page says so instead of pretending to load forever.
    $('#subtitle').textContent = 'Waiting for a Supabase project.';
    for (const id of ['#machineList', '#machineList2', '#msgLog']) $(id).innerHTML = '<div class="empty">Connect a database first.</div>';
    $('#auditBody').innerHTML = '<tr><td colspan="4" class="dim">No database connected.</td></tr>';
    return;
  }

  let profile = null;
  let devices = [];
  let messages = [];

  const online = (iso) => iso && Date.now() - new Date(iso).getTime() < 10 * 60 * 1000;

  function machineRow(d) {
    const cut = Boolean(d.revoked_at);
    const dot = cut ? 'bad' : online(d.last_seen_at) ? 'on' : 'off';
    const pill = cut
      ? '<span class="pill bad">access cut</span>'
      : online(d.last_seen_at) ? '<span class="pill ok">recently seen</span>' : '<span class="pill">idle</span>';
    const bits = [
      d.platform ? esc(d.platform) : '',
      d.arch ? esc(d.arch) : '',
      d.app_version ? 'v' + esc(d.app_version) : '',
      d.model ? esc(d.model) : '',
    ].filter(Boolean).join(' · ');
    return `<div class="item">
      <span class="dot ${dot}"></span>
      <div class="grow">
        <div class="name">${esc(d.name)} ${pill}</div>
        <div class="desc">${bits || 'no details reported yet'}</div>
        <div class="desc">last seen ${esc(ago(d.last_seen_at))}${d.pairing_code ? ` · pairing code shown there: <code>${esc(d.pairing_code)}</code>` : ''}</div>
      </div>
      ${cut
        ? `<button class="btn small" data-restore="${esc(d.id)}">Let it back in</button>`
        : `<button class="btn small danger" data-cut="${esc(d.id)}">Cut access</button>`}
    </div>`;
  }

  function paintMachines() {
    const html = devices.length
      ? devices.map(machineRow).join('')
      : '<div class="empty">No machine has signed in yet. Connect one from the app\'s Settings → Account.</div>';
    $('#machineList').innerHTML = html;
    $('#machineList2').innerHTML = html;

    const sel = $('#msgDevice');
    const chosen = sel.value;
    sel.innerHTML = '<option value="">All machines</option>' + devices
      .map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    sel.value = chosen;

    $('#statMachines').textContent = String(devices.length);
    $('#statOnline').textContent = String(devices.filter((d) => online(d.last_seen_at)).length);
    $('#statCut').textContent = String(devices.filter((d) => d.revoked_at).length);
    $('#statMessages').textContent = String(messages.length);

    for (const btn of document.querySelectorAll('[data-cut]')) {
      btn.addEventListener('click', () => cutOff(btn.dataset.cut, btn));
    }
    for (const btn of document.querySelectorAll('[data-restore]')) {
      btn.addEventListener('click', () => restore(btn.dataset.restore, btn));
    }
  }

  /**
   * Cut a machine off.
   *
   * Two presses rather than a browser confirm(): the same guard against a stray click, in the
   * same shape the desktop app uses for its own destructive buttons. The button says what the
   * next press will do, which is what makes it safe to have no modal.
   */
  async function cutOff(id, btn) {
    const dev = devices.find((d) => d.id === id);
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      const was = btn.textContent;
      btn.textContent = 'Press again to cut it off';
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = was; } }, 5000);
      return;
    }
    delete btn.dataset.armed;
    btn.disabled = true;
    const r = await window.HaloCloud.revoke(id);
    btn.disabled = false;
    if (!r.ok) { toast(r.error || 'Could not cut that off.'); return; }
    toast(`${dev ? dev.name : 'That machine'} will stop accepting remote access on its next check.`);
    await load();
  }

  async function restore(id, btn) {
    btn.disabled = true;
    const r = await window.HaloCloud.restore(id);
    btn.disabled = false;
    if (!r.ok) { toast(r.error || 'Could not restore that.'); return; }
    toast('Allowed again. The machine picks that up on its next check.');
    await load();
  }

  function paintMessages() {
    const filter = $('#msgDevice').value;
    const list = filter ? messages.filter((m) => m.device_id === filter) : messages;
    if (!list.length) {
      $('#msgLog').innerHTML = '<div class="empty">Nothing reported yet. Messages appear here once a machine signs in with its account on.</div>';
      return;
    }
    const byId = new Map(devices.map((d) => [d.id, d.name]));
    $('#msgLog').innerHTML = list.map((m) => `<div class="m ${m.role}">
      <div class="who">${m.role === 'user' ? 'You' : 'Halo'} · ${esc(byId.get(m.device_id) || 'unknown machine')} · ${esc(when(m.created_at))}${m.source ? ' · ' + esc(m.source) : ''}</div>
      <div class="body">${esc(m.text)}</div>
    </div>`).join('');
  }

  async function paintAudit() {
    const rows = await window.HaloCloud.audit(40);
    const body = $('#auditBody');
    if (rows && rows.error) { body.innerHTML = `<tr><td colspan="4" class="dim">${esc(rows.error)}</td></tr>`; return; }
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="dim">Nothing has been done to your machines from here.</td></tr>'; return; }
    body.innerHTML = rows.map((r) => {
      const dev = devices.find((d) => d.id === r.target);
      // The actor is shown as "you" or "an admin" rather than as a uuid: the audit log is
      // read by the person it is about, and a forty character hex string answers nothing.
      const who = r.action === 'device.revoked' && r.detail && r.detail.as_admin ? 'an admin'
        : (profile && r.actor === profile.id) ? 'you'
          : 'the account owner';
      return `<tr>
        <td class="nowrap">${esc(when(r.created_at))}</td>
        <td>${esc(String(r.action || '').replace('.', ' '))}</td>
        <td>${esc(dev ? dev.name : (r.detail && r.detail.name) || r.target || '—')}</td>
        <td>${esc(who)}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    profile = await window.HaloCloud.profile();
    if (profile && profile.error) {
      $('#subtitle').textContent = profile.error;
      return;
    }
    const [devs, msgs] = await Promise.all([window.HaloCloud.devices(), window.HaloCloud.messages(120)]);
    // A query that failed comes back as `{ error }`. Treating that as an empty list would
    // show "no machine has signed in yet" about a list the reader is not allowed to see,
    // which is the one message that would send them looking in the wrong place.
    const broke = [devs, msgs].find((r) => r && r.error);
    devices = Array.isArray(devs) ? devs : [];
    messages = Array.isArray(msgs) ? msgs.slice().reverse() : [];

    const name = (profile && profile.display_name) || (session.user && session.user.email) || 'there';
    $('#greeting').textContent = 'Hello, ' + name;
    const admin = profile && profile.role === 'admin';
    $('#subtitle').textContent = broke ? broke.error
      : admin ? 'You are an admin on this project, so the admin panel can see every account.'
        : 'Signed in. Machines appear here once the app reports in.';
    if (admin) $('#navAdmin').classList.remove('hidden');
    $('#acctName').value = (profile && profile.display_name) || '';
    $('#acctEmail').textContent = (profile && profile.email) || (session.user && session.user.email) || '—';
    $('#acctRole').textContent = (profile && profile.role) || 'member';
    $('#acctCreated').textContent = profile && profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—';
    paintMachines();
    paintMessages();
    await paintAudit();
  }

  /** The rail switches sections; the sections are all in the page, so this is a class swap. */
  function show(view) {
    for (const a of document.querySelectorAll('nav.rail a[data-view]')) {
      a.classList.toggle('active', a.dataset.view === view);
    }
    for (const name of ['overview', 'machines', 'messages', 'account']) {
      $('#view-' + name).classList.toggle('hidden', name !== view);
    }
  }
  for (const a of document.querySelectorAll('nav.rail a[data-view]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      show(a.dataset.view);
      history.replaceState(null, '', '#' + a.dataset.view);
    });
  }
  show(location.hash.replace('#', '') || 'overview');
  addEventListener('hashchange', () => show(location.hash.replace('#', '') || 'overview'));

  $('#msgDevice').addEventListener('change', paintMessages);
  $('#refreshBtn').addEventListener('click', async () => { await load(); toast('Refreshed.'); });
  $('#saveName').addEventListener('click', async () => {
    const r = await window.HaloCloud.updateName($('#acctName').value);
    if (!r.ok) { toast(r.error || 'Could not save that.'); return; }
    toast('Saved.');
    await load();
  });

  await load();
})();
