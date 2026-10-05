# What Supabase actually is, and what Halo does with it

`QUICKSTART.md` tells you what to click. This file explains what the thing you are clicking *is*,
what each part does for Halo, and why the two keys are treated so differently. No prior knowledge
assumed: there are four ideas, and everything else follows from them.

---

## The short version

Supabase is a **database**, a **login system**, and a **front door to both** — all run for you, at
an address like `https://abcdefgh.supabase.co`.

Halo has no server of its own. There is no code of ours running anywhere in the cloud, no
process to restart, nothing to pay for while it sits idle. The website is files, and the desktop
app is a program on your PC; both of them talk **straight to Supabase** over HTTPS.

So Supabase is doing three jobs that a bigger project would build itself:

| Job | What that means for Halo |
|---|---|
| **A database** | Where your messages, your machines and your settings in the cloud live |
| **Accounts** | Email, password, password reset, sessions — you never handle a password |
| **An API in front of both** | Every read and write is one HTTPS request, which is why the site is just HTML and JavaScript |

A useful analogy: renting a filing cabinet in a building that also has a receptionist. The
building is Supabase. The cabinets are tables. The receptionist is the API plus the policies
below — you do not get to walk in and open a drawer yourself.

---

## The four ideas

### 1. A table is a spreadsheet

A **table** has columns (the headings) and rows (the entries). Halo has five. In SQL terms:

```sql
select * from messages where user_id = '...'  -- "show me my rows"
```

That is all "querying the database" means. The Supabase **Table Editor** shows you these as
grids; the **SQL Editor** runs statements like the one above.

The important one: **the rules live in the database, not in the website.** A page can be edited
in your browser's dev tools, so a rule that lives in a page is a suggestion. A rule that lives in
the database applies to everybody, including somebody who has copied your key and is calling the
API with `curl`.

### 2. The URL you were given is the door

`https://abcdefgh.supabase.co` is not a website — nobody browses it. It is the API. Everything
goes through paths under it:

| Path | What it is |
|---|---|
| `/rest/v1/messages` | the rows of a table |
| `/rest/v1/rpc/heartbeat` | one of the functions in `schema.sql` |
| `/auth/v1/signup`, `/auth/v1/token` | accounts |
| `/auth/v1/settings` | what the project allows — public, which is why the doctor can ask it |

This is why "the site has no database yet" is really "this URL did not answer as expected", and
why the doctor can tell 401 (the door answered, the key was wrong) from 404 (nothing at that
address: the Data API is switched off, or the whole project is paused).

### 3. A key says *which app* is knocking — not *who* is asking

This is the idea that trips everybody up, and the reason the next section exists. Your project
has two kinds of key, and **the safe one is safe on purpose**:

- the **publishable key** identifies your website to Supabase. It is in the page source of every
  page you deploy, and it is meant to be. Anybody may have it.
- the **secret key** is a master key. It ignores every rule below. It must never be in a page,
  an app, or a repository.

Neither key says *who* is using the site. That is the next part.

### 4. Row level security is the lock

**Row level security** (RLS) is a rule attached to a table that the database applies to every
query, as if somebody had added `where ...` to it before running it. It cannot be turned off from
the browser. It is switched on for all five of Halo's tables, and the suite fails if that ever
stops being true.

Policies are written in terms of `auth.uid()` — "the id of the signed-in person making this
request". When a browser calls the API, Supabase works out who is asking from the **login token
in the request** — not from the key. So:

```
publishable key + no login      -> role "anon"           (a stranger)
publishable key + your login    -> role "authenticated"  (you)
secret key                      -> role "service_role"   (everything, always)
```

RLS policies are matched against the role, which is how the same public key can be safe: a
stranger holding it reaches only what the `anon` and `authenticated` policies allow, and those
were written by you, in `schema.sql`, on purpose.

---

## The keys, exactly

| Key on the **Settings → API Keys** page | Name in older projects | Postgres role | Who may see it |
|---|---|---|---|
| **Publishable**, `sb_publishable_…` | **`anon` `public`** (a JWT, `eyJ…`) | `anon` / `authenticated` | anybody — it is published by design |
| **Secret**, `sb_secret_…` | **`service_role`** (a JWT, `eyJ…`) | `service_role` | nobody outside a server you control |

`service_role` has a Postgres attribute called `BYPASSRLS`: *before* any policy is considered, it
is excused from all of them. That is the entire difference. Supabase even refuses a secret key
sent from a browser address, but that is a second lock on a door that should never have been
built — the key would still be in your page source, which is public.

**So why is the publishable key safe to paste into a file that every visitor downloads?** Because
of what it cannot do:

- It cannot read another person's rows: `messages: read own` is `auth.uid() = user_id`.
- It cannot read the switches directly: `app_config` has **no policies at all**, so no browser
  can touch that row. Reading it goes through the `app_status()` function, which decides for
  itself what may be shared.
- It cannot promote anybody: the `profiles` update policy deliberately leaves `role` out, and
  `with check (... role = (select p.role ...))` means a request that tries to change it fails.
- It cannot cut a machine off quietly: `devices: update own` refuses to set `revoked_at` at all
  (`with check (... and revoked_at is null)`), so the only way is the `revoke_device()` function,
  which writes the audit row in the same transaction.
- It cannot write an audit entry: there is a read policy and no insert policy, so `audit_log`
  rows can only come from functions that run with the definer's rights.

Three things *would* make the public key dangerous, and all three are things you would have to
do deliberately: turn RLS off on a table, write a policy like `using (true)`, or put the secret
key in the page. The website's own checks look for the first and the third.

---

## Halo's five tables, and who can see what

| Table | Holds | Who can read it |
|---|---|---|
| `profiles` | one row per account: name, email, `role` (`member`/`admin`) | your own row; admins read all |
| `devices` | one row per Halo install that has signed in: name, platform, `last_seen_at`, `revoked_at` | yours; admins read all |
| `messages` | what the desktop app reports: `user`/`assistant`, the text, where it came from | yours; admins read all |
| `audit_log` | one row per privileged action: who cut what, who switched the fleet off | the actor's own rows; admins read all |
| `app_config` | one single row: `lockdown`, its message, `downloads_open` | **nobody directly.** Only through `app_status()` |

That last row is the trick worth understanding: a table with no policies is the shortest way to
say *"this row is not the browser's to touch"*. It is readable, and writable, only through
functions that check who is asking.

---

## The six functions (and the two the database uses itself)

A **database function** is a small named routine that lives inside the database and runs with its
own rules. Halo has six the app and site call, and two internal ones:

| Function | What it does | Why it is a function rather than a query |
|---|---|---|
| `heartbeat(name, platform, arch, version, model)` | An install says "I am here" and is told whether it may work | It creates the row the first time and updates it afterwards, in one call, and returns the fleet state with it |
| `revoke_device(id)` | Cut one machine's access off | Must also write the audit row; refuses to act on somebody else's machine |
| `restore_device(id)` | Let that machine back in | **Owner only**, never an admin — an admin can cut, only the owner can undo |
| `app_status()` | The fleet switches, and the lockdown message | Readable **without signing in**, which is what lets a visitor see "downloads are closed" |
| `set_lockdown(on, message)` | Switch every install off, or back on | Admin-only *inside the function*; refuses a message shorter than four characters, because that sentence is all the affected people see |
| `set_downloads_open(on)` | Stop or restart handing out installers | Admin-only, and writes `downloads.closed`/`downloads.opened` to the audit log |
| `is_admin(uid)` | internal: is this account an admin? | `security definer` and `stable`, so the check does not recurse into the policies it is used by |
| `handle_new_user()` | internal: gives every new account its `profiles` row | Runs automatically on signup, so no screen needs a "this person has no name" branch |

---

## Four things that happen, step by step

**A person signs up.** The site sends the email and password to Supabase (`/auth/v1/signup`).
Supabase stores a hashed password — *you* never see it, and neither does Halo — and creates a row
in its own `auth.users` table. A trigger then runs `handle_new_user()`, which writes the matching
`profiles` row. The browser keeps a **session token**, which is what "signed in" means from then
on. (If *Confirm Email* is on, no token is issued until they follow the link — which is exactly
why step 2 of the quickstart turns it off.)

**An install reports in.** In the desktop app, **Settings → Account** holds the project URL, the
publishable key, and the session of whoever signed in there. Every check-in calls `heartbeat()`,
which finds the row for that machine (or makes it) and answers with one JSON object:

```json
{ "ok": true, "device_id": "...", "revoked": false, "locked": false, "lock_message": "" }
```

That answer is the whole remote-control channel — and notice the direction: **the PC asks, the
website never reaches out.** Nothing on the web can open a socket on your machine, which is why
"cut access" is honest and why the app has to be running to be stopped.

**You talk to Halo.** The app reports the exchange with an insert into `messages`, along with
which machine it came from. The policy checks that you are the user *and* that the device belongs
to you, so a stolen key cannot file text under somebody else's machine.

**You cut a machine off.** `/admin` or `/app` calls `revoke_device()`. That sets
`devices.revoked_at` and writes a `audit_log` row in the same transaction. On its next check-in,
`heartbeat()` tells the app `"revoked": true`, and the app switches its own remote access off.
**Switch everyone off** is the same shape with one difference: `set_lockdown()` writes the single
`app_config` row, and every install sees `"locked": true` plus your sentence. The app keeps
checking in — that is how it learns you changed your mind — which is why the whole thing is
reversible without touching anybody's PC.

---

## The dashboard pages you will actually use

| Where | What it is for |
|---|---|
| **SQL Editor** | paste and run `supabase/schema.sql`, and statements like step 5's `update` |
| **Table Editor** | look at the rows: who signed up, which machines, what messages |
| **Authentication → Users** | the accounts Supabase holds |
| **Authentication → Sign In / Providers → Email** | *Confirm Email* and *Allow new users to sign up* |
| **Authentication → URL Configuration** | *Site URL* and *Redirect URLs* — what password-reset links depend on |
| **Settings → API Keys** | the Project URL, the publishable key, and the secret key you must not use |
| **Settings → API** | the Data API switch. Off means the site cannot work at all |
| **Project Settings / General** | **Resume project**, when the free plan has paused it |

---

## Why "no database" a week later

A free project is **paused after seven days of inactivity**, and a paused project answers every
request as if it did not exist. It is not deleted: it takes a backup and keeps its data, and
**Resume project** brings it back with nothing lost. Two limits come with the free plan: only two
projects can be active at once, and paused ones do not count.

This site is static and idle between visits, so it will happen. The quickest way to tell it apart
from a wrong key:

| What the doctor says | What it means | The fix |
|---|---|---|
| `the project URL does not answer` with `ENOTFOUND` | The address is wrong, or you are offline | Re-copy the Project URL |
| `404` from `/rest/v1/` | The Data API is off, or the project is paused | Check the switch; otherwise **Resume project** |
| `401` | Right address, wrong key | Re-copy the publishable key |
| `Could not find the table 'public.profiles'` | The schema was never run *in this project* | Step 1 of the quickstart, in this project |

---

## What Supabase is not, here

- **Not a server of ours.** No Vercel functions, no cron jobs, no queue. Every read and write is
  the browser talking to Supabase under the policies above.
- **Not a way to reach your PC.** It stores facts. The desktop app reads them and decides what to
  do; the website can only write a row and wait for the next check-in.
- **Not something you have to keep paying for.** The free tier is genuinely enough for one person
  and a handful of machines. The limits above are the price.
