/**
 * The admin panel.
 *
 * Everybody can open this page; only an admin sees anything on it. That is not politeness:
 * `profiles.role = 'admin'` is what the policies in schema.sql check, so an ordinary account
 * asking these same queries gets its own rows back, and the page says so rather than showing
 * an empty project and leaving the reader to wonder.
 */
(async function () {
  const { $, esc, toast, ago, when, setupNotice, requireSession, signOutButton } = window.HaloUI;

  // The switches that apply to everyone: whether the fleet is off, the sentence the people
  // affected are shown, and whether installers are being handed out. Declared here rather than
  // beside the rest of the state, because the first thing this page does is decide whether it
  // has a database at all, and that decision has to be able to say these are out of reach.
  let fleet = { lockdown: false, message: '', open: true, reachable: true };

  setupNotice('#setup');
  signOutButton('#navSignOut');

  const session = await requireSession();
  if (!session && window.HaloCloud.configured) return;
  if (!session) {
    $('#subtitle').textContent = 'Waiting for a Supabase project.';
    $('#peopleBody').innerHTML = '<tr><td colspan="7" class="dim">No database connected.</td></tr>';
    fleetUnavailable('No database connected, so these switches have nothing to write to.');
    return;
  }

  let people = [];
  let devices = [];
  let messages = [];
  let detailUser = null;      // whose machines the lower table is filtered to
  let editing = null;         // the handed-out machine whose feature switches are on screen
  let draft = {};             // feature id -> boolean, while that editor is open

  const byId = new Map();

  const isAdmin = (profile) => Boolean(profile && profile.role === 'admin');

  function machinesFor(userId) {
    return devices.filter((d) => d.user_id === userId);
  }

  function machineRow(d, showOwner) {
    const owner = byId.get(d.user_id);
    const cut = Boolean(d.revoked_at);
    const recent = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 10 * 60 * 1000;
    const bits = [d.platform, d.arch, d.app_version ? 'v' + d.app_version : '', d.model].filter(Boolean).map(esc).join(' · ');
    return `<div class="item">
      <span class="dot ${cut ? 'bad' : recent ? 'on' : 'off'}"></span>
      <div class="grow">
        <div class="name">${esc(d.name)} ${cut ? '<span class="pill bad">access cut</span>' : recent ? '<span class="pill ok">recently seen</span>' : '<span class="pill">idle</span>'}</div>
        <div class="desc">${bits || 'no details reported yet'}${showOwner && owner ? ` · ${esc(owner.display_name || owner.email || 'unknown account')}` : ''}</div>
        <div class="desc">last seen ${esc(ago(d.last_seen_at))} · added ${esc(when(d.created_at))}</div>
      </div>
      ${cut
        ? `<span class="dim small">cut ${esc(ago(d.revoked_at))}</span>`
        : `<button class="btn small danger" data-cut="${esc(d.id)}">Cut access</button>`}
    </div>`;
  }

  function paintMachines() {
    const list = detailUser ? machinesFor(detailUser) : devices;
    $('#machineList').innerHTML = list.length
      ? list.map((d) => machineRow(d, !detailUser)).join('')
      : '<div class="empty">No machine on this project has signed in yet.</div>';
    for (const btn of document.querySelectorAll('[data-cut]')) {
      btn.addEventListener('click', () => cutOff(btn.dataset.cut, btn));
    }
  }

  function paintPeople() {
    const filter = ($('#peopleFilter').value || '').trim().toLowerCase();
    const rows = people.filter((p) => !filter
      || String(p.display_name || '').toLowerCase().includes(filter)
      || String(p.email || '').toLowerCase().includes(filter));
    const body = $('#peopleBody');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="dim">${people.length ? 'Nobody matches that filter.' : 'No accounts yet.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((p) => {
      const mine = machinesFor(p.id);
      const msgs = messages.filter((m) => m.user_id === p.id).length;
      return `<tr>
        <td>${esc(p.display_name || '—')}</td>
        <td>${esc(p.email || '—')}</td>
        <td>${p.role === 'admin' ? '<span class="pill ok">admin</span>' : '<span class="pill">member</span>'}</td>
        <td>${mine.length}${mine.some((d) => d.revoked_at) ? ' <span class="pill bad">cut</span>' : ''}</td>
        <td>${msgs}</td>
        <td class="nowrap">${esc(ago(p.last_seen_at))}</td>
        <td class="actions"><button class="btn small ghost" data-user="${esc(p.id)}">Machines</button></td>
      </tr>`;
    }).join('');
    for (const btn of body.querySelectorAll('[data-user]')) {
      btn.addEventListener('click', () => showUser(btn.dataset.user));
    }
  }

  function showUser(id) {
    detailUser = id;
    const p = byId.get(id);
    $('#detailTitle').textContent = p ? (p.display_name || p.email || 'Machines') : 'Machines';
    $('#detailHint').textContent = p ? `${machinesFor(id).length} machine(s) for ${p.email || 'this account'}` : '';
    $('#clearDetail').classList.remove('hidden');
    paintMachines();
  }

  function paintMessages() {
    const who = $('#msgPerson').value;
    const list = who ? messages.filter((m) => m.user_id === who) : messages;
    if (!list.length) {
      $('#msgLog').innerHTML = '<div class="empty">Nothing reported yet. An account shows messages here once its app is signed in.</div>';
      return;
    }
    const names = new Map(devices.map((d) => [d.id, d.name]));
    $('#msgLog').innerHTML = list.map((m) => {
      const p = byId.get(m.user_id);
      const who2 = (p && (p.display_name || p.email)) || 'unknown account';
      return `<div class="m ${m.role}">
        <div class="who">${esc(who2)} · ${m.role === 'user' ? 'them' : 'Halo'} · ${esc(names.get(m.device_id) || 'unknown machine')} · ${esc(when(m.created_at))}</div>
        <div class="body">${esc(m.text)}</div>
      </div>`;
    }).join('');
  }

  async function paintAudit() {
    const rows = await window.HaloCloud.audit(60);
    const body = $('#auditBody');
    if (rows && rows.error) { body.innerHTML = `<tr><td colspan="4" class="dim">${esc(rows.error)}</td></tr>`; return; }
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="dim">No cuts or restores on this project yet.</td></tr>'; return; }
    body.innerHTML = rows.map((r) => {
      const actor = byId.get(r.actor);
      return `<tr>
        <td class="nowrap">${esc(when(r.created_at))}</td>
        <td>${esc(String(r.action || '').replace('.', ' '))}</td>
        <td>${esc(actor ? (actor.display_name || actor.email) : 'the account owner')}</td>
        <td>${esc((r.detail && r.detail.name) || r.target || '—')}</td>
      </tr>`;
    }).join('');
  }

  /**
   * The two switches that apply to everyone, drawn from what the database says.
   *
   * The counts are the point of the sentence next to them: "switch everyone off" is an easy
   * thing to press and a hard thing to picture, and the number of installs that are about to
   * stand down is what makes it concrete.
   */
  function paintFleet() {
    const pill = $('#fleetPill');
    const state = $('#fleetState');
    const live = devices.filter((d) => !d.revoked_at).length;
    pill.className = 'pill ' + (fleet.lockdown ? 'bad' : 'ok');
    pill.textContent = fleet.lockdown ? 'every copy switched off' : 'running';
    $('#fleetCard').classList.toggle('armed', fleet.lockdown);
    $('#lockdownBtn').textContent = fleet.lockdown ? 'Switch everyone back on' : 'Switch everyone off';
    $('#downloadsBtn').textContent = fleet.open ? 'Close the downloads' : 'Open the downloads';
    // The message belongs to the lockdown that is in force, so it is shown while one is and
    // cleared when it is lifted: a field holding a stale sentence from the last time is how
    // the wrong explanation gets sent out with the next one.
    const box = $('#lockdownMessage');
    box.disabled = fleet.lockdown;
    if (fleet.lockdown) box.value = fleet.message;
    else if (document.activeElement !== box) box.value = '';
    state.textContent = fleet.lockdown
      ? `Switched off ${esc(when(fleet.at))}. ${live} machine(s) on this project stand down on their next check-in, and come back the same way when this is switched off.`
      : `Running. ${live} machine(s) on this project are reporting normally.`;
  }

  /**
   * Switch the whole fleet off, or back on.
   *
   * Pressed twice like cutting one machine off, and for the same reason: the first press says
   * what is about to happen, the second does it. This one reaches every install there is, so
   * it also refuses to go through without a message — that sentence is the only thing the
   * people affected will see, and the database refuses it too.
   */
  async function toggleLockdown(btn) {
    if (!fleet.reachable) { toast('The project cannot be reached, so nothing was changed.'); return; }
    const going = !fleet.lockdown;
    const message = $('#lockdownMessage').value.trim();
    if (going && !message) {
      toast('Write what to tell people first: it is what they will see.');
      $('#lockdownMessage').focus();
      return;
    }
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      const was = btn.textContent;
      btn.textContent = going
        ? `Press again to switch every copy off`
        : `Press again to switch every copy back on`;
      setTimeout(() => { if (btn.dataset.armed === '1') { delete btn.dataset.armed; btn.textContent = was; } }, 5000);
      return;
    }
    delete btn.dataset.armed;
    btn.disabled = true;
    const r = await window.HaloCloud.setLockdown(going, going ? message : '');
    btn.disabled = false;
    if (!r.ok) { toast(r.error || 'That did not go through.'); return; }
    toast(going
      ? 'Switched off. Every install stands down on its next check-in.'
      : 'Switched back on. Every install resumes on its next check-in.');
    await load();
  }

  async function toggleDownloads(btn) {
    if (!fleet.reachable) { toast('The project cannot be reached, so nothing was changed.'); return; }
    const going = !fleet.open;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      const was = btn.textContent;
      btn.textContent = going ? 'Press again to close the downloads' : 'Press again to open the downloads';
      setTimeout(() => { if (btn.dataset.armed === '1') { delete btn.dataset.armed; btn.textContent = was; } }, 5000);
      return;
    }
    delete btn.dataset.armed;
    btn.disabled = true;
    const r = await window.HaloCloud.setDownloadsOpen(going);
    btn.disabled = false;
    if (!r.ok) { toast(r.error || 'That did not go through.'); return; }
    toast(going ? 'Downloads closed.' : 'Downloads open again.');
    await load();
  }

  /**
   * The switches, plainly out of reach, with the reason.
   *
   * Every one of them needs a database round trip, so a page with no project behind it must
   * show them switched off rather than as controls whose failure is discovered by pressing one
   * and waiting for nothing to happen.
   */
  function fleetUnavailable(reason) {
    fleet = { lockdown: false, message: '', open: true, reachable: false };
    $('#fleetState').textContent = reason;
    $('#fleetPill').className = 'pill bad';
    $('#fleetPill').textContent = 'unavailable';
    for (const id of ['#lockdownBtn', '#downloadsBtn', '#lockdownMessage']) $(id).disabled = true;
  }

  async function loadFleet() {
    // Read fresh on every load and every refresh: this is the page that changes the switches, so
    // a cached answer would show the state before the change the reader just made.
    const st = await window.HaloUI.fleetStatus({ fresh: true });
    if (!st.reachable) {
      fleetUnavailable(st.error
        ? `The project did not answer (${st.error}). If its schema is older than this page, running supabase/schema.sql again is what fixes it.`
        : 'This site has no database connected, so these switches have nothing to write to.');
      return;
    }
    fleet = {
      lockdown: st.lockdown === true,
      message: st.message,
      at: st.at,
      open: st.open !== false,
      reachable: true,
    };
    for (const id of ['#lockdownBtn', '#downloadsBtn', '#lockdownMessage']) $(id).disabled = false;
    paintFleet();
  }

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

  /* ------------------------------------------------------- what a copy may do */

  /**
   * The copies that were handed out, rather than set up by their owner.
   *
   * `source` is the app's own statement about where that install came from: a build stamped
   * with this project (tools/fleet-stamp.js) reports itself as 'fleet' when it joins. The
   * account behind such a machine was made by the app — no address, no password — which is why
   * the owner column here reads "no account of its own" rather than "unknown".
   */
  const handedOut = () => devices.filter((d) => d.source === 'fleet');

  /** Where the features of one machine stand, with no policy meaning nothing is held back. */
  function policyOf(d) {
    const stored = d.policy && typeof d.policy === 'object' && !Array.isArray(d.policy) ? d.policy : null;
    const list = Array.isArray(d.features) ? d.features : [];
    const out = {};
    for (const f of list) out[f.id] = stored ? (f.floor === true || stored[f.id] === true) : true;
    return out;
  }

  function blockedCount(d) {
    const list = Array.isArray(d.features) ? d.features : [];
    const state = policyOf(d);
    return list.filter((f) => f.floor !== true && state[f.id] !== true).length;
  }

  function givenRow(d) {
    const cut = Boolean(d.revoked_at);
    const recent = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 10 * 60 * 1000;
    const bits = [d.platform, d.arch, d.app_version ? 'v' + d.app_version : '', d.model].filter(Boolean).map(esc).join(' · ');
    const list = Array.isArray(d.features) ? d.features : [];
    const off = blockedCount(d);
    const msgs = messages.filter((m) => m.device_id === d.id).length;
    const features = !list.length
      ? 'has not reported what it can do yet'
      : off ? `allows everything except ${off} feature(s)` : 'allows everything';
    return `<div class="item">
      <span class="dot ${cut ? 'bad' : recent ? 'on' : 'off'}"></span>
      <div class="grow">
        <div class="name">${esc(d.name)}
          <span class="pill">given out</span>
          ${cut ? '<span class="pill bad">access cut</span>' : recent ? '<span class="pill ok">recently seen</span>' : '<span class="pill">idle</span>'}
        </div>
        <div class="desc">${bits || 'no details reported yet'} · ${esc(features)} · ${msgs} message(s)</div>
        <div class="desc">no account of its own · last seen ${esc(ago(d.last_seen_at))} · joined ${esc(when(d.created_at))}</div>
      </div>
      ${list.length ? `<button class="btn small ghost" data-features="${esc(d.id)}">What it may do</button>` : ''}
      ${cut
        ? `<span class="dim small">cut ${esc(ago(d.revoked_at))}</span>`
        : `<button class="btn small danger" data-cut="${esc(d.id)}">Cut access</button>`}
    </div>`;
  }

  function paintGiven() {
    const list = handedOut();
    $('#givenState').textContent = list.length
      ? `${list.length} copy(ies) installed from the download page, ${list.filter((d) => !d.revoked_at).length} reporting.`
      : 'Nothing has joined this project from the download page yet.';
    const box = $('#givenList');
    box.innerHTML = list.length
      ? list.map(givenRow).join('')
      : '<div class="empty">A copy appears here within a minute of its first launch. If one never does, the project has anonymous sign-ins switched off — Authentication → Sign In / Providers → Anonymous — and the app on that machine says so in Settings → Account.</div>';
    for (const btn of box.querySelectorAll('[data-features]')) btn.addEventListener('click', () => openEditor(btn.dataset.features));
    for (const btn of box.querySelectorAll('[data-cut]')) btn.addEventListener('click', () => cutOff(btn.dataset.cut, btn));
  }

  /**
   * The feature switches for one machine, in one editor.
   *
   * The list comes from the machine itself (it reports its catalogue on every check-in) rather
   * than from a copy of the catalogue kept here: the app knows what it can do, a later release
   * may add a feature this page has never heard of, and a website holding its own list is how
   * the two quietly stop matching.
   */
  function openEditor(id) {
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    editing = d;
    draft = policyOf(d);
    paintEditor();
    const card = $('#givenEditor');
    if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
  }

  function paintEditor() {
    const card = $('#givenEditor');
    if (!editing) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const list = Array.isArray(editing.features) ? editing.features : [];
    $('#givenEditorName').textContent = editing.name;
    $('#givenEditorHint').textContent = 'Saved here, applied on that machine within five minutes';
    $('#givenEditorList').innerHTML = list.length
      ? list.map((f) => `<label class="switch-row${f.floor ? ' floor' : ''}">
          <span class="grow">
            <span class="name">${esc(f.label || f.id)}</span>
            <span class="desc">${esc(f.hint || '')}</span>
          </span>
          <input type="checkbox" data-feature="${esc(f.id)}" ${draft[f.id] ? 'checked' : ''} ${f.floor ? 'disabled' : ''} />
        </label>`).join('')
      : '<div class="empty">That machine has not reported what it can do yet. It sends the list on its next check-in, within five minutes of it being switched on.</div>';
    for (const box of $('#givenEditorList').querySelectorAll('input[data-feature]')) {
      box.addEventListener('change', () => { draft[box.dataset.feature] = box.checked; });
    }
    $('#givenEditorNote').textContent = list.length
      ? 'A feature switched off here is refused on that machine, and Halo there says plainly that you did not allow it. Conversation cannot be switched off: a copy with nobody to talk to is a broken copy, not a restricted one.'
      : '';
    $('#givenEditorSave').disabled = !list.length;
    $('#givenEditorAll').disabled = !list.length;
  }

  async function savePolicy(btn, clear) {
    if (!editing) return;
    btn.disabled = true;
    const list = Array.isArray(editing.features) ? editing.features : [];
    let next = null;
    if (!clear) {
      next = {};
      for (const f of list) if (f.floor !== true) next[f.id] = draft[f.id] === true;
    }
    const r = await window.HaloCloud.setDevicePolicy(editing.id, next);
    btn.disabled = false;
    if (!r.ok) { toast(r.error || 'That did not go through.'); return; }
    toast(clear
      ? 'Saved. That machine is allowed everything again within five minutes.'
      : 'Saved. It applies on that machine within five minutes.');
    editing = null;
    draft = null;
    await load();
  }

  async function load() {
    const profile = await window.HaloCloud.profile();
    if (profile && profile.error) { $('#subtitle').textContent = profile.error; return; }
    if (!isAdmin(profile)) {
      // Said plainly, with the way out: this is usually somebody who followed a link and does
      // not know that being a member of the project is not the same as being its admin.
      $('#subtitle').textContent = 'This account is not an admin on this project.';
      $('#peopleBody').innerHTML = '<tr><td colspan="7" class="dim">Ask the project owner to run this in the Supabase SQL editor, with your address in it:'
        + ' <code>update public.profiles set role = \'admin\' where email = \'you@example.com\';</code></td></tr>';
      $('#machineList').innerHTML = '<div class="empty">Not available to this account.</div>';
      $('#msgLog').innerHTML = '<div class="empty">Not available to this account.</div>';
      $('#auditBody').innerHTML = '<tr><td colspan="4" class="dim">Not available to this account.</td></tr>';
      // The fleet switches are the most consequential thing on this page, so a member sees
      // them plainly switched off rather than as controls that fail when pressed.
      fleetUnavailable('Not available to this account. These switches need an admin.');
      $('#fleetPill').className = 'pill';
      $('#fleetPill').textContent = 'admin only';
      return;
    }

    const data = await window.HaloCloud.overview(300);
    if (data.error) { $('#subtitle').textContent = data.error; return; }
    people = data.people;
    devices = data.devices;
    messages = data.messages.slice().reverse();
    byId.clear();
    for (const p of people) byId.set(p.id, p);

    $('#subtitle').textContent = `${people.length} account(s), ${devices.length} machine(s), reporting since the project was created.`;
    $('#statPeople').textContent = String(people.length);
    $('#statMachines').textContent = String(devices.length);
    $('#statCut').textContent = String(devices.filter((d) => d.revoked_at).length);
    $('#statMessages').textContent = String(messages.length);

    const sel = $('#msgPerson');
    const chosen = sel.value;
    sel.innerHTML = '<option value="">Everyone</option>' + people
      .map((p) => `<option value="${esc(p.id)}">${esc(p.display_name || p.email || 'unnamed')}</option>`).join('');
    sel.value = chosen;

    if (detailUser && !byId.has(detailUser)) { detailUser = null; $('#clearDetail').classList.add('hidden'); }
    if (detailUser) showUser(detailUser); else paintMachines();
    paintPeople();
    paintMessages();
    paintGiven();
    if (editing && !devices.some((d) => d.id === editing.id)) { editing = null; draft = {}; }
    paintEditor();
    await loadFleet();
    await paintAudit();
  }

  function show(view) {
    for (const a of document.querySelectorAll('nav.rail a[data-view]')) a.classList.toggle('active', a.dataset.view === view);
    for (const name of ['people', 'given', 'activity']) $('#view-' + name).classList.toggle('hidden', name !== view);
  }
  for (const a of document.querySelectorAll('nav.rail a[data-view]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      show(a.dataset.view);
      history.replaceState(null, '', '#' + a.dataset.view);
    });
  }
  show(location.hash.replace('#', '') || 'people');

  $('#peopleFilter').addEventListener('input', paintPeople);
  $('#msgPerson').addEventListener('change', paintMessages);
  $('#clearDetail').addEventListener('click', () => {
    detailUser = null;
    $('#detailTitle').textContent = 'Machines';
    $('#detailHint').textContent = 'Every machine on this project';
    $('#clearDetail').classList.add('hidden');
    paintMachines();
  });
  $('#lockdownBtn').addEventListener('click', () => toggleLockdown($('#lockdownBtn')));
  $('#downloadsBtn').addEventListener('click', () => toggleDownloads($('#downloadsBtn')));
  $('#givenEditorClose').addEventListener('click', () => { editing = null; draft = {}; paintEditor(); });
  $('#givenEditorSave').addEventListener('click', () => savePolicy($('#givenEditorSave'), false));
  $('#givenEditorAll').addEventListener('click', () => savePolicy($('#givenEditorAll'), true));
  $('#refreshBtn').addEventListener('click', async () => { await load(); toast('Refreshed.'); });

  await load();
})();
