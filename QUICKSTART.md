# Quickstart: from nothing to a live site

This is the same eight steps as `README.md`, written for somebody who has never opened a Supabase
dashboard or a Vercel one. Every step says exactly what to click, exactly what to paste, and
exactly what you should see afterwards. Where it says **paste**, paste it as it is.

`README.md` is the reference — why each setting exists, what the database actually contains, what
to do when something is wrong. This file is only the way through. If you are not sure what
Supabase *is*, read [`SUPABASE.md`](SUPABASE.md) first: it is the same thing explained from zero,
in about five minutes, and every setting below makes sense afterwards.

**You will need:** a web browser, this project folder on your computer, and about fifteen
minutes. Free accounts on both services, no credit card. A domain name is optional — you can do
that at the end, or never.

**The one command that tells you where you are**, whenever you are unsure. Run it from this
project folder (the folder with `package.json` in it):

```bash
npm run doctor:web
```

It prints what is done, what is not, and **next:** followed by the one thing to do now. Re-run it
after every step and stop when it says *ready*.

---

## Step 1 — Make the database

1. Go to [supabase.com](https://supabase.com) and press **Start your project**. Sign in with
   GitHub, or with an email and a password.
2. Press **New project**.
3. Fill it in — **Name**: `halo`, **Database Password**: press **Generate a password** and leave
   it as it is (nothing here needs it, but Supabase insists), **Region**: whatever is nearest to
   you. Press **Create new project**.
4. Wait two minutes. Something that looks like a database dashboard appears.
5. In the left sidebar, click **SQL Editor**.
6. Click **New query**.
7. Now put the whole schema on your clipboard. In your project folder, in a terminal, paste this
   and press Enter (**not** inside the browser — this is a command for your computer):

   ```bash
   cat supabase/schema.sql | clip
   ```

   On Windows in PowerShell instead of Git Bash, this is:

   ```powershell
   Get-Content supabase/schema.sql | Set-Clipboard
   ```

   If neither works, open the file `supabase/schema.sql` in any editor, select **all** of it
   (Ctrl+A), and copy (Ctrl+C).
8. Go back to the browser, click once inside the big empty query box, and press **Ctrl+V**.
9. Press the **Run** button (bottom right of the box).
10. You should see **Success. No rows returned**, and in the left sidebar a **Table Editor** that
    now lists five tables: `app_config`, `audit_log`, `devices`, `messages`, `profiles`.

If you see red text instead, nothing was run — re-copy the whole file and paste it again.

*Check it worked:* run `npm run doctor:web -- --live` and look for
**the project itself has the 5 tables the site reads**.

---

## Step 2 — Three sign-in settings

Still in Supabase.

1. Left sidebar → **Authentication**. (A picture of a padlock.)
2. Click **Sign In / Providers**, then **Email** in the list underneath.
3. Find **Confirm Email** and switch it **off**. (Off means: signing up signs you straight in.)
4. Find **Allow new users to sign up** and make sure it is **on**.
5. Press **Save** if a Save button appears.
6. Still under **Sign In / Providers**, click **Anonymous** in the same list and switch
   **Enable anonymous sign-ins** **on**. Press **Save**.

   This is how a copy of the app installed from your download page joins your project without
   asking the person you gave it to for an email address, and without putting a password of
   yours inside a file they can read. Off, everything else looks perfectly healthy and every
   installer you hand out sits silent — which is why the doctor checks it.
7. Left sidebar → **Authentication** again → **URL Configuration**.
8. In **Site URL**, paste the address your site will live at, and press **Save**:

   ```
   https://yourdomain.com
   ```

   No domain yet? Leave whatever is there and come back after step 4 — but come back, or the
   *Forgot the password* email will point somewhere that does not exist.
9. In **Redirect URLs**, press **Add URL** and paste this (same domain, with `/signin` added):

   ```
   https://yourdomain.com/signin
   ```

*Check it worked:* `npm run doctor:web -- --live` should print
**Confirm Email is off, so signing up signs you in**, and — if your project reports the setting —
**anonymous sign-ins are on, so a copy handed out from the download page joins by itself**.

---

## Step 3 — The two values

1. In Supabase: click the **gear** (bottom of the left sidebar) → **API Keys**.
2. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. Copy the **Publishable key**. It starts with `sb_publishable_`. On an older project there is no
   such key: instead use the one labelled **`anon` `public`** under *Legacy API keys*, which
   starts with `eyJ`.

   **Do not copy the other one on that page.** It is called **Secret key** and starts with
   `sb_secret_` (on an older project it is called `service_role` and starts with `eyJ` too). It
   ignores every rule in the database, and this file is downloaded by everybody who opens your
   site. If you paste it by mistake the doctor will tell you, and you must then also rotate that
   key in Supabase.

4. On your computer, open the file `web/assets/js/config.js` in any editor. Find these two lines,
   near the top:

   ```js
   url: '',
   anonKey: '',
   ```

5. Paste your Project URL between the quotes on the first line, and your publishable key between
   the quotes on the second. It should look like this, with your own values:

   ```js
   url: 'https://abcdefgh.supabase.co',
   anonKey: 'sb_publishable_AbCdEf1234567890',
   ```

6. Save the file.

*Check it worked:* `npm run doctor:web` should stop listing *config.js names a Supabase project URL*
and *config.js carries a publishable key*, and should say **the published key is a publishable
key, not a secret one**.

> **If you would rather not edit a file,** you can paste the two values into one command instead.
> Replace the two capitalised parts with yours, and run it in this folder:
>
> ```bash
> SUPABASE_URL=https://abcdefgh.supabase.co SUPABASE_ANON_KEY=sb_publishable_AbCdEf1234567890 npm run web:config
> ```

---

## Step 4 — Put it on the internet

1. In your terminal, go into the website folder:

   ```bash
   cd web
   ```

2. Sign in to Vercel — one time per computer:

   ```bash
   npx vercel login
   ```

   It opens your browser. Choose **Continue with GitHub** (or with email), press **Allow**, and
   come back to the terminal. It says *Success!*.

3. Deploy it:

   ```bash
   npx vercel --prod
   ```

   It asks five questions. Answer like this — the only answer that matters is the directory one:

   | It asks | You type |
   |---|---|
   | Set up and deploy? | `y` then Enter |
   | Which scope should contain your project? | just press Enter |
   | Link to existing project? | `n` then Enter |
   | What's your project's name? | just press Enter |
   | In which directory is your code located? | just press Enter (`./`) |
   | Want to modify these build settings? | `n` then Enter |

4. It prints a line like `Production: https://halo-abc123.vercel.app`. Open that address.
5. It should look exactly like the site: a dark page with a gold mark, a headline, and two
   buttons. If instead you see a *list of file names*, the directory answer in step 3 went wrong
   — press Ctrl+C, run `npx vercel --prod` again, and this time answer `./` to the directory
   question.

*Later, when you want your own domain:* in Vercel, **Settings → Domains → Add**, type your domain,
and follow the DNS instructions it shows. Then go back to **Supabase → Authentication → URL
Configuration** and put that same domain in both boxes there.

---

## Step 5 — Make yourself the admin

1. Open your site (the `https://...vercel.app` address) and press **Sign in**.
2. Press **Create an account**, and sign up with your own email and a password. Because Confirm
   Email is off, it signs you straight in and drops you on the dashboard.
3. Back in Supabase → **SQL Editor** → **New query**. Paste this, **changing the email to the one
   you just used**, and press **Run**:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

4. Reload your site and open `/admin` — add `/admin` to the end of your site's address. You should
   see the admin panel instead of "this account is not an admin".

---

## Step 6 — The download buttons

The installers are built and already in the right folder (`web/downloads/`), so pressing
**Download** on your site downloads a real file.

You only have to do something here when the files get too big for the deploy (about 600 MB
across all six). At that point: put them on a GitHub Release, and put the release address into
`downloads.baseUrl` in `web/assets/js/config.js`. `npm run release:manifest` tells you whether the
files can still be fetched, and from where.

*Check it worked:* `npm run doctor:web` says **every listed build can actually be fetched**.

---

## Step 7 — Tell the pages your domain

Skip this only if you have no domain yet.

1. In this project folder, paste this with your own domain, and press Enter:

   ```bash
   HALO_SITE_URL=https://yourdomain.com npm run web:config
   ```

   On Windows PowerShell, in one line:

   ```powershell
   $env:HALO_SITE_URL="https://yourdomain.com"; npm run web:config
   ```

2. In Vercel, deploy again so the change goes out:

   ```bash
   cd web && npx vercel --prod
   ```

3. And put that same domain into Supabase → **Authentication → URL Configuration** (both boxes),
   which is step 2.

*Check it worked:* `npm run doctor:web` says **no page still claims the placeholder domain**.

---

## Step 8 — Make the copies you hand out report to you

Do this **after** step 3, and again whenever the two values change. It is what makes a copy you
give somebody appear on your own admin panel by itself, and there is no way to notice it is
missing from the machine it is installed on.

1. In this project folder, paste this and press Enter:

   ```bash
   npm run fleet:stamp
   ```

   You should see `[fleet] stamped fleet.json for https://…`, naming your project. That is the file
   that will be inside the app you build next.
2. Rebuild the installers, so the stamped file is inside them:

   ```bash
   npm run build
   ```

   (Ten minutes or so. `npm run build` stamps by itself, so step 1 is only about seeing it happen.)
3. Put the new files where the download page serves them from:

   ```bash
   npm run release:manifest -- --copy
   ```
4. Deploy again, so the refreshed files are on the site:

   ```bash
   cd web && npx vercel --prod
   ```

*Check it worked:* `npm run verify:build` prints **this build carries the project its copies report
to** and **and it is the project the website itself talks to**. If it says *the package predates
the stamp*, step 2 has not been run since the stamp — run it again.

That is the arrangement complete: somebody installs Halo from your download page, and a minute
later the machine is on your **Admin → Given out** page, with a switch per feature you can turn
off and a **Cut access** button beside it. A copy from a build made *before* this step never
appears there, and nothing on that machine will say why.

---

## If something is wrong

Run `npm run doctor:web -- --live` first: it asks your project the same questions a browser would,
and it names the page to fix rather than a symptom.

| What you see | What it is | What to do |
|---|---|---|
| The site says "no database yet" | The two values are empty or wrong | Step 3, then press Ctrl+F5 on the page |
| The doctor says the key is a secret key | The wrong key of the two was pasted | Step 3, then rotate the secret key in Supabase |
| The doctor says tables are not in the project | The schema was pasted into a different project, or not run | Step 1.6 to 1.9, in *this* project |
| The doctor says the project does not answer | A typo in the URL, no internet, or a paused project | Free projects pause after seven days of not being used: open Supabase and press **Resume project** |
| Sign-up works but sign-in does not | Confirm Email is on | Step 2.3 |
| `/admin` says you are not an admin | The SQL in step 5 was not run, or the email has a typo | Step 5.3 |
| The reset-password email never arrives | Supabase does not know your domain | Step 2.8 and 2.9, then Step 7 |
| The deploy shows a list of files | Vercel's directory answer was wrong | Step 4.3, answer `./` |
| A copy you handed out never appears on **Given out** | Either the project refuses anonymous sign-ins, or that installer was built before the stamp | Step 2.6, then Step 8 (and check it with `npm run verify:build`) |
| The site is up but the download page says there is nothing to download | The build files were never copied into `web/downloads/` | Step 8.3 |
