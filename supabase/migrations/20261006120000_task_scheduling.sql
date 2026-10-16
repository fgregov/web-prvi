-- =============================================================================
-- RENVARA · Migration 0005 · Task scheduling (Sales Calendar) & task sources
--
-- The Sales Calendar is a VIEW OVER TASKS: a task is in the calendar when it
-- has scheduled_start_at. There is no calendar_items table, so a calendar
-- entry and its task can never disagree.
--
--   scheduled_start_at / _end_at  → when the work happens ("Zakazano")
--   is_all_day                    → date-only calendar entry (start = start of
--                                   that day in the organization timezone)
--   due_date xor due_at           → the deadline ("Rok"), unchanged
--
-- Tasks stay independent: company, contact and opportunity remain optional.
-- =============================================================================

-- New task types. FOLLOW_UP already exists and stays a plain type.
alter type public.task_type add value if not exists 'general' before 'call';
alter type public.task_type add value if not exists 'send_offer' before 'send_document';

alter table public.tasks
  add column scheduled_start_at timestamptz,
  add column scheduled_end_at   timestamptz,
  add column is_all_day         boolean not null default false,
  add column location           text check (location is null or char_length(location) <= 300),
  add column source             public.activity_source not null default 'manual',
  add constraint tasks_schedule_end_needs_start
    check (scheduled_end_at is null or scheduled_start_at is not null),
  add constraint tasks_schedule_end_not_before_start
    check (scheduled_end_at is null or scheduled_end_at >= scheduled_start_at),
  add constraint tasks_all_day_is_date_only
    check (not is_all_day or (scheduled_start_at is not null and scheduled_end_at is null));

comment on column public.tasks.scheduled_start_at is
  'Sales Calendar slot start (UTC). Null → the task is not in the calendar. Independent of the deadline (due_date / due_at).';
comment on column public.tasks.scheduled_end_at is
  'Optional end of the calendar slot (UTC); never before scheduled_start_at.';
comment on column public.tasks.is_all_day is
  'Date-only calendar entry: scheduled_start_at is the start of that day in the organization timezone.';
comment on column public.tasks.source is
  'Who created the task: manual (a user), system (database/automation), ai_assistant. Clients cannot write system rows.';

-- Calendar range queries: "tasks of organization X scheduled between A and B".
create index tasks_calendar_idx on public.tasks (organization_id, scheduled_start_at)
  where scheduled_start_at is not null;

-- -----------------------------------------------------------------------------
-- A task's contact must belong to the task's company (when both are known).
-- Runs after private.derive_subject_links (trigger names sort alphabetically),
-- so company_id is already derived from the opportunity or the contact. Only
-- re-evaluated when a link changes, so a contact who later moves to another
-- company never invalidates historical tasks.
-- -----------------------------------------------------------------------------
create or replace function private.check_task_contact_company()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  contact_company uuid;
begin
  if new.contact_id is null or new.company_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.contact_id is not distinct from old.contact_id then
    return new;
  end if;

  select c.company_id into contact_company
  from public.contacts c
  where c.id = new.contact_id and c.organization_id = new.organization_id;

  if contact_company is not null and contact_company <> new.company_id then
    raise exception 'the contact of a task must belong to the task''s company'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tasks_subject_links_check
  before insert or update on public.tasks
  for each row execute function private.check_task_contact_company();

-- -----------------------------------------------------------------------------
-- RLS: as for activities, clients may not create or forge system tasks.
-- -----------------------------------------------------------------------------
drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids())
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    organization_id in (select private.current_user_org_ids())
    and (
      assigned_user_id = (select auth.uid())
      or created_by = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    )
  )
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids())
  );

-- -----------------------------------------------------------------------------
-- Next action ordering (ADR-0004), extended: a task's deadline first; a task
-- without a deadline is ordered by its calendar slot; undated tasks last.
-- Mirrored by effectiveDueFromColumns() in @renvara/domain.
-- -----------------------------------------------------------------------------
create or replace view public.opportunity_overview
with (security_invoker = true)
as
select
  o.*,
  na.id                as next_task_id,
  na.type              as next_task_type,
  na.title             as next_task_title,
  na.due_date          as next_task_due_date,
  na.due_at            as next_task_due_at,
  na.assigned_user_id  as next_task_assigned_user_id,
  la.last_activity_at,
  (o.status = 'active' and na.id is null) as needs_next_action
from public.opportunities o
join public.organizations org on org.id = o.organization_id
left join lateral (
  select t.id, t.type, t.title, t.due_date, t.due_at, t.assigned_user_id
  from public.tasks t
  where t.opportunity_id = o.id
    and t.status = 'open'
  order by
    coalesce(t.due_at, t.due_date::timestamp at time zone org.timezone, t.scheduled_start_at) asc nulls last,
    t.created_at asc,
    t.id asc
  limit 1
) na on true
left join lateral (
  select max(a.occurred_at) as last_activity_at
  from public.activities a
  where a.opportunity_id = o.id
) la on true;
