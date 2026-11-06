/**
 * Halo website configuration.
 *
 * Everything the site needs to reach out is here, so there is one file to edit after
 * deploying rather than values scattered through five pages. Two notes that matter:
 *
 * 1. The Supabase **anon key is meant to be public.** It identifies the project, it does
 *    not authorise anything: every table in supabase/schema.sql has row level security on,
 *    so an anon key with no session can read nothing. What must never be in this file is
 *    the *service_role* key, which ignores those policies. That one belongs in a server
 *    function or a terminal, never in a page a browser downloads.
 *
 * 2. On a deploy you can skip editing this file by hand: set SUPABASE_URL and SUPABASE_ANON_KEY
 *    in the environment and run `npm run web:config`, which fills these two values in. On
 *    Vercel that is the Build Command `node ../tools/web-config.js`. See web/README.md.
 */
window.HALO_CONFIG = {
  // Supabase project — Dashboard → Settings → API Keys (the Project URL is on that page, and in
  // the project's Connect dialog). Paste the publishable key, `sb_publishable_…`, or on an older
  // project the legacy `anon` public JWT. Never the secret key: see web/README.md, step 2.
  supabase: {
    url: '',
    anonKey: '',
  },

  // Where the installers are served from. The manifest lists every build with its size and
  // hash; the files themselves are typically on GitHub Releases, where they cost nothing to
  // host and can be replaced without a redeploy. Leave `baseUrl` empty to serve them from
  // this same domain (put them in web/downloads/).
  downloads: {
    manifest: '/downloads.json',
    baseUrl: 'https://github.com/reteshmani0-droid/Halo/releases/download/v1.0.0',
  },

  // Shown on the site. The admin page does not trust this list — it asks the database for
  // profiles.role — but it is a useful hint in the UI before sign-in.
  adminEmails: [],

  contactEmail: '',
  version: '1.0.0',
  repoUrl: '',
};

/*
 * The theme.
 *
 * The site is black now, and this file is a blocking script in the <head> of every page that
 * has one, so the stylesheet is requested while the parser is still in the head — before the
 * body exists and before the first paint. That is the whole reason the theme is loaded from
 * here instead of from eight separate <link> tags, and the background is set on the document
 * element as well, so even a slow stylesheet cannot open the page on a white flash.
 *
 * privacy.html and 404.html load no scripts, so they carry the same <link> in their own head.
 */
(function () {
  if (typeof document === 'undefined' || document.getElementById('halo-theme')) return;
  document.documentElement.style.background = '#000';
  const link = document.createElement('link');
  link.id = 'halo-theme';
  link.rel = 'stylesheet';
  link.href = '/assets/css/black.css';
  document.head.appendChild(link);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#000000');
})();
