-- =============================================================================
-- RENVARA · IZVJEŠTAJI v1.0 (ADR-0015)
--
-- Additive only: new rights, two new tables, one view, one function. No
-- existing row is changed except the rights catalog entry of reports.view
-- (it now requires opportunities.view, as a report is made of opportunities).
--
--   rights                        reports.sales_reps (comparing representatives,
--                                 not a Korisnik default), reports.email (sending a
--                                 report as a PDF attachment)
--   opportunity_status_history    every status change of an opportunity (created,
--                                 won, lost, reopened), appended by a trigger;
--                                 existing deals are rebuilt from created_at and
--                                 closed_at (source = 'backfill'), never from
--                                 updated_at
--   report_email_log              who sent which report to whom and how it ended;
--                                 written by the server (service role) only
--   report_closed_opportunities   the canonical rows of every report: closed
--                                 deals with their revenue / potential, by the
--                                 same rules as apps/beta-web/src/reports
--   report_outcome_totals()       WON / LOST counts, sums and rates for a period
--
-- Report rules (the same in the BETA server's report engine):
--   WON/LOST = current status; date = closed_at (cleared on reopen); revenue =
--   coalesce(won_value, estimated_value) of WON deals; LOST potential =
--   estimated_value; EUR only in sums; rates N/P (null) without closed deals;
--   periods are calendar days in the organization's timezone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rights
-- -----------------------------------------------------------------------------
insert into private.permission_definitions (key, group_key, sort_order, admin_only, default_grant, requires) values
  ('reports.sales_reps',          'modules',        64, false, false, '{reports.view}'),
  ('reports.email',               'modules',        65, false, true,  '{reports.view}');

update private.permission_definitions
   set requires = '{opportunities.view}'
 where key = 'reports.view';

-- Members who could open reports may also e-mail them; administrators also
-- compare representatives (new administrators get every right by the trigger).
insert into public.member_permissions (organization_id, user_id, permission_key)
select mp.organization_id, mp.user_id, 'reports.email'
  from public.member_permissions mp
 where mp.permission_key = 'reports.view'
on conflict do nothing;

insert into public.member_permissions (organization_id, user_id, permission_key)
select m.organization_id, m.user_id, 'reports.sales_reps'
  from public.organization_members m
 where m.role = 'admin'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- opportunity_status_history
-- -----------------------------------------------------------------------------
create table public.opportunity_status_history (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  opportunity_id   uuid not null,
  from_status      public.opportunity_status,
  to_status        public.opportunity_status not null,
  -- the amount at that moment: a win's final amount (else the estimate), otherwise the estimate
  amount           numeric(15, 2),
  currency         char(3),
  owner_user_id    uuid,
  -- when the change was recorded, and the deal's closed_at after it (null while active)
  changed_at       timestamptz not null default now(),
  closed_at        timestamptz,
  changed_by       uuid references public.profiles (id) on delete set null,
  source           text not null default 'app' check (source in ('app', 'backfill')),
  constraint opportunity_status_history_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete cascade,
  constraint opportunity_status_history_changes check (from_status is distinct from to_status)
);

comment on table public.opportunity_status_history is
  'Every status change of an opportunity (ADR-0015), appended by a trigger, never changed. Reports count a deal by its CURRENT status and closed_at; this is the history behind it. source = backfill: rebuilt from created_at / closed_at of deals that existed before the table.';

create index opportunity_status_history_deal_idx
  on public.opportunity_status_history (organization_id, opportunity_id, changed_at);
create index opportunity_status_history_status_idx
  on public.opportunity_status_history (organization_id, to_status, changed_at);

create or replace function private.record_opportunity_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.opportunity_status_history (
    organization_id, opportunity_id, from_status, to_status, amount, currency,
    owner_user_id, closed_at, changed_by, source)
  values (
    new.organization_id, new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    case when new.status = 'won' then coalesce(new.won_value, new.estimated_value)
         else new.estimated_value end,
    new.currency, new.owner_user_id, new.closed_at,
    coalesce((select auth.uid()), new.updated_by),
    'app');
  return null;
end;
$$;

revoke all on function private.record_opportunity_status() from public;

create trigger opportunities_status_history
  after insert or update of status on public.opportunities
  for each row execute function private.record_opportunity_status();

-- Existing deals: their first status at created_at and, when closed, the close
-- at closed_at. A deal closed at its creation starts in that status.
insert into public.opportunity_status_history (
  organization_id, opportunity_id, from_status, to_status, amount, currency,
  owner_user_id, changed_at, closed_at, changed_by, source)
select o.organization_id, o.id, null,
       case when o.status <> 'active' and o.closed_at = o.created_at then o.status else 'active' end,
       case when o.status = 'won' and o.closed_at = o.created_at
            then coalesce(o.won_value, o.estimated_value) else o.estimated_value end,
       o.currency, o.owner_user_id, o.created_at,
       case when o.status <> 'active' and o.closed_at = o.created_at then o.closed_at end,
       o.created_by, 'backfill'
  from public.opportunities o;

insert into public.opportunity_status_history (
  organization_id, opportunity_id, from_status, to_status, amount, currency,
  owner_user_id, changed_at, closed_at, changed_by, source)
select o.organization_id, o.id, 'active', o.status,
       case when o.status = 'won' then coalesce(o.won_value, o.estimated_value) else o.estimated_value end,
       o.currency, o.owner_user_id, o.closed_at, o.closed_at, o.updated_by, 'backfill'
  from public.opportunities o
 where o.status <> 'active' and o.closed_at is not null and o.closed_at <> o.created_at;

alter table public.opportunity_status_history enable row level security;
revoke all on public.opportunity_status_history from anon, authenticated;
grant select on public.opportunity_status_history to authenticated;

create policy opportunity_status_history_select on public.opportunity_status_history
  for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('opportunities.view')));

-- Append-only: no client writes (no policies, no grants); the trigger writes.
create trigger opportunity_status_history_append_only
  before update on public.opportunity_status_history
  for each row execute function private.forbid_audit_change();

-- -----------------------------------------------------------------------------
-- report_email_log
-- -----------------------------------------------------------------------------
create table public.report_email_log (
  id                   uuid primary key default private.uuid_generate_v7(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  sent_by              uuid references public.profiles (id) on delete set null,
  recipient            text not null check (char_length(recipient) between 3 and 254 and recipient ~ '^[^@\s]+@[^@\s]+$'),
  report_type          text not null check (report_type in ('revenue', 'quarters', 'won_lost', 'sales_reps')),
  period_from          date,
  period_to            date,
  attachment_name      text not null check (char_length(attachment_name) between 5 and 150),
  status               text not null check (status in ('sent', 'failed')),
  provider             text not null check (char_length(provider) <= 40),
  provider_message_id  text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  error                text check (error is null or char_length(error) <= 100),
  created_at           timestamptz not null default now(),
  constraint report_email_log_period check (period_to is null or period_from is null or period_to >= period_from)
);

comment on table public.report_email_log is
  'Reports sent by e-mail (ADR-0015): when, by whom, to whom, which report and period, and whether the e-mail service accepted it. Never the message text, the PDF or service keys. Written by the server only; append-only.';

create index report_email_log_org_idx on public.report_email_log (organization_id, created_at desc);

alter table public.report_email_log enable row level security;
revoke all on public.report_email_log from anon, authenticated;
grant select on public.report_email_log to authenticated;

-- A member with reports.email sees their own sends; owners and administrators all of the organization's.
create policy report_email_log_select on public.report_email_log
  for select to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_permission('reports.email'))
    and (
      sent_by = (select auth.uid())
      or exists (
        select 1 from public.organization_members m
         where m.organization_id = report_email_log.organization_id
           and m.user_id = (select auth.uid())
           and m.status = 'active'
           and m.role in ('owner', 'admin')
      )
    )
  );

create trigger report_email_log_append_only
  before update on public.report_email_log
  for each row execute function private.forbid_audit_change();

-- -----------------------------------------------------------------------------
-- report_closed_opportunities: the rows every report is made of
-- -----------------------------------------------------------------------------
create view public.report_closed_opportunities
with (security_invoker = true)
as
select
  o.organization_id,
  o.id                                   as opportunity_id,
  o.title,
  o.status,
  o.closed_at,
  (o.closed_at at time zone org.timezone)::date as closed_date,
  case when o.status = 'won' then coalesce(o.won_value, o.estimated_value)
       else o.estimated_value end        as amount,
  coalesce(o.currency, org.default_currency) as currency,
  o.company_id,
  c.name                                 as company_name,
  o.lead_id,
  o.owner_user_id
from public.opportunities o
join public.organizations org on org.id = o.organization_id
left join public.companies c on c.organization_id = o.organization_id and c.id = o.company_id
where o.status in ('won', 'lost')
  and o.closed_at is not null
  and private.has_permission(o.organization_id, 'reports.view')
  and private.has_permission(o.organization_id, 'opportunities.view');

comment on view public.report_closed_opportunities is
  'Closed deals as the reports count them (ADR-0015): current status, closed_at and its calendar day in the organization''s timezone, amount = revenue of a WON deal (won_value, else the estimate) or the potential of a LOST one. Row level security of opportunities applies (security_invoker), and the caller needs reports.view and opportunities.view.';

revoke all on public.report_closed_opportunities from anon, authenticated;
grant select on public.report_closed_opportunities to authenticated;

-- -----------------------------------------------------------------------------
-- report_outcome_totals: WON / LOST of a period (calendar days, org timezone)
-- -----------------------------------------------------------------------------
create or replace function public.report_outcome_totals(p_org uuid, p_from date, p_to date)
returns table (
  won_count     int,
  lost_count    int,
  won_amount    numeric,
  lost_amount   numeric,
  win_rate      numeric,
  loss_rate     numeric,
  other_currency int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with closed as (
    select r.status, r.amount, r.currency
      from public.report_closed_opportunities r
     where r.organization_id = p_org
       and r.closed_date between p_from and p_to
  ), counts as (
    select count(*) filter (where status = 'won')::int  as won,
           count(*) filter (where status = 'lost')::int as lost,
           coalesce(sum(amount) filter (where status = 'won' and currency = 'EUR'), 0)  as won_amount,
           coalesce(sum(amount) filter (where status = 'lost' and currency = 'EUR'), 0) as lost_amount,
           count(*) filter (where currency <> 'EUR')::int as other_currency
      from closed
  )
  select won, lost, won_amount, lost_amount,
         case when won + lost > 0 then round(won * 100.0 / (won + lost), 4) end,
         case when won + lost > 0 then round(lost * 100.0 / (won + lost), 4) end,
         other_currency
    from counts;
$$;

comment on function public.report_outcome_totals(uuid, date, date) is
  'WON / LOST counts, EUR sums and rates (null = N/P without closed deals) of the deals closed in [p_from, p_to] (calendar days, organization timezone). Runs with the caller''s rights.';

revoke all on function public.report_outcome_totals(uuid, date, date) from public, anon;
grant execute on function public.report_outcome_totals(uuid, date, date) to authenticated, service_role;
