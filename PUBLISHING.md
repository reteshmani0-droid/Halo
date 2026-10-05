# Getting this repository live

This repository is the **Halo website** and nothing else: the pages, the stylesheet, the scripts,
the installer manifest, and the Supabase schema they read. Plain HTML, CSS and JavaScript — no
framework, no build step, nothing to install. **Supabase** is the database and the accounts.
**Vercel** serves the files.

```
index.html        what Halo is, and the one click download
download.html     the build for this machine, then every build with sizes and hashes
start.html        get started: download, install, sign in, connect a machine
signin.html       sign in, create an account, set a new password
app.html          the dashboard: your machines, their messages, cut access
admin.html        every account, machine and message on the project
privacy.html      exactly what is stored, and how to stop it
assets/           stylesheet, scripts, icon, font
downloads.json    generated: which builds exist, with sizes and hashes
downloads/        the installers, if this domain serves them (empty on purpose — step 6)
vercel.json       the deploy: the build command, clean URLs, one content security policy
supabase/         schema.sql — the whole backend, run once in a Supabase project
tools/            the two scripts the deploy and your laptop need; see tools/README.md
```

`README.md`, `QUICKSTART.md` and `SUPABASE.md` also come from the desktop project, where the rest
of the tooling lives (`npm run doctor:web`, `npm run check:web`, `npm run release:manifest`).
They are the reference — what Supabase actually is, why each setting matters, what to do when a
step does not work — and *their* commands are the ones you would run in that project, not here.
The six steps below are the whole deploy.

**You will need:** a GitHub account, a Vercel account and a Supabase account. All three are free
and none needs a card. About fifteen minutes.

---

## 1. Publish this repository

This folder is already a git repository, and it is already published at
**https://github.com/reteshmani0-droid/Halo** — `origin` points there and `main` tracks it. So from
now on, publishing a change is two commands:

```bash
git add -A
git commit -m "what changed"
git push
```

A push to `main` is what Vercel builds, so once step 2 is done the site follows the repository by
itself — that is the whole reason to have it connected rather than deployed by hand.

**Starting from a copy of this folder, or a new account?** Publish it the same way: **GitHub
Desktop → File → Add local repository** → this folder → **Publish repository** (leave *Keep this
code private* ticked or untick it — Vercel imports either), or create an empty repository on
github.com and:

```bash
git remote add origin https://github.com/<your-account>/<your-repository>.git
git push -u origin main
```

One thing worth knowing about the name. This repository is **the website**; if the desktop app is
ever pushed into the same one, the site moves to a `web/` folder inside it and the Vercel project
needs **Root Directory** `web`. `README.md` documents that layout from the project's side, and
nothing else here changes: the scripts in `tools/` find the site in either place.

## 2. Import it into Vercel

Vercel → **Add New → Project → Import Git Repository**, pick `halo-website`, and deploy. Every
setting it asks for is already answered in `vercel.json`, so the defaults are the right ones:

| Field | Value | Why |
|---|---|---|
| **Framework Preset** | **Other** (detected) | this is plain HTML; a preset would try to build it and fail |
| **Root Directory** | **empty** (the repository root) | the site *is* the repository here — `vercel.json` and `index.html` are at the top |
| **Build Command** | from `vercel.json`: `node tools/web-config.js` | fills in step 3's values, and changes nothing if there are none |
| **Output Directory** | from `vercel.json`: `.` | the site *is* the repository root. Vercel's default for a project with no framework is `public/`, a folder this repository does not have — left alone, the build fails with *No Output Directory named "public" found after the Build completed* |
| **Install Command** | the default | nothing is installed — this repository has no dependencies |

From the terminal instead, from this folder: `npx vercel login` then `npx vercel --prod`, and
answer `.` to *In which directory is your code located?*

## 3. The two values, as environment variables

**Settings → Environment Variables** on the Vercel project. They are read at **build time** by
`tools/web-config.js`, which edits them into `assets/js/config.js`.

| Variable | Fills in | Required |
|---|---|---|
| `SUPABASE_URL` | `supabase.url` — `https://abcdefgh.supabase.co` | yes, for a working site |
| `SUPABASE_ANON_KEY` | `supabase.anonKey` | yes |
| `HALO_SITE_URL` | the canonical link on every page, `sitemap.xml`, `robots.txt` | strongly recommended — step 5 |
| `HALO_DOWNLOADS_BASE` | `downloads.baseUrl` (a GitHub Release URL, usually) | only if the installers live elsewhere — step 6 |
| `HALO_ADMIN_EMAILS` | `adminEmails`, a hint the pages show before sign-in | no; the real role is `profiles.role` |
| `HALO_CONTACT_EMAIL` | `contactEmail`, shown on the privacy page | no |
| `HALO_REPO_URL` | `repoUrl`, linked from the footer | no |

Set them for **Production** at least, and for **Preview** too if you want preview URLs to work.
Then **Deployments → ⋯ → Redeploy**: variables are baked in when the site is built, so a deploy
made before them still carries the old values.

**The publishable key is public by design** and ends up in the page source either way — that is
what it is for. The **secret** key (`sb_secret_…`, or `service_role` on an older project) ignores
every rule that protects one person's data from another's and must never be in this repository or
in a Vercel variable. `QUICKSTART.md` §3 has the click-by-click version of this step, including
which of the two keys on Supabase's **API Keys** page is which.

If you would rather not use environment variables at all: paste the two values straight into
`assets/js/config.js` and commit them. That works, and it is what the quickstart describes. What
the variables buy you is a repository that does not carry your project's address.

## 4. The database and the sign-in settings

Both are in Supabase, and `QUICKSTART.md` steps 1–2 are the same thing as clicks. In short:

1. **SQL Editor → New query**: paste all of `supabase/schema.sql` and press **Run**. This folder
   stands alone, so `cat supabase/schema.sql | clip` on this folder gets it onto the clipboard. It
   creates the tables, the policies that decide who reads them, and the functions the site calls.
2. **Authentication → Sign In / Providers → Email**: turn **Confirm Email** off, leave **Allow new
   users to sign up** on.
3. **Authentication → Sign In / Providers → Anonymous**: switch **Enable anonymous sign-ins** on.
   This is how a copy of the desktop app installed from your download page joins the project
   without asking the person you gave it to for an email address. Off, the site looks perfectly
   healthy and every installer you hand out stays silent.
4. **Authentication → URL Configuration**: **Site URL** is your domain, and
   `https://yourdomain/signin` must be in **Redirect URLs** — otherwise a password reset email
   lands on an address the site is no longer at.

Then sign up on your own site and make yourself the admin, in the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

`/admin` shows the panel from then on, and says you are not an admin until the statement has run.

## 5. Your domain

Vercel → **Settings → Domains → Add**, type the domain, follow the DNS instructions it shows. Then
in Supabase, **Authentication → URL Configuration**: put that same domain in **Site URL** and in
**Redirect URLs**. Then name it here, so search engines are told where the pages live:

```bash
HALO_SITE_URL=https://yourdomain.com npm run web:config
```

…or set `HALO_SITE_URL` in Vercel and redeploy, which is the same edit made at build time. Until
one of the two is done, every page claims `halo.example` in its canonical link, which is worse than
claiming nothing.

## 6. The download buttons

`downloads/` is empty on purpose. The installers are about 600 MB of build output that is
regenerated by every release, and Vercel's deploy size limit agrees that they do not belong in
this repository. `downloads.json` still lists every build with its size and hash; what has to
point at the files is `downloads.baseUrl`:

- **Recommended: a GitHub Release.** Attach the installers to a release, then set
  `HALO_DOWNLOADS_BASE` to the release's asset URL — for example
  `https://github.com/<your-account>/halo-website/releases/download/v1.0.0`. `downloads.json` and
  the base URL are joined by the page.
- **Or serve them from this domain:** copy the files into `downloads/`, commit, and leave
  `baseUrl` empty. Fine for a preview, and it works; it is the deploys over about a gigabyte that
  Vercel refuses.

With neither, `/download` says there is nothing to download rather than offering a button that
404s — which is the site working as intended, not a fault.

---

## Check it after deploying

1. `/start` loads, shows a download button, and the card at the bottom shows **your** project URL
   and publishable key. If it says the site has no database yet, step 3 did not take.
2. `/signin`, create an account: it should land you on `/app` rather than asking for an email.
3. `/app` says "Hello, <your name>" and, under **Machines**, "No machine has signed in yet".
4. In the desktop app: **Settings → Account**, paste the project URL and key from `/start`, switch
   **Report to this account** on, sign in with the same email, press **Sync now**. Within a minute
   that machine appears on `/app` with its platform and model.
5. `/admin` shows the panel rather than "this account is not an admin" — step 4's statement.

## When something is wrong

| What you see | What it is | What to do |
|---|---|---|
| The deploy fails with **No Output Directory named "public" found after the Build completed** | Vercel is looking for a `public/` folder; this repository keeps its pages at the root | `vercel.json` sets `outputDirectory` to `.`, which overrides the dashboard for every deployment. If it still fails, clear **Settings → Build and Deployment → Output Directory** (and **Root Directory**, which must be empty) |
| Every page says "the site has no database yet" | `config.js` still has empty strings, so the site behaves as if there were no project | Step 3, then a hard reload (Ctrl+F5) |
| The deploy serves a **list of file names** | The project's root is a folder above the site | In Vercel, **Settings → Build and Deployment → Root Directory** empty, and `vercel.json` at the top of the deploy |
| Sign-in works on production and fails on a preview URL | Supabase knows only about the production domain | Add the preview domain to **Redirect URLs**, or test sign-in on production |
| The reset email never arrives | Supabase does not have the site URL or the redirect URL | Step 4.4, then step 5 |
| Every button on `/download` 404s | `downloads.json` lists builds that are in neither `downloads/` nor `baseUrl` | Step 6 |
| The page is unstyled and the console shows a blocked script | The content security policy is doing its job after an edit that added a third-party script | Add the origin to `vercel.json` deliberately, with the origin named |
| The site worked last month and now has no database | A free Supabase project is paused after seven days of inactivity | **Resume project** in the Supabase dashboard: nothing is lost, and the site recovers without a redeploy |

`README.md` has the long versions of all of these, and `SUPABASE.md` explains what the two keys are
and why one of them is safe to publish.

## Local preview

```bash
npm run serve:web     # http://127.0.0.1:4173/, clean URLs, the way Vercel serves it
npm run web:config    # shows which environment variables it reads; changes nothing when unset
```

`serve:web` behaves like the deploy rather than like a plain file server, because `/download` only
resolves to `download.html` under Vercel's `cleanUrls`. A page that works locally and on the deploy
is the point.

## What this repository deliberately does not have

- **No server.** No Vercel functions, no cron, no queue, no build pipeline. Every read and write
  goes from the browser to Supabase under the policies in `supabase/schema.sql`, which is why
  there is nothing to keep running and nothing to pay for at rest.
- **No analytics, no trackers, no cookies** set by the site itself. Signing in puts a session
  token in local storage; that is what keeps you signed in.
- **No passwords stored anywhere.** The browser sends the password straight to Supabase.
- **No copy of the desktop app's build tooling.** `check:web`, `doctor:web` and `release:manifest`
  belong to the project the app is built in, because they check the app's build as well as the
  site. This repository is the deploy.
