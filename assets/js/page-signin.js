/**
 * Sign in, create an account, or set a new password.
 *
 * One form and a mode flag, because the fields are the same three and two pages would drift
 * apart. After signing in the visitor lands on wherever they were headed (`?next=`), which is
 * what makes a link to the dashboard work from a phone — and that value is checked against
 * `safeNext` first, because a redirect target taken from the address bar is a stranger's text.
 *
 * The third job is the reset: the link Supabase emails lands here with a session that may only
 * change a password, and `PASSWORD_RECOVERY` is how that arrives. Showing the dashboard to
 * somebody in that state is the bug this page was rewritten to not have.
 */
(function () {
  const { $, setupNotice, safeNext } = window.HaloUI;
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'), '/app');
  let mode = 'in';

  setupNotice('#setup');

  /* ------------------------------------------------------------- sign in / up */

  function paint() {
    const signUp = mode === 'up';
    $('#signTitle').textContent = signUp ? 'Create an account' : 'Sign in';
    $('#signSub').textContent = signUp
      ? 'An account puts your machines on the dashboard, so you can read a conversation from a phone and cut a machine off from here. The desktop app works without one.'
      : 'The dashboard shows the machines you have connected, what they have been doing, and lets you cut one off. The desktop app works without an account.';
    $('#nameField').hidden = !signUp;
    $('#signSubmit').textContent = signUp ? 'Create account' : 'Sign in';
    $('#toggleMode').textContent = signUp ? 'I already have an account' : 'I need an account instead';
    $('#signPassword').setAttribute('autocomplete', signUp ? 'new-password' : 'current-password');
  }

  $('#toggleMode').addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'in' ? 'up' : 'in';
    note('');
    paint();
  });

  /** Note under the form: `bad` for a failure, plain for something that worked. */
  function note(message, kind, target = '#signNote') {
    const el = $(target);
    if (!el) return;
    el.className = 'note' + (kind === 'bad' ? ' bad' : kind === 'good' ? ' good' : '');
    el.textContent = message;
    el.hidden = !message;
  }

  $('#signForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#signSubmit');
    const email = $('#signEmail').value.trim();
    const password = $('#signPassword').value;
    const name = $('#signName').value.trim();
    if (!email || !password) { note('An email and a password, please.', 'bad'); return; }
    if (password.length < 8) { note('A password of at least 8 characters, please.', 'bad'); return; }
    btn.disabled = true;
    try {
      if (mode === 'up') {
        const r = await window.HaloCloud.signUp(email, password, name);
        if (!r.ok) { note(r.error, 'bad'); return; }
        if (r.needsConfirmation) {
          note('Account created. Supabase has sent a confirmation email; follow it, then sign in here.', 'good');
          mode = 'in';
          paint();
          return;
        }
      } else {
        const r = await window.HaloCloud.signIn(email, password);
        if (!r.ok) { note(r.error, 'bad'); return; }
      }
      // A full navigation rather than a client-side swap: the dashboard then starts from a
      // known state with the session already in place.
      location.href = next;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------------------------------------------------------- reset */

  /** Ask for the email. The answer never says whether that address has an account. */
  $('#forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#signEmail').value.trim();
    if (!email) { note('Type your email address above, then press "Forgot the password" again.', 'bad'); return; }
    const r = await window.HaloCloud.resetPassword(email);
    if (!r.ok) { note(r.error, 'bad'); return; }
    note('If that address has an account, a reset link is on its way. Open it in this browser.', 'good');
  });

  function showReset(askPassword = false) {
    $('#signForm').closest('.card').hidden = true;
    $('#resetCard').hidden = false;
    $('#signTitle').textContent = 'Set a new password';
    $('#signSub').textContent = 'You followed a reset link, so this session is allowed to change the password and nothing else.';
    if (askPassword) note('Type the new password twice, then save it.', '', '#resetNote');
  }

  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const one = $('#resetPassword').value;
    const two = $('#resetPassword2').value;
    if (one.length < 8) { note('A password of at least 8 characters, please.', 'bad', '#resetNote'); return; }
    if (one !== two) { note('Those two are not the same.', 'bad', '#resetNote'); return; }
    const btn = $('#resetSubmit');
    btn.disabled = true;
    try {
      const r = await window.HaloCloud.updatePassword(one);
      if (!r.ok) { note(r.error, 'bad', '#resetNote'); return; }
      note('Saved. Taking you to the dashboard.', 'good', '#resetNote');
      location.href = next;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------------------------------------------------------- on load */

  // Two ways in: the query this site redirects to, and the hash Supabase puts on a recovery
  // link (`#access_token=…&type=recovery`). The hash is checked here, before the client has
  // finished parsing it, so the reset form is up rather than a sign-in form that flashes.
  const recoveryLink = /(^|[#&?])type=recovery(&|$)/.test(location.hash + location.search);
  const asked = params.get('reset') === '1' || recoveryLink;
  const done = params.get('reset') === 'done';

  /**
   * What this page shows on load.
   *
   * Note what is *not* here: `requireSession`. That helper sends a signed-out visitor to this
   * page, so calling it from this page is a redirect to itself, growing `?next=` by one copy of
   * the URL each lap. The session is read directly instead, and a missing one is normal here.
   */
  async function boot() {
    if (done) { note('Password changed. Sign in with the new one.', 'good'); return; }
    if (recoveryLink) { showReset(); return; }
    if (asked) {
      // `?reset=1` with no token in the fragment: either the link was already used, or this is a
      // reload after it. A session decides which, and there is nothing to guess about.
      const session = await window.HaloCloud.session().catch(() => null);
      if (session) { showReset(); return; }
      note('That reset link has expired or has already been used. Sign in, or press "Forgot the password" for a new one.', 'bad');
      return;
    }
    const session = await window.HaloCloud.session().catch(() => null);
    if (session) location.replace(next);
  }

  boot();

  // The event that arrives when the client has processed a recovery link. Without this, a link
  // followed in this tab shows the sign-in form and the visitor types the password they cannot
  // remember.
  window.HaloCloud.onAuth((_session, event) => {
    if (event === 'PASSWORD_RECOVERY') showReset();
  });

  paint();
})();
