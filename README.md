# Halo on the web

This folder is the website. It is plain HTML, CSS and JavaScript: no framework, no build step,
nothing to install. **Supabase** is the database and the accounts. **Vercel** serves the files.
The desktop app is what puts a machine on it.

> This folder is also published as its own repository — the site alone, with the Supabase schema
> and the one script its deploy needs — which is what you want if you are only hosting the
> website. [`PUBLISHING.md`](PUBLISHING.md) is that repository's way in. Everything below is
> written from inside the desktop project, where the rest of the commands live: `doctor:web`,
> `check:web`, `serve:web` and `release:manifest` all read this folder *and* the app's build, so
> they belong to the project rather than to the site.

```
web/
  index.html        what Halo is, and the one click download
  download.html     the build for this machine, then every build with sizes and hashes
  start.html        get started: download, install, sign in, connect a machine
  signin.html       sign in, create an account, set a new password
  app.html          the dashboard: your machines, their messages, cut access
  admin.html        every account, machine and message on the project
  privacy.html      exactly what is stored, and how to stop it
  assets/           stylesheet, scripts, icon
  downloads.json    generated: which builds exist, with sizes and hashes
  downloads/        the installers themselves, when you serve them from this domain
  vercel.json       the deploy: the build command, clean URLs, one content security policy
  supabase/         schema.sql — the whole backend, run once in a Supabase project
  tools/            the two scripts the deploy and your laptop need; see tools/README.md
  package.json      the two commands above, named: web:config and serve:web
  PUBLISHING.md     the site's own repository, from nothing to live (step 4, the other way)
  QUICKSTART.md     the seven steps as clicks and pastes, for a first run
  SUPABASE.md       what Supabase is and what Halo stores in it, explained from zero
  README.md         this file: the runbook, and the reference behind each step
```

Two decisions are worth knowing before the first deploy, because everything else follows from
them:

- **The site cannot reach into a PC.** Nothing on the web opens a socket on your machine, starts
  it, or approves anything. What it can do is mark a machine as cut off, and the app finds that
  out when it next checks in and switches its own remote access off. That is the only control
  flow that does not need a hole in your firewall, and it is why "cut access" is honest.
- **Row level security is the entire access model.** The anon key is public by design (every
  visitor downloads it with the page), so who reads what is decided by `supabase/schema.sql` and
  nowhere else. Read that file before changing anything here, and never put a `service_role` key
  in `config.js`.

---

## Setting it up

**Never done this before?** [`QUICKSTART.md`](QUICKSTART.md) is the same seven steps written as
clicks and pastes, with nothing assumed, including what to paste in each step. Come back here for
*why* a setting matters or when something is wrong.

**Not sure what any of this is?** [`SUPABASE.md`](SUPABASE.md) explains what Supabase actually
is — a database, accounts and the API in front of both — what the two keys are for and why one of
them is safe to publish, what Halo keeps in each of the five tables, and what happens, request by
request, when somebody signs up or you cut a machine off.

```bash
npm run doctor:web              # what is done, what is not, and the one next thing to do
npm run doctor:web -- --live    # also asks your project: URL, key, schema, sign-in
npm run doctor:web -- --values  # prints the two values, to paste into Halo's Settings → Account
```

`doctor:web` reads this folder and your config, changes nothing, needs no account, and ends with
**next:** and one command. Work down the seven steps, re-run it after each, and stop when it says
*ready*. Every step below says which line to look for.

**The whole setup is three values.** Everything else is polish:

| Value | Where it comes from | Where it goes |
|---|---|---|
| **Project URL** `https://abcdefgh.supabase.co` | Supabase → **Settings → API Keys** | `supabase.url` |
| **Publishable key** `sb_publishable_…` — or, on an older project, the legacy `anon` `public` JWT `eyJ…` | the same page, or the project's **Connect** dialog | `supabase.anonKey` |
| **Your domain** `https://yourdomain` | you | canonical links, sitemap, robots — one command, step 7 |

### 1. Make a Supabase project

[supabase.com](https://supabase.com) → **New project**. The free tier is enough. Then
**SQL editor → New query**: paste **all** of [`../supabase/schema.sql`](../supabase/schema.sql)
and press **Run**. That makes the five tables, the policies that decide who reads them, and the
six functions the app and the site call. It is safe to run again later.

*Look for:* `supabase/schema.sql defines all 11 tables and functions the site calls`, and — with
`--live` — `the project itself has the 5 tables the site reads`.

### 2. Sign-in settings

**Authentication → Sign In / Providers → Email**: turn **Confirm Email** off, and leave **Allow
new users to sign up** on.

**Authentication → Sign In / Providers → Anonymous**: switch **Enable anonymous sign-ins** on.
This is what a copy installed from your download page uses to join the project without asking the
person you gave it to for an address, and without a password of yours inside a file they can
unzip. It is off by default, and with it off the *only* thing that breaks is every app you hand
out: the site itself looks completely healthy, which is why the doctor asks.

**Authentication → URL Configuration**: set **Site URL** to your domain, and add
`https://yourdomain/signin` to **Redirect URLs**. (No domain yet? Do it in step 4, then come
back — it has to match.)

*Look for* (`--live`): `Confirm Email is off, so signing up signs you in`, and
`anonymous sign-ins are on, so a copy handed out from the download page joins by itself`. A
project that does not report the setting at all says nothing here rather than guessing.

### 3. The two values

**Settings → API Keys**: copy the **Project URL** and the **Publishable key**. Paste them into
`assets/js/config.js`, or let the command do it:

```bash
SUPABASE_URL=https://abcdefgh.supabase.co \
SUPABASE_ANON_KEY=sb_publishable_… \
npm run web:config
```

Never the other one on that page — the **secret key** (`sb_secret_…`, or `service_role` on an
older project). It ignores every policy, and this file is served to everyone who loads the page.

*Look for:* `config.js names a Supabase project URL` and `config.js carries a publishable key` to
be gone, and `the published key is a publishable key, not a secret one` in their place.

### 4. Deploy it

```bash
cd web && npx vercel login && npx vercel --prod
```

The questions, and the answers: deploy **yes** / your account / no existing project / **in which
directory: `.`** / modify settings **no**. From a repository instead, import it and set **Root
Directory** `web`, **Framework Preset** `Other`, and leave the rest empty.

*Done when:* the URL it prints loads and looks like the site.

Then give it a domain — **Settings → Domains → Add** — and **put that same domain into Supabase**
(step 2's URL Configuration), or a password reset email will send people somewhere the site no
longer is.

### 5. Make yourself the admin

Sign up on the site once, then in the **SQL editor**:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Open `/admin`. Until that statement is run it tells you that you are not an admin, which is the
database refusing you rather than the page.

### 6. Point the download page at your files

```bash
npm run build && npm run release:manifest -- --copy
```

That serves the installers from this domain, which is fine for a preview. For a public site put
them on a GitHub Release instead and set `downloads.baseUrl` in `assets/js/config.js`.

*Look for:* `every listed build can actually be fetched`.

### 7. Say what your domain is

```bash
HALO_SITE_URL=https://yourdomain npm run web:config
```

Until you do, every page claims `halo.example` in its canonical link, which is worse than
claiming nothing: it tells a search engine your pages live somewhere they do not.

*Look for:* `no page still claims the placeholder domain`.

That is the whole setup. Then walk the list under **Check it after deploying**, and keep
**Troubleshooting** for when something does not.

---

## The details

Everything above, in the order you meet it, with the parts that are easy to get wrong. None of it
is needed to finish — it is the reference to come back to when a step does not do what you
expected.

### The database, in depth

`supabase/schema.sql` is the whole backend. There is no server of ours: the browser talks
straight to Supabase with the publishable key, and the only thing standing between one person's
messages and another's is what that file writes as row level security. Running it creates five
tables, eight functions, four indexes, and the policies that connect them.

| Table | One row per | Worth knowing |
|---|---|---|
| `profiles` | signed-in person | `role` is `member` or `admin`, and no page can set it: the insert policy never accepts a role, so a signed-in user cannot promote itself. That is why step 5 is a SQL statement |
| `devices` | install that has been claimed | `pairing_code` is the short code that PC is showing, mirrored so the owner can read it from a phone; `revoked_at` is what **Cut access** writes, and the app reads it on its next check-in — the only way a web page can close a port on someone's PC |
| `messages` | exchange the app reports | `role` is `user` or `assistant`; `source` is `desktop`, `voice`, `telegram` or `remote` |
| `audit_log` | privileged action | `device.claimed`, `device.revoked`, `device.restored`, `fleet.locked`, `fleet.unlocked`, `downloads.opened`, `downloads.closed`. No client may write it: every row comes from a definer function, in the same statement as the change it records |
| `app_config` | the whole project — literally one row, enforced by `check (id = 1)` | `lockdown`, `lockdown_message`, `downloads_open`, and who last changed them. It has **no policies at all**, on purpose: the only way in is through the functions below |

The eight functions are two groups. Six are the API the app and the site call: `heartbeat` (an
install claims itself and is told whether it may work), `revoke_device` and `restore_device`
(cutting one machine off, and letting it back), `app_status` (the fleet switches, readable
**without** an account — which is what lets the closed-downloads notice work for a visitor who
has never signed in), and `set_lockdown` / `set_downloads_open`, which are admin-only in the
function itself rather than in the page that calls them. The other two are internal:
`handle_new_user` writes a `profiles` row when somebody signs up, so no screen needs a "this
person has no name" branch, and `is_admin` is the helper the policies use — `security definer`
and `stable`, which is what keeps "am I an admin?" from recurring into itself.

**Safe to run twice, and you should.** This file grows; running it again adds what is missing
without touching a row (`create ... if not exists` and `alter table ... add column if not exists`
throughout). On a machine with the Supabase CLI, `supabase db push` does the same thing. The seed
at the bottom of the file is commented out deliberately: it is the alternative to step 5, and a
reminder that the first admin has to be made by hand.

### The keys, in depth

**Settings → API Keys.** There is no separate *API* page any more: every key, legacy or not, is
on that page, and the Project URL is beside them (and in the project's **Connect** dialog). A
project has one of two pairings, and either works here:

| | Current | Legacy (still enabled on older projects) |
|---|---|---|
| **Use this** | **Publishable key** `sb_publishable_…` — a short string, not a JWT | **`anon` `public`** `eyJhbGciOiJIUzI1NiIs…` |
| **Never this** | **Secret key** `sb_secret_…` | **`service_role`** `eyJ…` |

Both publishable forms map to the same Postgres roles — `anon` for a stranger, `authenticated`
for somebody signed in — which is exactly what `supabase/schema.sql` writes its policies against.
Supabase is retiring the legacy pair during 2026; if your project has both, prefer the publishable
key. The doctor tells you which you pasted: `the published key is a publishable key, not a secret
one`, or `the published key is the legacy "anon" key, not a service_role one`.

The secret pair is the same thing under two names, and it carries the `service_role` role, which
has `BYPASSRLS` and therefore ignores every policy in the schema. Supabase refuses a secret key
sent from a browser on sight (it matches the User-Agent and answers 401), but `config.js` is
downloaded by every visitor, so the key would be published regardless. If the doctor ever says
`that is the secret key`, replace it **and** rotate it in **Settings → API Keys** — assume it is
public from the moment it was pasted.

#### Rotating a key

A publishable key needs no rotating, ever: it is on your site by design and it authorises nothing
on its own. A secret key does, and the moment to do it is the moment you notice — whether anyone
found it does not change what it is.

1. **Settings → API Keys**: create the replacement, and on an older project use **Generate new
   JWT** for the legacy pair.
2. Update whatever used the old one. For this repository that is *nothing*: the site and the app
   must never carry a secret key, which is why the doctor refuses one. If something else of yours
   does — a script, another app — change it here first.
3. Disable the old key on the same page. Create-then-disable is the order that breaks nothing in
   between.

### The sign-in settings, in depth

**Confirm Email.** *On*, signing up creates the account but not a session, and the person has to
follow the link before they can sign in — the site says so on the sign-in page rather than leaving
them staring at a form. *Off*, signing up signs you in immediately, and Supabase marks the
address as confirmed. Off is what these instructions ask for, because it is what makes the first
five minutes work end to end. Leave it on if you want verified addresses, and expect to need mail
that really delivers: on the built-in mailer the message frequently does not arrive, and then
nobody can sign in at all.

**Allow new users to sign up.** Off means only existing accounts can sign in, so the *first*
account cannot be made either, and no page can say that any better than "sign-ups are disabled".
Both of these are read out of the project's own `/auth/v1/settings` by `--live`, which is why the
doctor can tell you which one you are in rather than leaving you to compare screenshots.

**Site URL and Redirect URLs** are about links that leave the site and come back:

| Flow | What it depends on | If it is wrong |
|---|---|---|
| *Forgot the password* | **Site URL** for the base, and the address must be listed in **Redirect URLs** | The mail arrives with a link to `localhost:3000` or to a preview deployment that no longer exists |
| Email confirmation (only if you left Confirm Email on) | the same two | The link goes nowhere and the account stays unconfirmed |
| Signing in from a preview deploy | that preview's domain in **Redirect URLs** | Sign-in works on production and fails on the preview you are testing |
| Anything on your real domain | **Site URL** | Some flows quietly use the placeholder Supabase ships with, and the reset link is right back to being a dead end |

Add every address you will actually test at, including `http://localhost:4173` if you use
`npm run serve:web` for sign-in rather than only for looking at pages.

### The free tier, in depth

Two limits decide how a hobby deploy behaves, and both bite this site harder than most, because
it is static and idle between visits:

- **Only two projects can be active at once.** Paused ones do not count against that.
- **A free project is paused after seven days of inactivity.** It keeps its data, takes a backup,
  and **Resume project** in the dashboard brings it back. Nothing is lost and the site recovers
  without a redeploy.

While it is paused, every request answers as if the project did not exist — which is why the site
says "the site has no database yet" and why `--live` names pausing as one of the two causes of a
404 from `/rest/v1/` (the other being the Data API switched off). The distinction matters: a
paused project is fixed by one click and no changes at all, and a deploy with the wrong key is
fixed by pasting a value.

### Vercel, in depth

**Way one, the command line** (no git repository needed — Vercel uploads the folder as it is):

| It asks | Answer | Why |
|---|---|---|
| Set up and deploy? | yes | |
| Which scope? | your account | |
| Link to an existing project? | no, the first time | it makes one named after the folder |
| **In which directory is your code located?** | **`.`** (the default) | you are already in `web/` — the same choice as **Root Directory** below |
| Want to modify these settings? | **no** | there is nothing to build, and `vercel.json` carries the rest |

Run from inside `web/`, the CLI sets the project root to `web/` for you, and that is the whole
trick: **`vercel.json`, `index.html` and `downloads.json` have to be at the project root**. A
deployment rooted at the repository instead serves the source tree, not the site. A CLI deploy
also has no git hook behind it: nothing redeploys when you edit a file, you run the command again.

**Way two, the dashboard**, after importing the repository — **Settings → Build and Deployment**:

| Field (as Vercel names it) | Value | Why |
|---|---|---|
| **Framework Preset** | **Other** | this is plain HTML; a preset would try to build it and fail |
| **Root Directory** | `web` | the same requirement, set from the other side |
| **Build Command** | from `vercel.json`: `node tools/web-config.js` | it is already set there, so this field is overridden: it exists for the deploy's benefit, and running it changes nothing when the environment sets nothing |
| **Output Directory** | from `vercel.json`: `.` | it is already set there, so this field is overridden. Left to itself Vercel looks for `public/`, which this site does not have: the pages and the manifest are at the root |
| **Install Command** | leave the default | at root `web/` there is no `package.json` to install. Rooted at the repository instead, Vercel will install *this repo's* Electron dependencies — hundreds of megabytes, for a site that needs none |

#### The environment variables

Set these under **Settings → Environment Variables**, for **Production** at least and for
**Preview** as well if you want preview URLs to work. They are read at **build time** by
`tools/web-config.js`, which edits them into the deployed copy of `assets/js/config.js` and into
the domain claims below it. The publishable key still ends up in the page source, because it has
to: that is what a publishable key is for. What the variables buy you is a repository that does
not carry your project's address.

| Variable | Fills in | Required |
|---|---|---|
| `SUPABASE_URL` | `supabase.url` | yes, for a working site |
| `SUPABASE_ANON_KEY` | `supabase.anonKey` | yes |
| `HALO_SITE_URL` | the canonical link on every page, `sitemap.xml`, `robots.txt` | strongly recommended — see step 7 |
| `HALO_DOWNLOADS_BASE` | `downloads.baseUrl` (a GitHub Release URL, usually) | only if the installers live elsewhere |
| `HALO_ADMIN_EMAILS` | `adminEmails`, the hint the pages show before sign-in | no; the real role is `profiles.role` |
| `HALO_CONTACT_EMAIL` | `contactEmail`, shown on the privacy page | no |
| `HALO_REPO_URL` | `repoUrl`, linked from the footer | no |

Run with no variables at all it prints what it reads and changes nothing — a build step that
blanked a working config on a machine without the variables would be worse than no build step.

#### Previews, redeploys, and what a CLI deploy is missing

- **A git-connected project rebuilds itself** on every push, and gives you a preview deployment
  per branch. Two things are worth setting once: **Ignored Build Step → Only build production**
  if you would rather not spend minutes on previews of a page you are looking at locally, and the
  environment variables for the Preview environment as well as Production.
- **A CLI deploy does not.** Nothing rebuilds when you edit a file; you run the command again.
  That is the whole trade: no repository, no pipeline, and you are the pipeline. Re-running it
  after an edit is the normal way to work, and `npx vercel` without `--prod` gives you a throwaway
  URL first if you would rather look before you point the domain at it.
- **Redeploy without changing anything** is a dashboard action: **Deployments → ⋯ → Redeploy**.
  Useful after changing an environment variable, because variables are baked in at build time.
- **A preview of this site cannot sign anybody in** unless you add that preview's domain to
  Supabase's **Redirect URLs**. That is worth knowing before you conclude sign-in is broken.

#### What `vercel.json` does, line by line

It is part of the deploy and needs no editing. Every entry is there because of a page on this
site:

| Entry | Why |
|---|---|
| `buildCommand` | runs `tools/web-config.js`, which fills step 3's values in from the environment at build time. It reads nothing it is not given, so a deploy with no variables set is untouched — and it works from either layout, because it finds the site rather than assuming where it is |
| `outputDirectory` | `.` — the project root. Vercel's Output Directory for a project with no framework is `public`, which is a folder this site does not have and does not want: the pages, the assets and the manifest live at the root, so that is what gets served. Without this line a deploy fails with *No Output Directory named "public" found after the Build completed* |
| `cleanUrls` | `/download` and `/signin` serve `download.html` and `signin.html`, which is what every link in the site and the README assumes |
| `trailingSlash: false` | one address per page rather than two |
| `rewrites: /dashboard → /app` | the dashboard has been called both things; neither breaks |
| **Content-Security-Policy** | `default-src 'self'`, plus **exactly two** other origins: the pinned `supabase-js` from jsDelivr (`script-src`) and `*.supabase.co` (`connect-src`). A page that fails to load a script is usually this policy working as intended |
| `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` | the plain hygiene headers: no sniffing, no referrer leakage, no framing, and no camera, microphone, location or payment access from a page that has no need of any of them |
| `Cache-Control` on `/assets` and `/downloads` | a page edit should be picked up on the next reload (an hour, with revalidation); an installer, once downloaded, never needs fetching again (a year, immutable) |

A later edit that genuinely needs a third-party script or font goes into that policy —
deliberately, with the origin named, which is the point of writing it down.

#### When the domain changes

Every one of the four places below has to move, and they fail differently:

| Where | What breaks if it lags behind |
|---|---|
| Vercel → Settings → Domains | the old address stops resolving, and the new one serves a certificate for nobody |
| Supabase → URL Configuration → Site URL | password reset links point at the old domain |
| Supabase → URL Configuration → Redirect URLs | the reset link is refused, and the page reports an error instead of a form |
| `HALO_SITE_URL` (step 7) | search engines are told the pages live somewhere they do not |

### The domain, in four places

These two services agree about your domain only because you tell both. The failure when they
disagree is not visible until somebody presses *Forgot the password* and the link sends them to
`localhost` or to a preview URL that no longer exists.

| Where | What it is for |
|---|---|
| Vercel → Settings → Domains | where the site is served |
| Supabase → Authentication → URL Configuration → **Site URL** | where the site *is*, as far as sign-in is concerned |
| Supabase → Authentication → URL Configuration → **Redirect URLs** | where a link in an email is allowed to land (`https://yourdomain/signin`) |
| `HALO_SITE_URL` in this repository (step 7) | what the pages tell search engines |

### What each command does

| Command | What it actually does | When you want it |
|---|---|---|
| `npm run doctor:web` | reads this folder, the config and the manifest; prints what is done, what is not, and one next action. Writes nothing, needs no account | whenever you are not sure where you are |
| `npm run doctor:web -- --live` | all of the above, and then GETs `/rest/v1/`, one row from each table, and `/auth/v1/settings` | after pasting the values, after changing a Supabase setting, when the site says "no database yet" |
| `npm run doctor:web -- --values` | prints the project URL and key, formatted for Halo → **Settings → Account** | when handing the app to somebody else |
| `npm run serve:web` | serves this folder at `http://127.0.0.1:4173/` with the same clean URLs Vercel uses, so `/download` works locally too | before deploying a page change |
| `npm run check:web` | the whole site check: every link resolved, every script parsed, row level security still on every table, the manifest still matching the build, the deploy config still sane | before deploying anything; it is part of `npm test` |
| `npm run web:config` | fills the two values, the domain claims, the downloads base, the contact and repo links — from the environment | instead of hand-editing, or as the Vercel Build Command |
| `npm run release:manifest` | writes `web/downloads.json` from what was actually built, with sizes and SHA-256, and says where the files can be fetched from | after `npm run build` |
| `npm run release:manifest -- --copy` | the same, and copies the installers into `web/downloads/` so this domain serves them | a preview, a LAN, or a site with no GitHub Release |

---

## Check it after deploying

Five minutes of clicking, in this order. Each one fails in a way the page explains:

1. `/start` loads, shows a download button, and the card at the bottom shows **your** project URL
   and anon key. If it says the site has no Supabase project, step 3 did not take.
2. Press the download button. The file arrives, and its size matches the one on the line beneath
   it. That is the one click path: the same file the page named.
3. `/signin`, create an account. It should land you on `/app` rather than asking for an email.
4. `/app` shows "Hello, <your name>" and, in **Machines**, "No machine has signed in yet".
5. In the desktop app: **Settings → Account**, paste the project URL and anon key from `/start`,
   switch **Report to this account** on, sign in with the same email, press **Sync now**. Within
   a minute the machine appears on `/app` with its platform and model.
6. Say something to Halo, then reload `/app` → **Messages**. The exchange should be there.
7. Press **Cut access** twice on that machine. The app should say who cut it, stop reporting, and
   switch its own remote access off on its next check. **Let it back in** only works when the
   person at that machine signs in again: an admin can cut, only the owner can restore.
8. In the **Everyone** card at the top of `/admin`, type a sentence and press **Switch everyone
   off** twice. On that machine the window should grow a standing notice and the Ctrl+Win bar
   should open saying why; Halo should refuse a request with the same sentence. Press **Switch
   everyone back on** twice and it should come back on its own, without touching the PC.
9. Press **Close the downloads** twice and reload `/`. The download button becomes a note, on
   every page that offers one. **Open the downloads** brings it back.

## Switching every copy off

The **Everyone** card at the top of `/admin` holds the two switches that apply to the whole
project rather than to one machine.

**Switch every copy off.** Every install on this project stands down on its next check-in. What
standing down means, on the machine:

- it stops reporting conversations, immediately, and the queue of unsent ones is emptied
- it stops listening for remote control, drops any pairing code it was showing, and stops
  driving any PC it was linked to
- it refuses every request, whichever way it arrived — the window, the Ctrl+Win bar, Telegram, a
  linked PC — with the sentence you wrote beside the switch
- it keeps checking in, every twenty seconds, which is how it learns that you have switched it
  back on. Nothing needs to be done at either end: throwing the switch back is enough, and the
  machine comes back on its own

That last point is the whole design. A lock that could only be lifted by visiting every machine
would be worse than the problem it was meant to solve, so the check-in is the one thing that is
never switched off. The sentence is required, and the database refuses the switch without it,
because it is the only thing the people affected will ever see.

**Who can do it.** An admin, and the database checks that itself rather than trusting the page.
Both switches write an audit row in the same statement, and the fleet lines show up in
`/admin` → **Activity** → **Audit log** as `fleet locked`, `fleet unlocked` and `downloads
closed`, so the record of who did it is not something anyone has to remember to write.

**Close the downloads.** With this off, every download button on the site is replaced by a note.
This is what the site tells a visitor rather than a wall around anything: the installers are
static files and `downloads.json` is public, and the switch that actually stops a copy of Halo
is the one above. Its real use is the other way round — getting the site to stop advertising a
build you are about to replace.

### What neither switch can do

- **It cannot reach a machine that has no account configured.** Nothing on this website can open
  a socket on anyone's PC, in either direction. An install with **Settings → Account** switched
  off, or with no project URL pasted in, is invisible to both switches, and that is a property of
  the design rather than something to fix. If you are handing Halo to someone and you need this
  power over it, have them run it against your project.
- **It cannot stop a machine that is switched off or offline.** The instruction is delivered on
  its next check-in, which is within five minutes while it is running. How long it takes is how
  long it takes that PC to come back to the network.
- **It is not instant.** A page cannot push to a PC. Five minutes, then the machine stands down
  and stays down.

### On a project that already has data

These switches need the newer `supabase/schema.sql`: the `app_config` table, the three functions
that came with it, and the `locked` field in the check-in's answer. Run the whole file again in
the SQL editor; it is written to be run twice. Until then the Everyone card says so in plain
words rather than pretending, and the downloads stay open.

## Every day after that

- **After changing a page:** `npm run serve:web` (serves this folder at
  `http://127.0.0.1:4173/` with the same clean URLs Vercel uses) and `npm run check:web`.
- **After a release:** `npm run release:manifest`, then commit `web/downloads.json`. If the files
  move to a new release URL, update `downloads.baseUrl`.
- **Rather not have a page:** delete the file, then run `check:web`. It fails on any link that
  now resolves to nothing, which is the point of it.

## Troubleshooting

Where a step number is given below, it is the step in **Setting it up**.

| What you see | What it means | What to do |
|---|---|---|
| "The site has no database yet" | `config.js` still has empty strings, so the site behaves as if there were no project | Step 3, then hard reload (Ctrl+F5) |
| Every button on `/download` 404s | `downloads.json` lists files that are in neither `web/downloads/` nor a `baseUrl` | Step 6: `--copy`, or set `baseUrl` |
| "The database has no tables yet" | The schema was never run, or was run against a different project | Step 1: run `schema.sql` in *this* project |
| Sign in says "Invalid login credentials" | Wrong password, or the account was created in another project | Try **Forgot the password**; check the address, then the project |
| Sign up works, then nothing happens | Email confirmation is on and the email has not been followed | Follow the email, or turn confirmation off (step 2) |
| `/admin` says you are not an admin | `profiles.role` is still `member` | Step 5, the `update` statement |
| The dashboard is empty but the app says it is reporting | The app is signed into a different project, or a different account | Compare the URL in the app with `/start` |
| The reset email never arrives | Supabase does not have the site URL or the redirect URL | Step 2, the URL Configuration |
| The **Everyone** card says the switches are unavailable | `supabase/schema.sql` was last run before `app_status` existed | Run the whole file again in the SQL editor |
| Switched every copy off and nothing happened | That install has no account configured, or it has not checked in yet | Compare its **Settings → Account** with `/start`; otherwise wait up to five minutes |
| Closed the downloads and every button is still there | The site is a static deploy: the page has to be reloaded, and the answer is never cached | Hard reload; if it persists, step 1 has not been run since the table was added |
| The page is unstyled and the console shows a blocked script | The content security policy is doing its job after an edit that added a third party script | Add the origin to `vercel.json`, deliberately |
| `doctor:web` says the value is a secret key | A key that ignores every policy was pasted into a file every visitor downloads | Replace it with the publishable (or legacy anon) key, then rotate the secret one in Supabase |
| `doctor:web -- --live` says tables *are not in the project* | `schema.sql` was run somewhere else, or not at all | Run the whole file in **this** project's SQL editor, then re-run the doctor |
| `doctor:web` says the project URL does not answer | A typo, no network, or a paused project | Check the URL is `https://<ref>.supabase.co`; see the next two rows |
| `--live` reports a **404** from `/rest/v1/` | Either the Data API is switched off for the project, or the project is **paused** | **Settings → API → Data API** must be on; a paused free project says **Resume project** in the dashboard, and keeps its data |
| The site worked last month and now says "no database" | A free project is paused after seven days of inactivity | Resume it in the dashboard: nothing was lost, and the site recovers without a redeploy |
| `--live` says the email provider is off, or that sign-ups are disabled | The two toggles on **Authentication → Sign In / Providers → Email** | Turn the provider on, and *Allow new users to sign up* on. Both are read out of the project's own `/auth/v1/settings` |
| The deploy serves a **list of files** | Vercel's root is the repository rather than `web/` | Set **Settings → Build and Deployment → Root Directory** to `web`, or deploy from inside `web/` |
| Vercel's build times out installing packages | The root is the repository, so it is installing this project's Electron dependencies for a static site | Set the root to `web`; there is no `package.json` there and nothing to install |
| A preview URL shows the site but sign-in fails | Supabase knows only about the production URL | Add the preview domain to **Redirect URLs**, or test sign-in on production |

## Local development

```bash
npm run serve:web          # http://127.0.0.1:4173/, clean URLs, like Vercel
npm run check:web          # links, metadata, scripts, schema policies, manifest, deploy config
npm run doctor:web         # the setup checklist: what is configured, and the next command to run
```

`check:web` is the one that matters after an edit. It walks every page, resolves every link,
parses every script, asserts that the schema has row level security on every table (a table with
it forgotten looks exactly like working code), checks that the download manifest and the build
config still agree about ARM64, and fails if the manifest lists a file nobody can fetch. It runs
as part of `npm test`.

The download gate and the fleet state are checked by *running* the site's own script in a bare
context with a chosen user agent and a stubbed project answer, rather than by reading it: the
closed state, the fail-open case when the project cannot be reached, and the exact request the
gate makes (POST to `/rest/v1/rpc/app_status`, with the anon key, never cached) are all
assertions. A gate that asked without the anon key would get a 401, read it as "unreachable" and
fail open on every page while looking implemented, which is precisely the kind of quiet wrong a
grep cannot see.

## What the site deliberately does not have

- **No Remote tab.** Reaching one PC's Halo from another is a desktop to desktop link, made and
  unmade on the machines themselves. A page offering it would offer a control the site has no
  way to honour, so the dashboard has Overview, Machines, Messages and Account, and
  `app.html` says why in a comment.
- **No server of ours.** No Vercel functions, no cron, no queue. Every read and write goes from
  the browser to Supabase under the policies in the schema, which is why there is nothing to keep
  running and nothing to pay for at rest.
- **No analytics, no trackers, no cookies** set by the site itself. When you sign in, Supabase
  puts a session token in local storage; that is what keeps you signed in.
- **No passwords stored anywhere by us.** The browser sends the password straight to Supabase,
  and the desktop app keeps a session token rather than the password.
