-- =============================================================================
-- RENVARA · Migration 0007 · Offers, won value, reminders, push subscriptions
--
-- Additive only: new tables and nullable columns; no existing row changes.
--
--   offers              a sales offer sent within an opportunity. Feeds the
--                       FEEDBACK OVERVIEW (days since sending, until answered).
--   opportunities.won_value
--                       the final amount when a deal is won (estimated_value
--                       stays the estimate). Won/lost dates are closed_at with
--                       status (ADR-0003), unchanged.
--   reminders           a push reminder for exactly one task, lead or
--                       opportunity, at a chosen instant, for one member.
--   push_subscriptions  a member's devices (Web Push endpoints) that receive it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Opportunities: final amount of a won deal.
-- -----------------------------------------------------------------------------
alter table public.opportunities
  add column won_value numeric(15, 2) check (won_value is null or won_value >= 0),
  add constraint opportunities_won_value_only_when_won check (won_value is null or status = 'won');
comment on column public.opportunities.won_value is
  'Final amount of a won deal (same currency). NULL → the estimate (estimated_value) is the won amount. Reported in the period of closed_at.';

-- Same lifecycle as before, plus: the final amount belongs to a win only.
create or replace function private.opportunity_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'active' then
    -- (re)opened
    new.closed_at := null;
    new.lost_reason := null;
    new.won_value := null;
  else
    -- closed (or switched between won/lost): keep a client-supplied closed_at
    -- (back-dating), otherwise stamp now.
    if tg_op = 'INSERT' then
      new.closed_at := coalesce(new.closed_at, now());
    elsif new.closed_at is null or new.closed_at is not distinct from old.closed_at then
      new.closed_at := now();
    end if;
    if new.status = 'won' and tg_op = 'UPDATE' and old.status = 'lost' then
      new.lost_reason := null;
    end if;
    if new.status = 'lost' then
      new.won_value := null;
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Offers
-- -----------------------------------------------------------------------------
create type public.offer_status as enum ('draft', 'sent', 'answered', 'withdrawn');
comment on type public.offer_status is
  'draft: prepared, not sent · sent: waiting for the customer · answered: the customer responded · withdrawn: no longer valid. Only sent offers wait.';

alter type public.activity_type add value if not exists 'offer_answered' after 'offer_sent';

create table public.offers (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  opportunity_id   uuid not null,
  title            text not null check (char_length(btrim(title)) between 1 and 300),
  status           public.offer_status not null default 'draft',
  sent_at          timestamptz,
  answered_at      timestamptz,
  withdrawn_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint offers_org_id_key unique (organization_id, id),
  constraint offers_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete cascade,
  -- Sending is a recorded fact: a sent, answered or withdrawn-after-sending offer keeps sent_at.
  constraint offers_sent_has_sent_at check (status = 'draft' or sent_at is not null),
  constraint offers_draft_not_sent check (status <> 'draft' or sent_at is null),
  constraint offers_answered_has_answered_at check ((status = 'answered') = (answered_at is not null)),
  constraint offers_withdrawn_has_withdrawn_at check ((status = 'withdrawn') = (withdrawn_at is not null)),
  constraint offers_answer_after_sending check (answered_at is null or answered_at >= sent_at)
);

comment on table public.offers is
  'A sales offer within an opportunity (customer via the opportunity). Waiting = sent and not yet answered; a view of a PDF is not an answer. Never deleted when answered.';
comment on column public.offers.sent_at is
  'When the offer was actually sent. Day 1 of the feedback wait (calendar days in the organization''s timezone).';

create index offers_opportunity_idx on public.offers (opportunity_id);
create index offers_org_waiting_idx on public.offers (organization_id, sent_at) where status = 'sent';

create trigger offers_stamp
  before insert or update on public.offers
  for each row execute function private.stamp_tenant_row();

alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;
grant select, insert, update, delete on public.offers to authenticated;
create policy offers_select on public.offers for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy offers_insert on public.offers for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy offers_update on public.offers for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));
create policy offers_delete on public.offers for delete to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}')));

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------
create type public.reminder_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');

create table public.reminders (
  id                 uuid primary key default private.uuid_generate_v7(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id  uuid not null,
  task_id            uuid,
  lead_id            uuid,
  opportunity_id     uuid,
  remind_at          timestamptz not null,
  time_zone          text not null check (private.is_valid_timezone(time_zone)),
  status             public.reminder_status not null default 'pending',
  attempts           smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at    timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint reminders_org_id_key unique (organization_id, id),
  -- Exactly one target, always in the same organization.
  constraint reminders_one_target check (num_nonnulls(task_id, lead_id, opportunity_id) = 1),
  constraint reminders_task_fk foreign key (organization_id, task_id)
    references public.tasks (organization_id, id) on delete cascade,
  constraint reminders_lead_fk foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade,
  constraint reminders_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete cascade,
  constraint reminders_recipient_fk foreign key (organization_id, recipient_user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint reminders_sent_has_delivered_at check ((status = 'sent') = (delivered_at is not null)),
  constraint reminders_cancelled_has_cancelled_at check ((status = 'cancelled') = (cancelled_at is not null))
);

comment on table public.reminders is
  'A push reminder for one task, lead or opportunity. Delivered by the server scheduler (pending → processing → sent | failed); editing reschedules, cancelling stops it. Storing a reminder does not guarantee delivery: that needs a subscribed device.';
comment on column public.reminders.remind_at is
  'The instant to deliver (UTC). time_zone keeps the zone the user chose it in, for display and DST-safe editing.';

create index reminders_due_idx on public.reminders (remind_at) where status = 'pending';
create index reminders_task_idx on public.reminders (task_id) where task_id is not null;
create index reminders_lead_idx on public.reminders (lead_id) where lead_id is not null;
create index reminders_opportunity_idx on public.reminders (opportunity_id) where opportunity_id is not null;

create trigger reminders_stamp
  before insert or update on public.reminders
  for each row execute function private.stamp_tenant_row();

alter table public.reminders enable row level security;
revoke all on public.reminders from anon, authenticated;
grant select, insert, update, delete on public.reminders to authenticated;
-- Members see the organization's reminders; only the recipient or the creator changes one.
create policy reminders_select on public.reminders for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy reminders_update on public.reminders for update to authenticated
  using (
    organization_id in (select private.current_user_org_ids())
    and (recipient_user_id = (select auth.uid()) or created_by = (select auth.uid()))
  )
  with check (organization_id in (select private.current_user_org_ids()));
create policy reminders_delete on public.reminders for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids())
    and (recipient_user_id = (select auth.uid()) or created_by = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- Push subscriptions (one row per device; a user may have several)
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id               uuid primary key default private.uuid_generate_v7(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  platform         text not null default 'web' check (platform in ('web', 'ios', 'android')),
  provider         text not null default 'webpush' check (provider in ('webpush', 'apns', 'fcm', 'expo')),
  endpoint         text not null check (char_length(endpoint) between 1 and 2000),
  p256dh           text check (p256dh is null or char_length(p256dh) <= 200),
  auth             text check (auth is null or char_length(auth) <= 100),
  user_agent       text check (user_agent is null or char_length(user_agent) <= 300),
  enabled          boolean not null default true,
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint push_subscriptions_webpush_keys check (provider <> 'webpush' or (p256dh is not null and auth is not null))
);

comment on table public.push_subscriptions is
  'Devices that receive a member''s push reminders. Private to that member; tokens never leave the server except to the push service.';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where enabled;

create trigger push_subscriptions_stamp
  before insert or update on public.push_subscriptions
  for each row execute function private.stamp_timestamps();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids())
  );
