-- =============================================================================
-- MOBILNE OBAVIJESTI: per-user push notification preferences (seven event
-- types, each on or off), the user's time for deadlines that have a date but no
-- time, and the server's delivery log (one row per notification, idempotent).
--
-- Preferences belong to one member of one organization: two salespeople of the
-- same organization choose independently. A new user has every type off; an
-- existing user who has pending push reminders keeps receiving them
-- (reminder_due is switched on for them below).
--
-- The delivery log is written by the server scheduler only (service role).
-- Members read their own rows; nothing in it is writable from a client.
-- `accepted_at` is when the push service accepted the message: not a device
-- delivery receipt (Web Push has none) and not "read".
-- =============================================================================

create type public.notification_type as enum (
  'offer_viewed',
  'reminder_due',
  'task_deadline',
  'opportunity_deadline',
  'feedback_low',
  'feedback_medium',
  'feedback_high'
);

-- -----------------------------------------------------------------------------
-- Preferences: one row per member and type (absent = off)
-- -----------------------------------------------------------------------------
create table public.notification_preferences (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  type             public.notification_type not null,
  enabled          boolean not null default false,
  -- When it was last switched on (set by the database). Notifications are
  -- prospective: events from before this moment are never sent.
  enabled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint notification_preferences_member_type_key unique (organization_id, user_id, type),
  constraint notification_preferences_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint notification_preferences_enabled_has_enabled_at check (not enabled or enabled_at is not null)
);

comment on table public.notification_preferences is
  'MOBILNE OBAVIJESTI: whether a member receives push notifications of one event type. No row = off. Private to that member.';
comment on column public.notification_preferences.enabled_at is
  'Last time the type was switched on (database clock). Events that happened before it are not notified.';

-- enabled_at comes from the database clock, never from the client.
create or replace function private.notification_preference_enabled_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.enabled_at := now();
  elsif tg_op = 'INSERT' then
    new.enabled_at := null;
  else
    new.enabled_at := old.enabled_at;
  end if;
  return new;
end;
$$;

create trigger notification_preferences_enabled_at
  before insert or update on public.notification_preferences
  for each row execute function private.notification_preference_enabled_at();

create trigger notification_preferences_stamp
  before insert or update on public.notification_preferences
  for each row execute function private.stamp_timestamps();

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids())
  );

-- -----------------------------------------------------------------------------
-- Settings: the time of day for deadlines given as a date only
-- -----------------------------------------------------------------------------
create table public.notification_settings (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  -- A task due on a date without a time, and an opportunity's expected close
  -- date, are notified that day at this time. Null: they are not notified
  -- (no time is ever assumed).
  deadline_time    time,
  time_zone        text not null check (private.is_valid_timezone(time_zone)),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint notification_settings_member_key unique (organization_id, user_id),
  constraint notification_settings_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade
);

comment on table public.notification_settings is
  'MOBILNE OBAVIJESTI: per-member settings. deadline_time is the explicit notification time for date-only deadlines (null = no notification for them).';

create trigger notification_settings_stamp
  before insert or update on public.notification_settings
  for each row execute function private.stamp_timestamps();

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids())
  );

-- -----------------------------------------------------------------------------
-- Delivery log: one row per notification and recipient (server-written)
-- -----------------------------------------------------------------------------
create table public.notification_deliveries (
  id                 uuid primary key default private.uuid_generate_v7(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id  uuid not null,
  type               public.notification_type not null,
  -- The offer, task or opportunity the notification is about.
  source_id          uuid not null,
  -- One business event = one key (e.g. feedback_medium:<offer>:<sent_at>), so
  -- a scheduler run, a retry or a restart can never notify it twice.
  idempotency_key    text not null check (char_length(idempotency_key) between 1 and 300),
  occurred_at        timestamptz not null,
  status             public.reminder_status not null default 'pending',
  attempts           smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at    timestamptz,
  accepted_at        timestamptz,
  devices_accepted   smallint not null default 0 check (devices_accepted >= 0),
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  -- What the lock screen shows: short, no amounts, notes, contacts or links' tokens.
  title              text not null check (char_length(title) between 1 and 120),
  body               text not null check (char_length(body) between 1 and 300),
  url                text not null check (url ~ '^/[^/]' and char_length(url) <= 300),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint notification_deliveries_key unique (organization_id, recipient_user_id, idempotency_key),
  constraint notification_deliveries_recipient_fk foreign key (organization_id, recipient_user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint notification_deliveries_sent_has_accepted_at check ((status = 'sent') = (accepted_at is not null))
);

comment on table public.notification_deliveries is
  'Push notifications of MOBILNE OBAVIJESTI, one per event and recipient (idempotency_key). Written by the server scheduler only. accepted_at = accepted by the push service, not a device receipt.';

create index notification_deliveries_due_idx on public.notification_deliveries (next_attempt_at, created_at)
  where status = 'pending';
create index notification_deliveries_recipient_idx on public.notification_deliveries (recipient_user_id, created_at desc);

create trigger notification_deliveries_stamp
  before insert or update on public.notification_deliveries
  for each row execute function private.stamp_timestamps();

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notification_deliveries to authenticated;
create policy notification_deliveries_own on public.notification_deliveries for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids())
  );

-- -----------------------------------------------------------------------------
-- Existing users: reminders they already set keep arriving
-- -----------------------------------------------------------------------------
insert into public.notification_preferences (organization_id, user_id, type, enabled)
select distinct r.organization_id, r.recipient_user_id, 'reminder_due'::public.notification_type, true
from public.reminders r
where r.status in ('pending', 'processing')
on conflict (organization_id, user_id, type) do nothing;
