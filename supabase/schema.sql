-- Halo — the cloud half.
--
-- This is the whole backend. There is no server of ours: the website talks to Supabase
-- with the anon key, and every rule about who may read what is a row level security
-- policy in this file. That is deliberate. An anon key is public by design, so the only
-- thing standing between one person's messages and another's is what is written below.
--
-- Five tables and the functions that are the only way into two of them:
--
--   profiles     one row per signed-in person, with the name they are known by, and whether
--                they are an admin. Nothing but SQL can set the role
--   devices      one row per Halo install that has been claimed, whether its access has been
--                cut (revoked_at), what it can do (features) and what it is allowed to do
--                (policy). `source = 'fleet'` marks a copy handed out from the download page,
--                which joined by itself under an anonymous account
--   messages     what the desktop app reports, so the owner and an admin can read it
--   audit_log    one row per privileged action. No client may write it: every row comes
--                from a definer function, in the same statement as the change it records
--   app_config   one row for the whole project - the fleet switches - with no policies at
--                all, because the functions below are the only way in
--
-- Eight functions are the API the app and the site call: heartbeat, revoke_device,
-- restore_device, set_device_policy (what one machine is allowed to do), retire_fleet_device
-- (the end of a loan), app_status (readable without an account, which is what the
-- closed-downloads notice relies on), and set_lockdown / set_downloads_open, which are
-- admin-only in the function rather than in the page that calls them. The other two are
-- internal: is_admin for the policies, and handle_new_user, the trigger that gives a new
-- account its profile.
--
-- Apply it with:  supabase db push      (or paste it into the SQL editor)
-- It is safe to run again, and you should after pulling a newer copy: everything is
-- `if not exists`, so it adds what is missing without touching a row.
-- The seed at the bottom makes one email an admin; change it before you run this.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text not null default '',
  -- 'admin' may read every row in the schema. It is set here, not by the client: the
  -- insert policy below never accepts a role, so a signed-in user cannot promote itself.
  role          text not null default 'member' check (role in ('member', 'admin')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table if not exists public.devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null,
  platform           text,             -- win32, darwin, linux
  arch               text,             -- x64, arm64
  app_version        text,
  model              text,             -- which model that install is set to
  -- The pairing code that install is showing, mirrored here so the owner can see it
  -- from a phone without walking to the machine. It is not a secret the website holds:
  -- it is the same short code, and it is useless without reaching that PC.
  pairing_code       text,
  pairing_expires_at timestamptz,
  -- 'account' for a copy somebody signed in with an address of their own, 'fleet' for one handed
  -- out from the download page. It is how the admin panel knows which machines were given away
  -- rather than set up by their owner.
  source             text not null default 'account' check (source in ('account', 'fleet')),
  -- What that install says it can do, in its own words (core/grants.js FEATURES). Reported on
  -- every check-in so the admin panel can draw a switch per feature without keeping a copy of
  -- the catalogue: the app knows what it can do, and a website that guessed would drift.
  features           jsonb not null default '[]'::jsonb,
  -- What it is allowed to do, as a map of feature id to true/false. Null is the default and
  -- means nothing is held back. Written only by set_device_policy, which decides who may.
  policy             jsonb,
  -- Set when access is cut. The install checks this and switches its own remote access
  -- off, which is the only way a web page can close a port on someone's PC. The row is
  -- kept rather than deleted: "we cut this off, here is when" is worth being able to see.
  revoked_at         timestamptz,
  revoked_by         uuid,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references public.devices (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  text        text not null,
  source      text,                    -- desktop, voice, telegram, remote
  created_at  timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid,
  action      text not null,           -- device.revoked, device.restored, device.claimed ...
  target      text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- One row, and the switches that apply to the whole fleet rather than to one machine.
--
--   lockdown        every install stops working and says so, on its next check-in
--   downloads_open   whether the website is still handing out the installers
--
-- A single row is deliberate. "Off for everyone" is one fact, not a per-device column to be
-- kept in step, and a table with one row in it cannot disagree with itself. Nothing but the
-- functions below may write here, which is why there are no write policies at all.
create table if not exists public.app_config (
  id                smallint primary key default 1 check (id = 1),
  lockdown          boolean not null default false,
  lockdown_message  text not null default '',
  lockdown_at       timestamptz,
  lockdown_by       uuid,
  downloads_open    boolean not null default true,
  updated_at        timestamptz not null default now()
);

insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- Columns added after the first release.
--
-- `create table if not exists` does nothing at all to a table that already exists, so anything
-- added to the shape above has to be added again here, in the same file. A project that ran an
-- earlier copy of this schema would otherwise be missing these for ever, and the symptom would
-- be an app answering 404 to its own check-in.
alter table public.devices add column if not exists source   text not null default 'account';
alter table public.devices add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.devices add column if not exists policy   jsonb;

-- The dashboard and the admin panel both read the newest first, and both are filtered by
-- owner, so these are the indexes the queries actually use.
create index if not exists devices_user_idx   on public.devices (user_id, created_at desc);
create index if not exists messages_user_idx  on public.messages (user_id, created_at desc);
create index if not exists messages_dev_idx   on public.messages (device_id, created_at desc);
create index if not exists audit_created_idx  on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Who is an admin
-- ---------------------------------------------------------------------------

-- Security definer, and `stable`: the check runs once per statement rather than once per
-- row, and it reads profiles without going through profiles' own policies, which is what
-- keeps the policy below from recursing into itself.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- A profile appears with the account
-- ---------------------------------------------------------------------------

-- Signing up writes a row into auth.users; this gives it the matching profile, taking the
-- name from the signup metadata so the admin panel has something better to show than an
-- address. Without it every screen would need a null check for "this person has no name".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles   enable row level security;
alter table public.devices    enable row level security;
alter table public.messages   enable row level security;
alter table public.audit_log  enable row level security;
alter table public.app_config enable row level security;

-- app_config: readable by nobody directly, and written by nobody directly. It is switched
-- off by default and left that way on purpose: the only way in is app_status() for reading,
-- and set_lockdown()/set_downloads_open() for writing, and both of those decide for
-- themselves who is allowed. A table with no policies is the shortest way to say "this row
-- is not the browser's to touch".

-- profiles: your own row, and an admin reads all of them.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id)
  -- The role column is left out on purpose: a policy that allowed it would be a client
  -- promoting itself to admin. Changing a role is a SQL statement, run by a person.
  with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));

-- devices: yours to create and read; the cutting of access goes through the functions below
-- so that it can also be written to the audit log in the same transaction.
drop policy if exists "devices: read own" on public.devices;
create policy "devices: read own" on public.devices
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "devices: insert own" on public.devices;
create policy "devices: insert own" on public.devices
  for insert with check (auth.uid() = user_id);

drop policy if exists "devices: update own" on public.devices;
create policy "devices: update own" on public.devices
  for update using (auth.uid() = user_id)
  -- revoked_at is set by revoke_device(), never by a bare update from the browser, so the
  -- one action that matters cannot be performed without a record of who did it.
  with check (auth.uid() = user_id and revoked_at is null);

drop policy if exists "devices: delete own" on public.devices;
create policy "devices: delete own" on public.devices
  for delete using (auth.uid() = user_id);

-- messages: the desktop app reports them, the owner reads them back, an admin reads all.
drop policy if exists "messages: read own" on public.messages;
create policy "messages: read own" on public.messages
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "messages: insert own" on public.messages;
create policy "messages: insert own" on public.messages
  for insert with check (
    auth.uid() = user_id
    -- A message has to be attributed to one of your own devices, or the device column
    -- becomes a way to file text under somebody else's machine.
    and (device_id is null or exists (
      select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()
    ))
  );

drop policy if exists "messages: delete own" on public.messages;
create policy "messages: delete own" on public.messages
  for delete using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- audit: readable, never writable from a client. Every row comes from a definer function.
drop policy if exists "audit: read own" on public.audit_log;
create policy "audit: read own" on public.audit_log
  for select using (actor = auth.uid() or public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- What the desktop app calls
-- ---------------------------------------------------------------------------

-- Claim a device, or say hello again with one already claimed.
--
-- One call rather than two: an install that has been running for weeks has to be able to
-- report itself without the website having to know it first, and the answers it wants back are
-- the same either way: whether its access has been cut, and what it is allowed to do.
--
-- The old five-argument signature is dropped rather than left beside the new one. Two overloads
-- of one name is how PostgREST starts answering a call with "no such function" depending on
-- which one it resolved to, and that failure looks exactly like a broken project.
--
-- `p_features` is what that install says it can do, reported by the install itself; the admin
-- panel draws its switches from it. `policy` comes back the other way: null means nothing is
-- held back, which is the default for every machine nobody has restricted.
drop function if exists public.heartbeat(text, text, text, text, text);
create or replace function public.heartbeat(
  device_name  text,
  p_platform   text default null,
  p_arch       text default null,
  p_version    text default null,
  p_model      text default null,
  p_source     text default null,
  p_features   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  dev  public.devices;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into dev
    from public.devices d
   where d.user_id = uid and d.name = device_name and d.revoked_at is null
   order by d.created_at desc
   limit 1;

  if dev.id is null then
    insert into public.devices (user_id, name, platform, arch, app_version, model, source, features, last_seen_at)
    values (uid, device_name, p_platform, p_arch, p_version, p_model,
            case when p_source = 'fleet' then 'fleet' else 'account' end,
            coalesce(p_features, '[]'::jsonb), now())
    returning * into dev;

    insert into public.audit_log (actor, action, target, detail)
    values (uid, 'device.claimed', dev.id::text,
            jsonb_build_object('name', device_name, 'platform', p_platform, 'source', dev.source));
  else
    update public.devices
       set last_seen_at = now(),
           platform = coalesce(p_platform, platform),
           arch = coalesce(p_arch, arch),
           app_version = coalesce(p_version, app_version),
           model = coalesce(p_model, model),
           -- One way only: a machine that was handed out does not become an account's own by
           -- checking in again. Only retire_fleet_device settles that, when somebody signs in.
           source = case when p_source = 'fleet' then 'fleet' else source end,
           features = coalesce(p_features, features)
     where id = dev.id
     returning * into dev;
  end if;

  update public.profiles set last_seen_at = now() where id = uid;

  -- The install is told about a cut-off here, on its own schedule, rather than being
  -- reached into: nothing on the web can open a socket on somebody's PC, so the PC asks.
  -- The fleet switches ride along on the same answer, so one check-in settles everything
  -- there is to know: this machine, and every machine.
  return jsonb_build_object(
    'ok', true,
    'device_id', dev.id,
    'revoked', dev.revoked_at is not null,
    'revoked_at', dev.revoked_at,
    -- What this machine is allowed to do, so the app can apply it without a second request.
    'policy', dev.policy,
    'source', dev.source,
    'locked', coalesce((public.app_status() ->> 'lockdown')::boolean, false),
    'lock_message', coalesce(public.app_status() ->> 'lockdown_message', ''),
    'server_time', now()
  );
end;
$$;

-- The fleet switches, as the world is allowed to see them.
--
-- Readable without signing in, because the download page has to know whether downloads are
-- being offered before anyone has an account, and the app's check-in reads it too. It holds
-- no secret: two booleans and a sentence the operator wrote for the people affected.
--
-- Written with dynamic SQL and a guard on the table existing, so this works against a project
-- where the schema was applied before app_config existed. An app answering with a raw 500 to
-- every message is a far worse failure than one that reports "not locked" and keeps going.
create or replace function public.app_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  locked  boolean := false;
  note    text    := '';
  since   timestamptz;
  open_dl boolean := true;
begin
  if to_regclass('public.app_config') is not null then
    execute 'select lockdown, lockdown_message, lockdown_at, downloads_open from public.app_config where id = 1'
      into locked, note, since, open_dl;
  end if;
  return jsonb_build_object(
    'lockdown', coalesce(locked, false),
    'lockdown_message', coalesce(note, ''),
    'lockdown_at', since,
    'downloads_open', coalesce(open_dl, true),
    'server_time', now()
  );
end;
$$;

-- Switch the whole fleet off, or back on. An admin's action, and the heaviest one here: what
-- it does is make every install on this project stop, which is the point of it.
--
-- Nothing on the web reaches into a PC to do this: the site writes a fact, and each install
-- finds it out when it next asks. `message` is shown to the people affected, so write one.
create or replace function public.set_lockdown(active boolean, message text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  note  text := coalesce(nullif(btrim(coalesce(message, '')), ''), '');
  fleet integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_admin(uid) then
    raise exception 'only an admin can switch every install off' using errcode = '42501';
  end if;
  if active and length(note) < 4 then
    raise exception 'a lockdown needs a message: it is the only thing the people affected will see'
      using errcode = '22023';
  end if;

  insert into public.app_config (id, lockdown, lockdown_message, lockdown_at, lockdown_by, updated_at)
  values (1, active, note,
          case when active then now() end,
          case when active then uid end,
          now())
  on conflict (id) do update
     set lockdown         = active,
         lockdown_message = note,
         lockdown_at      = case when active then now() else null end,
         lockdown_by      = case when active then uid else null end,
         updated_at       = now();

  select count(*) into fleet from public.devices where revoked_at is null;

  insert into public.audit_log (actor, action, target, detail)
  values (uid, case when active then 'fleet.locked' else 'fleet.unlocked' end, 'fleet',
          jsonb_build_object('message', note, 'installs', fleet));

  return public.app_status() || jsonb_build_object('ok', true, 'installs', fleet);
end;
$$;

-- Stop handing out the installers, or start again. Separate from the lockdown because the two
-- are asked at different moments: this one decides whether new people can get the app at all,
-- and it is a website decision, not an app one.
create or replace function public.set_downloads_open(open boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_admin(uid) then
    raise exception 'only an admin can close the downloads' using errcode = '42501';
  end if;

  insert into public.app_config (id, downloads_open, updated_at)
  values (1, open, now())
  on conflict (id) do update set downloads_open = open, updated_at = now();

  insert into public.audit_log (actor, action, target, detail)
  values (uid, case when open then 'downloads.opened' else 'downloads.closed' end, 'website',
          '{}'::jsonb);

  return public.app_status() || jsonb_build_object('ok', true);
end;
$$;

-- Cut a device off: its own Halo stops accepting remote access on its next check.
create or replace function public.revoke_device(target_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  owned public.devices;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into owned from public.devices where id = target_device;
  if owned.id is null then
    raise exception 'no such device' using errcode = 'P0002';
  end if;
  -- The owner, or an admin. Nobody else can reach this row at all, but the check is here
  -- as well because this function runs as its definer and would otherwise bypass RLS.
  if owned.user_id <> uid and not public.is_admin(uid) then
    raise exception 'not yours to cut off' using errcode = '42501';
  end if;

  update public.devices
     set revoked_at = now(), revoked_by = uid
   where id = target_device and revoked_at is null
   returning * into owned;

  insert into public.audit_log (actor, action, target, detail)
  values (uid, 'device.revoked', target_device::text,
          jsonb_build_object('name', owned.name, 'owner', owned.user_id, 'as_admin', owned.user_id <> uid));

  return jsonb_build_object('ok', true, 'device_id', target_device, 'revoked_at', owned.revoked_at);
end;
$$;

-- Let it back in. The owner's action, not the admin's: an admin can cut access off, and
-- restoring it is the machine owner deciding to trust the site again.
create or replace function public.restore_device(target_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  owned public.devices;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into owned from public.devices where id = target_device;
  if owned.id is null then raise exception 'no such device' using errcode = 'P0002'; end if;
  if owned.user_id <> uid then
    raise exception 'not yours to restore' using errcode = '42501';
  end if;

  update public.devices
     set revoked_at = null, revoked_by = null
   where id = target_device
   returning * into owned;

  insert into public.audit_log (actor, action, target, detail)
  values (uid, 'device.restored', target_device::text, jsonb_build_object('name', owned.name));

  return jsonb_build_object('ok', true, 'device_id', target_device);
end;
$$;

-- What one machine is allowed to do, set from the website.
--
-- The policy is a map of feature id to true/false, in the shape core/grants.js reads, and it is
-- jsonb rather than a column per feature for one reason: the catalogue belongs to the app. A
-- feature added in a later release is a key in this object, not a migration of a table the site
-- cannot see. An install that does not recognise a key ignores it, and one that has a feature
-- this policy does not mention treats it as off, so a stale policy cannot widen a copy.
--
-- Who may: an admin on any machine on the project, and a machine's owner on its own — the same
-- rule revoke_device uses, and for the same reason. `null`, or an empty object, clears it.
create or replace function public.set_device_policy(target_device uuid, next jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  owned public.devices;
  clean jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if next is not null and jsonb_typeof(next) <> 'object' then
    raise exception 'a policy is an object of feature id to true or false' using errcode = '22023';
  end if;
  if next is not null and (select count(*) from jsonb_object_keys(next)) > 60 then
    raise exception 'that is not a policy: too many keys' using errcode = '22023';
  end if;

  select * into owned from public.devices where id = target_device;
  if owned.id is null then raise exception 'no such device' using errcode = 'P0002'; end if;
  if owned.user_id <> uid and not public.is_admin(uid) then
    raise exception 'not yours to restrict' using errcode = '42501';
  end if;

  -- An empty object is the same statement as null. Storing `{}` instead would leave the app
  -- holding something that is truthy where it checks for a policy, and "allowed nothing" is a
  -- very different machine from one nobody has restricted.
  clean := case when next is null or next = '{}'::jsonb then null else next end;

  update public.devices set policy = clean where id = target_device
   returning * into owned;

  insert into public.audit_log (actor, action, target, detail)
  values (uid, 'device.policy', target_device::text,
          jsonb_build_object('name', owned.name, 'policy', clean, 'as_admin', owned.user_id <> uid));

  return jsonb_build_object('ok', true, 'device_id', target_device, 'policy', clean);
end;
$$;

-- End a loan.
--
-- A copy handed out from the download page joins under an anonymous account. The moment the
-- person holding it signs in with an address of their own it stops being a loan — and that has
-- to be said *before* the sign-in replaces the session, because afterwards nothing can reach the
-- row to close it and the operator's list keeps a machine that is idle only because it no longer
-- exists.
--
-- As narrow as it can be: only the caller's own row, only while it is still marked as handed
-- out, and only the two revocation columns. Nothing is deleted — "this machine was handed over,
-- then its new owner made it theirs" is worth being able to read back.
create or replace function public.retire_fleet_device()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  dev public.devices;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into dev
    from public.devices d
   where d.user_id = uid and d.source = 'fleet' and d.revoked_at is null
   order by d.created_at desc
   limit 1;
  if dev.id is null then return jsonb_build_object('ok', true, 'nothing_to_do', true); end if;

  update public.devices
     set revoked_at = now(), revoked_by = uid
   where id = dev.id
   returning * into dev;

  insert into public.audit_log (actor, action, target, detail)
  values (uid, 'device.retired', dev.id::text,
          jsonb_build_object('name', dev.name, 'why', 'signed in with an account of its own'));

  return jsonb_build_object('ok', true, 'device_id', dev.id);
end;
$$;

revoke all on function public.revoke_device(uuid) from public;
revoke all on function public.restore_device(uuid) from public;
revoke all on function public.set_device_policy(uuid, jsonb) from public;
revoke all on function public.retire_fleet_device() from public;
revoke all on function public.set_lockdown(boolean, text) from public;
revoke all on function public.set_downloads_open(boolean) from public;
revoke all on function public.app_status() from public;
grant execute on function public.revoke_device(uuid) to authenticated;
grant execute on function public.restore_device(uuid) to authenticated;
grant execute on function public.heartbeat(text, text, text, text, text, text, jsonb) to authenticated;
-- Both check for themselves who is asking: an admin or the machine's owner for a policy, and
-- nothing but the caller's own handed-out row for a retirement.
grant execute on function public.set_device_policy(uuid, jsonb) to authenticated;
grant execute on function public.retire_fleet_device() to authenticated;
-- Admin-only in the sense that the functions check is_admin() themselves; granting execute to
-- authenticated is what lets an admin call them at all, and a member's call is refused inside.
grant execute on function public.set_lockdown(boolean, text) to authenticated;
grant execute on function public.set_downloads_open(boolean) to authenticated;
-- And this one to everybody, signed in or not, because the download page asks it before
-- anybody has an account.
grant execute on function public.app_status() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: make yourself an admin
-- ---------------------------------------------------------------------------
--
-- Replace the address, run the whole file, then sign up with it. Doing it after signing up
-- also works: the update finds the existing profile.
--
--   insert into public.profiles (id, email)
--   select id, email from auth.users where email = 'you@example.com'
--   on conflict (id) do update set email = excluded.email;
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
