/**
 * Shared page helpers. No framework: the site is six static pages and adding a build step
 * to render a download list would mean the download page breaks whenever a build is stale.
 */
window.HaloUI = (function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const cfg = window.HALO_CONFIG || {};

  /**
   * A stand-in for the Supabase half, used when that script did not arrive.
   *
   * The pages call into HaloCloud on their way up. Without this, a deploy missing
   * `assets/js/cloud.js` (or a browser refusing the pinned CDN script) leaves the dashboard on
   * "Loading" for ever, because the TypeError happens before anything is drawn. With it, those
   * pages say the one true thing: there is no database behind this site yet.
   *
   * `cloud.js` is loaded before this file, so a real one always wins.
   */
  if (!window.HaloCloud) {
    const none = { ok: false, error: 'The site has no database yet.' };
    window.HaloCloud = {
      configured: false,
      explain: (e) => String((e && e.message) || e || ''),
      get: () => null,
      session: async () => null,
      onAuth: () => () => {},
      signIn: async () => none,
      signUp: async () => none,
      signOut: async () => {},
      resetPassword: async () => none,
      updatePassword: async () => none,
      profile: async () => null,
      updateName: async () => none,
      devices: async () => [],
      messages: async () => [],
      audit: async () => [],
      revoke: async () => none,
      restore: async () => none,
      setLockdown: async () => none,
      setDownloadsOpen: async () => none,
      overview: async () => ({ error: 'The site has no database yet.' }),
    };
  }

  /**
   * Where a redirect is allowed to end up.
   *
   * `?next=` is read from the address bar, so it is a stranger's text: left alone, a link to
   * `/signin?next=https://elsewhere.example` turns this site into a sign-in form that hands
   * people off to somebody else's page the moment they have typed their password. Only a path
   * on this site is ever returned, including the `//host` shape, which browsers read as a
   * protocol relative URL rather than as a path.
   */
  function safeNext(raw, fallback = '/app') {
    const s = String(raw == null ? '' : raw).trim();
    if (!s.startsWith('/')) return fallback;
    if (s.startsWith('//') || s.startsWith('/\\')) return fallback;
    if (/[\u0000-\u0020]/.test(s)) return fallback;
    return s;
  }

  /** Text going into innerHTML. Every value from the database goes through this. */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let toastTimer = null;
  function toast(message, ms = 2600) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** "just now", "12 minutes ago", "3 days ago". */
  function ago(iso) {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return 'never';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'unknown');

  function bytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
    return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  /**
   * Which build to lead with for whoever is reading. Not a redirect: a suggestion, and one
   * the page checks against the manifest before it names it.
   *
   * The architecture guess is deliberately conservative. Apple silicon is the safe assumption
   * for a Mac, and Linux reports ARM in the user agent when it is ARM. Windows does not, so on
   * Windows the guess is x64 unless the agent says ARM64 — a page that offers the ARM64
   * installer to an ordinary Intel laptop is worse than one that offers nothing.
   */
  function visitor() {
    const ua = navigator.userAgent || '';
    const platform = navigator.userAgentData && navigator.userAgentData.platform
      ? navigator.userAgentData.platform
      : navigator.platform || '';
    const devices = platform + ua;

    // A phone or a tablet is not a machine this can be installed on, and guessing "macOS" for
    // an iPhone means handing somebody a dmg that cannot open. So: nothing is offered, and the
    // page falls back to the list, which is the honest answer.
    if (/Android|iPhone|iPod|iPad|Windows Phone/i.test(devices)) return { os: '', arch: '', mobile: true };
    // iPadOS reports itself as a Macintosh, and its user agent is otherwise identical to a
    // desktop Safari on one. What it cannot hide is the touch screen: no Mac has one, and every
    // iPad reports at least two touch points. (The check cannot be "and not Macintosh", which is
    // what the first draft of this said, and which quietly disabled it for every real iPad.)
    if (/Mac/i.test(devices) && Number(navigator.maxTouchPoints) > 1) {
      return { os: '', arch: '', mobile: true };
    }

    const os = /Mac/i.test(devices) ? 'macos'
      : /Linux|X11/i.test(devices) && !/Android/i.test(ua) ? 'linux'
        : /Win/i.test(devices) ? 'windows' : '';
    // Apple stopped selling Intel Macs, so ARM64 is the safe guess there. Windows is the other
    // way round: the user agent does not report the architecture, and most Windows machines are
    // x64, so ARM64 is only chosen when the agent actually says so.
    const arm = /arm64|aarch64/i.test(ua);
    const arch = os === 'macos' ? 'arm64' : arm ? 'arm64' : 'x64';
    return { os, arch, mobile: false };
  }

  /**
   * What a link asked for: `/download?os=linux&arch=arm64`.
   *
   * This is what makes a download link something you can send to somebody else. Without it the
   * only way to hand a person a specific build is to describe it and hope they pick right.
   */
  function wanted(search) {
    const params = new URLSearchParams(search == null ? location.search : search);
    const os = String(params.get('os') || '').toLowerCase();
    const arch = String(params.get('arch') || '').toLowerCase();
    if (!['windows', 'macos', 'linux'].includes(os)) return null;
    return { os, arch: ['arm64', 'x64', 'universal'].includes(arch) ? arch : '' };
  }

  // One request per page load. Two functions on the same page both want this file (the button
  // and the list), and asking the server for the same 6 KB twice to draw one page is a habit
  // worth not having. A failure is not remembered, so a retry can still succeed.
  let manifestOnce = null;
  async function manifest() {
    if (manifestOnce) return manifestOnce;
    const url = (cfg.downloads && cfg.downloads.manifest) || '/downloads.json';
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      manifestOnce = await res.json();
      return manifestOnce;
    } catch (err) {
      return { version: cfg.version, assets: [], error: String(err.message || err) };
    }
  }

  function assetUrl(asset) {
    const base = (cfg.downloads && cfg.downloads.baseUrl) || '';
    if (/^https?:/i.test(asset.url || '')) return encodeURI(asset.url);
    const path = asset.url || asset.file || '';
    const full = base
      ? base.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '')
      : String(path);
    // A build is called "Halo Setup 1.0.0-x64.exe". The space is legal in a URL and this is
    // what settles it as %20 rather than as whatever a given server decides to do with it.
    return encodeURI(full);
  }

  /**
   * The fleet switches, asked once per page.
   *
   * Two of them matter to a visitor, and neither is a secret: whether installers are being
   * handed out, and whether the app those installers produce is currently switched off. One
   * request answers both.
   *
   * Asked with a plain fetch against the project's REST endpoint rather than through the
   * Supabase client, and deliberately: these are the pages that hand out a download, and making
   * them pull in a 40 KB library and open an auth session to read two booleans would be the
   * tail wagging the dog. It also means the gate works on every page, including the ones with
   * no other reason to talk to the database. The function is granted to `anon` for exactly this.
   *
   * Every failure here resolves to "open" and "running". That is a deliberate choice and only
   * defensible because of what is behind it: closing the downloads is a message to a visitor,
   * not a wall — the files are static and the manifest is public — and the switch that actually
   * stops a copy of Halo is the one the app reads from its own check-in. So a site whose
   * database is unreachable should keep working rather than lock people out over a flag it
   * cannot read.
   */
  let fleetOnce = null;
  async function fleetStatus({ fresh = false } = {}) {
    if (fleetOnce && !fresh) return fleetOnce;
    const sup = cfg.supabase || {};
    const fail = { reachable: false, error: '', open: true, lockdown: false, message: '', at: '' };
    if (!sup.url || !sup.anonKey || typeof fetch !== 'function') { fleetOnce = fail; return fleetOnce; }
    try {
      const res = await fetch(String(sup.url).replace(/\/+$/, '') + '/rest/v1/rpc/app_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sup.anonKey },
        body: '{}',
        // `no-store` rather than `no-cache`: the point of this switch is that it takes effect
        // now, and a cached answer would keep handing out something that was closed.
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      fleetOnce = {
        reachable: true,
        error: '',
        open: data && data.downloads_open !== false,
        lockdown: Boolean(data && data.lockdown === true),
        message: String((data && data.lockdown_message) || ''),
        at: (data && data.lockdown_at) || '',
      };
    } catch (err) {
      // Not remembered as a failure: the admin panel asks again, and a page that never retried
      // would keep saying something is unavailable because of one dropped request.
      fleetOnce = { ...fail, error: String((err && err.message) || err) };
    }
    return fleetOnce;
  }

  /** What the download surfaces say when the operators have stopped handing it out. */
  function downloadsClosedBox(alt) {
    return '<div class="one closed">'
      + '<span class="label">Downloads are closed at the moment</span>'
      + '<span class="dim small">Halo is not being handed out right now. Nothing on your machine changes if you already have it.</span>'
      + (alt ? ` <a class="btn small" href="${esc(alt)}">What it does</a>` : '')
      + '</div>';
  }

  const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  const ARCH_LABEL = { arm64: 'ARM64', x64: 'x64 (Intel / AMD)', universal: 'Universal' };
  const archName = (a) => ARCH_LABEL[a] || a;
  // The short form, for a button that already says which system it is for: "Windows (x64)"
  // reads; "Windows (x64 (Intel / AMD))" does not.
  const ARCH_SHORT = { arm64: 'ARM64', x64: 'x64', universal: 'Universal' };
  const archShort = (a) => ARCH_SHORT[a] || a;

  /**
   * Ask the browser which architecture it is really on, when it can be asked.
   *
   * Windows is where this is worth doing: the user agent says nothing about the architecture
   * there, so a Snapdragon laptop would be handed the x64 build, which runs under emulation and
   * is the wrong download. Chromium exposes it as a high entropy hint, one small request, and a
   * browser that refuses simply keeps the guess. A link that named a system is never overruled:
   * whoever sent it said what they meant.
   */
  async function refine(who, fixed) {
    if (fixed || !who || who.mobile || !who.os || who.arch === 'arm64') return who;
    const data = navigator.userAgentData;
    if (!data || typeof data.getHighEntropyValues !== 'function') return who;
    try {
      // `bitness` is asked for as well so that the request is the same shape on every browser;
      // the answer used here is the architecture alone.
      const hints = await data.getHighEntropyValues(['architecture', 'bitness']);
      if (String(hints && hints.architecture).toLowerCase() === 'arm') return { ...who, arch: 'arm64' };
    } catch (_) { /* a hint that is not offered is not an error */ }
    return who;
  }

  /**
   * The best published build for one visitor, or null when there is none.
   *
   * "Best" is their platform and their architecture, then their platform and any
   * architecture. Shared so that a page cannot name one file and link to another.
   */
  function pickFor(assets, who) {
    if (!who || !who.os || who.mobile) return null;
    const mine = (assets || []).filter((a) => a.platform === who.os);
    if (!mine.length) return null;
    // Exact architecture, then a build that runs on anything of that system, then the first
    // one listed, which is the ARM64 build for the systems that have one.
    return mine.find((a) => a.arch === who.arch)
      || mine.find((a) => a.arch === 'universal')
      || mine[0];
  }
  const OS_NOTE = {
    windows: 'Windows 10 or 11. Installs per user, no administrator needed.',
    macos: 'macOS 12 or newer. The first launch needs a right-click → Open, until the build is signed.',
    linux: 'AppImage runs after chmod +x. The .deb is for Debian and Ubuntu.',
  };

  /**
   * The one button most people want: the build for the machine they are reading this on.
   *
   * Everything it says is read back off the asset it is about to link to, so the label, the
   * size and the file name cannot disagree with the href. When nothing matches (a phone, a
   * system nobody built for, a manifest that has not been generated) it says that rather than
   * offering a guess, because a wrong guess is a 90 MB download that does not run.
   */
  async function renderOneClick(target, opts = {}) {
    const box = typeof target === 'string' ? $(target) : target;
    if (!box) return null;
    const data = await manifest();
    const assets = (data && data.assets) || [];
    const asked = wanted();
    const who = await refine(asked || opts.who || visitor(), Boolean(asked || opts.who));
    const mine = pickFor(assets, who);
    const alt = opts.alt === false ? null : (opts.alt || '#all');

    // Checked here rather than at each call site, so that a button added to a page tomorrow
    // cannot forget it. The list below is gated in the same place for the same reason.
    const fleet = await fleetStatus();
    if (!fleet.open) {
      box.innerHTML = downloadsClosedBox(opts.alt || '/');
      return data;
    }

    if (!mine) {
      const why = who.mobile
        ? 'This page is open on a phone or a tablet. Halo installs on a desktop.'
        : assets.length ? 'No build for this system has been published yet.' : 'No builds have been published yet.';
      box.innerHTML = '<div class="one">'
        + `<span class="dim small">${esc(why)}</span>`
        + (alt ? ` <a class="btn small" href="${esc(alt)}">See every build</a>` : '')
        + '</div>';
      return data;
    }

    const url = assetUrl(mine);
    const label = (OS_LABEL[mine.platform] || mine.platform)
      + (mine.arch ? ` (${archShort(mine.arch)})` : '');
    const size = mine.size ? bytes(mine.size) : '';
    box.innerHTML = '<div class="one">'
      + `<a class="btn primary big" href="${esc(url)}" download>Download for ${esc(label)}</a>`
      + '<div class="one-note">'
      + `<span class="file">${esc(mine.file || '')}</span>`
      + (size ? ` <span class="dim">${esc(size)}</span>` : '')
      + (alt ? ` <a href="${esc(alt)}">A different system</a>` : '')
      + '</div></div>';
    return data;
  }

  /**
   * The download page, drawn from the manifest.
   *
   * A build that has not been published yet is shown as unavailable rather than as a link
   * that 404s: the alternative is a page that looks finished and hands people a broken file.
   */
  async function renderDownloads(target, opts = {}) {
    const box = typeof target === 'string' ? $(target) : target;
    if (!box) return null;
    const data = await manifest();
    const fleet = await fleetStatus();
    if (!fleet.open) {
      box.innerHTML = downloadsClosedBox();
      const stamp0 = $('#dlStamp');
      if (stamp0) stamp0.textContent = '';
      return data;
    }
    // A link that named a system (`?os=linux&arch=arm64`) marks that build as the one for you,
    // which is what makes a passed-on link land on the right button rather than near it.
    const who = opts.who || wanted() || visitor();
    const order = ['windows', 'macos', 'linux'];
    const byOs = new Map();
    for (const a of data.assets || []) {
      if (!byOs.has(a.platform)) byOs.set(a.platform, []);
      byOs.get(a.platform).push(a);
    }
    const osList = order.filter((o) => byOs.has(o)).concat(Array.from(byOs.keys()).filter((o) => !order.includes(o)));

    if (!osList.length) {
      box.innerHTML = '<div class="note bad">No builds are published yet. '
        + 'Run <code>npm run release:manifest</code> after a build, then commit <code>web/downloads.json</code>.</div>';
      return data;
    }

    box.innerHTML = osList.map((os) => {
      // ARM64 is listed first: it is the build the project is built for now, and the one the
      // visitor wants on a modern Mac or a Snapdragon laptop. The visitor's own architecture
      // is marked as well, so neither reading of "which do I want" needs a second page.
      const rank = (a) => (a.arch === who.arch ? 0 : a.arch === 'arm64' ? 1 : a.arch === 'x64' ? 2 : 3);
      const archs = byOs.get(os).slice().sort((a, b) => rank(a) - rank(b) || String(a.arch).localeCompare(String(b.arch)));
      return `<div class="os">
        <h3>${esc(OS_LABEL[os] || os)}${os === who.os ? ' <span class="pill ok">your system</span>' : ''}</h3>
        <div class="tag">${esc(OS_NOTE[os] || '')}</div>
        <div class="arch">${archs.map((a) => {
          const url = assetUrl(a);
          const recommended = os === who.os && a.arch === who.arch;
          return `<a class="btn${recommended ? ' recommended' : ''}${url ? '' : ' missing'}"${url ? ` href="${esc(url)}"${a.size ? ` data-size="${a.size}"` : ''}` : ' aria-disabled="true"'}`
            + ` title="${esc(a.file || a.label || '')}">`
            + `<span><b>${esc(ARCH_LABEL[a.arch] || a.arch)}</b>${a.kind ? ` · ${esc(a.kind)}` : ''}</span>`
            + `<span class="size">${a.size ? esc(bytes(a.size)) : 'not built yet'}</span></a>`;
        }).join('')}</div>
      </div>`;
    }).join('');

    const stamp = $('#dlStamp');
    if (stamp) {
      stamp.textContent = data.version
        ? `Version ${data.version}${data.publishedAt ? ' · built ' + new Date(data.publishedAt).toLocaleDateString() : ''}`
        : '';
    }
    return data;
  }

  /** The band at the top of the dashboard when a key has not been filled in yet. */
  function setupNotice(target) {
    const box = typeof target === 'string' ? $(target) : target;
    if (!box) return;
    if (HaloCloud.configured) { box.classList.add('hidden'); return; }
    // Fixed markup written here, not values from anywhere, so this is the one place on the
    // site that writes its own HTML rather than escaping what it is handed.
    box.innerHTML = '<strong>The site has no database yet.</strong><br>'
      + 'Put your Supabase project URL and anon key in <code>web/assets/js/config.js</code>, or set '
      + '<code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in the environment and run '
      + '<code>npm run web:config</code>.<br>'
      + 'Then run <code>supabase/schema.sql</code> in that project, so the tables and policies exist.';
    box.classList.remove('hidden');
  }

  /**
   * Send a signed-out visitor to the sign-in page, and hand a signed-in one their session.
   * `null` means "the page already dealt with it": either it redirected, or no project is
   * configured and the page is showing its setup notice instead.
   */
  async function requireSession() {
    if (!window.HaloCloud.configured) return null;
    const session = await window.HaloCloud.session();
    if (!session) {
      const here = safeNext(location.pathname + location.search, '/app');
      location.replace('/signin?next=' + encodeURIComponent(here));
      return null;
    }
    return session;
  }

  function signOutButton(sel) {
    const btn = $(sel);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await HaloCloud.signOut();
      location.href = '/';
    });
  }

  /** Highlight the rail link for the page on screen. */
  function markNav() {
    const here = location.pathname.replace(/\/+$/, '') || '/';
    $$('nav.site a, nav.rail a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      // A link to a section of this page (`/#faq`) is not a link to another page, and marking
      // it "where you are" is how three nav items end up underlined at once.
      if (href.includes('#')) return;
      const path = href.split('?')[0].replace(/\/+$/, '') || '/';
      if (path === here) a.classList.add('active');
    });
  }

  document.addEventListener('DOMContentLoaded', markNav);

  return { $, $$, esc, toast, ago, when, bytes, visitor, wanted, safeNext, pickFor, archName, archShort, OS_LABEL, manifest, assetUrl, renderOneClick, renderDownloads, setupNotice, requireSession, signOutButton, markNav, fleetStatus };
})();
