'use strict';
// Put the deploy's values into the website, from the environment.
//
// The site is static files with no build step, which is a feature: it deploys by copying a
// folder. That leaves two things that are true of a *particular* deploy and cannot be baked
// into a repository anybody can read: the Supabase project it talks to, and the domain it says
// it lives at. This fills both in, editing the values in place rather than regenerating the
// files, so the comments in them survive and a hand edited config is not thrown away.
//
// Usage
//   npm run web:config                             # shows what it can fill in, changes nothing
//   SUPABASE_URL=https://x.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... npm run web:config     # the two values the site needs
//   HALO_SITE_URL=https://halo.example.com npm run web:config
//
// On Vercel: set the variables on the project and let `web/vercel.json` run this file as the
// Build Command — it works from either layout, because it finds the site rather than assuming
// where it is. Deploying from the desktop project with the Root Directory set to `web` instead,
// the Build Command is `node ../tools/web-config.js`. With no variables set it prints what it
// needs and touches nothing, because a build step that blanks a working config on a machine
// without those variables is worse than no build step at all.
//
// What must never be in here: the service_role key. It ignores row level security, and anything
// in a static site is public. The anon key is meant to be published, and every table in
// supabase/schema.sql has row level security on, which is what makes that safe.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The site is `web/` inside the desktop project and the repository root in the website's own
// repository, so it is found rather than assumed: the same file fills in either one, and the
// Build Command that runs it does not have to know which it is running in.
const site = fs.existsSync(path.join(root, 'web', 'vercel.json')) ? path.join(root, 'web') : root;

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
};

const configFile = argOf('--out', path.join(site, 'assets', 'js', 'config.js'));
const webDir = argOf('--web', site);
const env = process.env;

const changed = [];
const notes = [];

/** A string literal for the config file, escaped for the single quotes around it. */
const one = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Replace the first match of `pattern`, building the replacement from the capture groups.
 *
 * A function rather than a replacement string, so a value containing `$&` or `$1` is inserted as
 * the characters it is made of: a JWT in a `$`-aware replace is a config file with the key
 * quietly mangled, which looks like a broken project rather than a broken deploy step.
 */
function edit(file, pattern, build, label, { all = false, done = null } = {}) {
  if (!fs.existsSync(file)) { notes.push(`${label}: no such file (${file})`); return; }
  const src = fs.readFileSync(file, 'utf8');
  const probe = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  if (!probe.test(src)) {
    // The domain patterns match the *placeholder*, so a second run finds nothing to match and
    // has to be told which of the two reasons that is.
    if (done && done.test(src)) { notes.push(`${label}: already names this domain`); return; }
    notes.push(`${label}: the expected shape was not found in ${path.relative(site, file)}`);
    return;
  }
  const after = src.replace(pattern, (...m) => build(...m.slice(1, m.length - 2)));
  if (after === src) { notes.push(`${label}: already set`); return; }
  fs.writeFileSync(file, after);
  changed.push(`${label}${all ? ' (every page that names it)' : ''}`);
}

const inBlock = (block, key) => new RegExp(`(${block}:\\s*\\{[^}]*?${key}:\\s*)'[^']*'`);

if (env.SUPABASE_URL) {
  edit(configFile, inBlock('supabase', 'url'), (head) => head + one(env.SUPABASE_URL.trim()), 'supabase.url');
}
if (env.SUPABASE_ANON_KEY) {
  edit(configFile, inBlock('supabase', 'anonKey'), (head) => head + one(env.SUPABASE_ANON_KEY.trim()), 'supabase.anonKey');
}
if (env.HALO_DOWNLOADS_BASE) {
  edit(configFile, inBlock('downloads', 'baseUrl'), (head) => head + one(env.HALO_DOWNLOADS_BASE.trim()), 'downloads.baseUrl');
}
if (env.HALO_CONTACT_EMAIL) {
  edit(configFile, /(contactEmail:\s*)'[^']*'/, (head) => head + one(env.HALO_CONTACT_EMAIL.trim()), 'contactEmail');
}
if (env.HALO_REPO_URL) {
  edit(configFile, /(repoUrl:\s*)'[^']*'/, (head) => head + one(env.HALO_REPO_URL.trim()), 'repoUrl');
}
if (env.HALO_ADMIN_EMAILS) {
  const list = env.HALO_ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean).map(one).join(', ');
  edit(configFile, /(adminEmails:\s*)\[[^\]]*\]/, (head) => `${head}[${list}]`, 'adminEmails');
}

/**
 * The domain the site says it lives at.
 *
 * Canonical links, the sitemap and robots.txt all make a claim about it, and a placeholder
 * domain in any of them is worse than an absent one: it tells a search engine the pages live
 * somewhere they do not. Only the claims are rewritten, which is why the comment in the sitemap
 * that mentions the placeholder is left alone.
 */
if (env.HALO_SITE_URL) {
  const site = env.HALO_SITE_URL.trim().replace(/\/+$/, '');
  const there = new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const files = fs.existsSync(webDir) ? fs.readdirSync(webDir) : [];
  if (!files.length) notes.push(`HALO_SITE_URL: nothing to rewrite in ${webDir}`);
  for (const f of files) {
    const full = path.join(webDir, f);
    if (f.endsWith('.html')) {
      edit(full, /(<link rel="canonical" href=")https:\/\/halo\.example([^"]*)"/,
        (head, tail) => `${head}${site}${tail}"`, `${f} canonical`, { done: there });
    } else if (f === 'sitemap.xml') {
      edit(full, /<loc>https:\/\/halo\.example/g, () => `<loc>${site}`, 'sitemap.xml',
        { all: true, done: there });
    } else if (f === 'robots.txt') {
      edit(full, /^(Sitemap:\s*)https:\/\/halo\.example/m, (head) => head + site, 'robots.txt',
        { done: there });
    }
  }
}

const known = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'HALO_SITE_URL', 'HALO_DOWNLOADS_BASE', 'HALO_CONTACT_EMAIL', 'HALO_REPO_URL', 'HALO_ADMIN_EMAILS'];
const unset = known.filter((k) => !env[k]);

if (changed.length) {
  console.log(`[web:config] filled in ${changed.length} value(s):`);
  for (const c of changed) console.log('  - ' + c);
}
if (notes.length) for (const n of notes) console.log('  note: ' + n);
if (!changed.length && !notes.length) {
  console.log('[web:config] nothing was set, so nothing was changed.');
  console.log('  It reads: ' + known.join(', '));
  console.log('  The two the site needs are SUPABASE_URL and SUPABASE_ANON_KEY. See web/README.md.');
} else if (unset.length) {
  console.log('  not set here: ' + unset.join(', '));
}
