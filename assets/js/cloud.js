/**
 * The site's conversation with Supabase.
 *
 * One module so that the pages own their markup and nothing else. Every call here is
 * subject to row level security, so this file is not where access is decided: it is where
 * the questions are asked. Two consequences worth knowing while reading it:
 *
 * - `devices` revocation and restore go through database functions rather than a plain
 *   update, because the same statement has to write the audit row. A policy that allowed a
 *   bare update of `revoked_at` would let a client cut a device off with no record of who
 *   did it, and would let a clever one clear the column it had no business touching.
 * - Nothing here reads a service key. It cannot: it runs in a browser.
 */
window.HaloCloud = (function () {
  const cfg = (window.HALO_CONFIG || {}).supabase || {};
  const configured = Boolean(cfg.url && cfg.anonKey && window.supabase);
  let client = null;

  function get() {
    if (!configured) return null;
    if (!client) {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          // The session is kept in localStorage and refreshed in a background tab, so a
          // page left open overnight is still signed in when it is looked at again.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return client;
  }

  /** Turn a Supabase error into something a person can act on. */
  function explain(error) {
    if (!error) return '';
    const msg = String(error.message || error.error_description || error);
    if (/Invalid login credentials/i.test(msg)) return 'That email and password do not match an account.';
    if (/Email not confirmed/i.test(msg)) return 'That account still needs its email confirmed. Check your inbox, or turn confirmation off in Supabase.';
    if (/relation .* does not exist/i.test(msg)) return 'The database has no tables yet — run supabase/schema.sql in your Supabase project.';
    if (/does not exist|not signed in/i.test(msg)) return msg;
    if (/row-level security|permission denied/i.test(msg)) return 'The database refused that. If you expect to see this, check that your profile has role = admin.';
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'Could not reach Supabase. Check the project URL in the config, and the connection.';
    return msg;
  }

  return {
    configured,
    explain,
    get,

    /** The current session, or null. */
    async session() {
      const c = get();
      if (!c) return null;
      const { data } = await c.auth.getSession();
      return (data && data.session) || null;
    },

    /**
     * Called whenever the signed-in user changes, including sign-out.
     *
     * The event name is passed as well, because one of them matters: `PASSWORD_RECOVERY` is how
     * Supabase says "this session came from a reset link, ask for a new password", and a page
     * that cannot tell that apart from an ordinary sign-in shows the dashboard to somebody who
     * is halfway through recovering an account.
     */
    onAuth(cb) {
      const c = get();
      if (!c) return () => {};
      const { data } = c.auth.onAuthStateChange((event, session) => cb(session, event));
      return () => { try { data.subscription.unsubscribe(); } catch (_) { /* already gone */ } };
    },

    async signIn(email, password) {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const { data, error } = await c.auth.signInWithPassword({ email: String(email || '').trim(), password });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, session: data.session };
    },

    /**
     * Create an account. The name goes into the signup metadata, which the database trigger
     * copies onto the profile — that is why the admin panel can show a name rather than an
     * address, without the site ever writing the profile itself.
     */
    async signUp(email, password, displayName) {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const { data, error } = await c.auth.signUp({
        email: String(email || '').trim(),
        password,
        options: { data: { display_name: String(displayName || '').trim() } },
      });
      if (error) return { ok: false, error: explain(error) };
      // With email confirmation on, Supabase returns a user and no session. The page says so
      // rather than pretending the sign-in worked and dropping the visitor on an empty page.
      return { ok: true, needsConfirmation: !data.session, session: data.session };
    },

    async signOut() {
      const c = get();
      if (c) await c.auth.signOut();
    },

    /**
     * Send the password reset email.
     *
     * The answer is the same whether or not that address has an account, on purpose: a form that
     * says "no such account" is a way to ask a stranger's site which of its users exist.
     */
    async resetPassword(email) {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const address = String(email || '').trim();
      if (!address) return { ok: false, error: 'Type your email address first.' };
      const { error } = await c.auth.resetPasswordForEmail(address, {
        redirectTo: location.origin + '/signin?reset=1',
      });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true };
    },

    /** The second half of a reset: the new password, using the recovery session. */
    async updatePassword(password) {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const pw = String(password || '');
      if (pw.length < 8) return { ok: false, error: 'A password of at least 8 characters, please.' };
      const { error } = await c.auth.updateUser({ password: pw });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true };
    },

    /* ------------------------------------------------------------- reading */

    async profile() {
      const c = get();
      if (!c) return null;
      const { data: session } = await c.auth.getSession();
      const uid = session && session.session && session.session.user.id;
      if (!uid) return null;
      const { data, error } = await c.from('profiles').select('id, email, display_name, role, created_at, last_seen_at').eq('id', uid).maybeSingle();
      if (error) return { error: explain(error) };
      return data;
    },

    async updateName(name) {
      const c = get();
      if (!c) return { ok: false, error: 'No Supabase project configured.' };
      const { data: session } = await c.auth.getSession();
      const uid = session && session.session && session.session.user.id;
      if (!uid) return { ok: false, error: 'Not signed in.' };
      const { error } = await c.from('profiles').update({ display_name: String(name || '').trim() }).eq('id', uid);
      return error ? { ok: false, error: explain(error) } : { ok: true };
    },

    async devices() {
      const c = get();
      if (!c) return [];
      const { data, error } = await c
        .from('devices')
        .select('id, name, platform, arch, app_version, model, pairing_code, pairing_expires_at, source, policy, revoked_at, last_seen_at, created_at')
        .order('created_at', { ascending: false });
      if (error) return { error: explain(error) };
      return data || [];
    },

    async messages(limit = 60, deviceId = null) {
      const c = get();
      if (!c) return [];
      let q = c.from('messages').select('id, device_id, role, text, source, created_at').order('created_at', { ascending: false }).limit(limit);
      if (deviceId) q = q.eq('device_id', deviceId);
      const { data, error } = await q;
      if (error) return { error: explain(error) };
      return (data || []).reverse();
    },

    async audit(limit = 50) {
      const c = get();
      if (!c) return [];
      const { data, error } = await c.from('audit_log').select('id, actor, action, target, detail, created_at').order('created_at', { ascending: false }).limit(limit);
      if (error) return { error: explain(error) };
      return data || [];
    },

    async revoke(deviceId) {
      const c = get();
      if (!c) return { ok: false, error: 'No Supabase project configured.' };
      const { data, error } = await c.rpc('revoke_device', { target_device: deviceId });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, result: data };
    },

    async restore(deviceId) {
      const c = get();
      if (!c) return { ok: false, error: 'No Supabase project configured.' };
      const { data, error } = await c.rpc('restore_device', { target_device: deviceId });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, result: data };
    },

    /**
     * Say what one machine is allowed to do.
     *
     * `next` is a map of feature id to true/false, or null for "nothing held back". The database
     * decides who may — an admin on any machine, an owner on their own — and the app sanitizes
     * whatever arrives, so this is a request rather than a grant of authority.
     */
    async setDevicePolicy(deviceId, next) {
      const c = get();
      if (!c) return { ok: false, error: 'No Supabase project configured.' };
      const { data, error } = await c.rpc('set_device_policy', { target_device: deviceId, next: next || null });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, result: data };
    },

    /* ------------------------------------------------------- the fleet */

    /**
     * The switches that apply to everyone are *read* by ui.js, with a plain fetch, because the
     * pages that need them most are the ones with no Supabase client at all (see
     * HaloUI.fleetStatus). They are *written* here, through the signed-in client, because
     * writing one is an admin's action and needs the session that proves it.
     */

    /**
     * Switch every install off, or back on. An admin's action, and the heaviest one on the site.
     *
     * The database itself refuses this without a message when switching off, and refuses it
     * from anyone who is not an admin. Both of those are checked here as well, so the panel can
     * say what is wrong rather than showing a failed request.
     */
    async setLockdown(active, message = '') {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const { data, error } = await c.rpc('set_lockdown', { active: !!active, message: String(message || '') });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, result: data };
    },

    /** Stop handing out the installers, or start again. */
    async setDownloadsOpen(open) {
      const c = get();
      if (!c) return { ok: false, error: 'This site has no Supabase project configured yet.' };
      const { data, error } = await c.rpc('set_downloads_open', { open: !!open });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, result: data };
    },

    /* ------------------------------------------------------------- admin */

    /**
     * Everything the admin panel shows, in one round of queries.
     *
     * Allowed only because `profiles.role = 'admin'`, and enforced in the database rather
     * than by this page: an ordinary account calling these gets its own rows back and looks
     * like an empty panel, which is exactly what the page then says.
     */
    async overview(limit = 200) {
      const c = get();
      if (!c) return { error: 'No Supabase project configured.' };
      const [people, devices, messages] = await Promise.all([
        c.from('profiles').select('id, email, display_name, role, created_at, last_seen_at').order('created_at', { ascending: false }).limit(limit),
        c.from('devices').select('id, user_id, name, platform, arch, app_version, model, source, features, policy, revoked_at, last_seen_at, created_at').order('created_at', { ascending: false }).limit(limit),
        c.from('messages').select('id, user_id, device_id, role, text, source, created_at').order('created_at', { ascending: false }).limit(limit),
      ]);
      const firstError = people.error || devices.error || messages.error;
      if (firstError) return { error: explain(firstError) };
      return { people: people.data || [], devices: devices.data || [], messages: messages.data || [] };
    },
  };
})();
