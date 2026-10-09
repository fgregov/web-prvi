-- =============================================================================
-- RENVARA · Migration 0004 · Activities (what happened) & Tasks (what's next)
--
--   Activity = immutable-ish historical fact  → the timeline
--   Task     = future obligation               → the next action
--
-- "No active opportunity without a known next action" is implemented by
-- DERIVATION (ADR-0004): an opportunity's next action is its earliest open
-- task; an active opportunity with no open task needs attention. Nothing is
-- duplicated onto the opportunity row, so it can never drift out of sync.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Subject links shared by activities and tasks.
--
-- A record may point at a company, a contact and/or an opportunity.
--   * company_id is derived from the opportunity (authoritative) or, failing
--     that, from the contact's current company, so company timelines need only
--     one indexed lookup.
--   * An explicit company_id that contradicts the opportunity's company is
--     rejected. A contact from another company is allowed (partners,
--     consultants, people who changed jobs).
-- Only re-evaluated when one of the link columns changes, so later changes to
-- a contact's company never invalidate historical rows.
-- -----------------------------------------------------------------------------
create or replace function private.derive_subject_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_company uuid;
begin
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.contact_id is not distinct from old.contact_id
     and new.opportunity_id is not distinct from old.opportunity_id then
    return new;
  end if;

  if new.opportunity_id is not null then
    select o.company_id into linked_company
    from public.opportunities o
    where o.id = new.opportunity_id and o.organization_id = new.organization_id;

    -- Not found → leave it to the composite FK to reject the row.
    if linked_company is not null then
      if new.company_id is null then
        new.company_id := linked_company;
      elsif new.company_id <> linked_company then
        raise exception 'company_id does not match the company of the linked opportunity'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.company_id is null and new.contact_id is not null then
    select c.company_id into new.company_id
    from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- activities
-- -----------------------------------------------------------------------------
create table public.activities (
  id                    uuid primary key default private.uuid_generate_v7(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  company_id            uuid,
  contact_id            uuid,
  opportunity_id        uuid,
  performed_by_user_id  uuid,
  type                  public.activity_type not null,
  source                public.activity_source not null default 'manual',
  title                 text not null check (char_length(btrim(title)) between 1 and 300),
  description           text,
  occurred_at           timestamptz not null default now(),
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint activities_org_id_key unique (organization_id, id),
  constraint activities_company_fk foreign key (organization_id, company_id)
    references public.companies (organization_id, id) on delete cascade,
  constraint activities_contact_fk foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete set null (contact_id),
  constraint activities_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete set null (opportunity_id),
  constraint activities_performer_fk foreign key (organization_id, performed_by_user_id)
    references public.organization_members (organization_id, user_id) on delete set null (performed_by_user_id),
  constraint activities_has_subject check (num_nonnulls(company_id, contact_id, opportunity_id) >= 1),
  constraint activities_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint activities_metadata_size check (pg_column_size(metadata) <= 16384)
);

comment on table public.activities is
  'Something that happened (call, meeting, note, offer sent, status change…). Source of the customer/opportunity timeline. Core, filterable facts are relational columns; type-specific details (call duration, email message id, from/to stage…) go in `metadata` (ADR-0005).';
comment on column public.activities.occurred_at is
  'When it actually happened (may be back-dated). created_at is when it was recorded.';
comment on column public.activities.title is
  'Human-readable summary. For source = system rows this is an English fallback; clients should render localized text from type + metadata.';

create index activities_org_occurred_idx on public.activities (organization_id, occurred_at desc);
create index activities_company_occurred_idx on public.activities (company_id, occurred_at desc);
create index activities_contact_occurred_idx on public.activities (contact_id, occurred_at desc);
create index activities_opportunity_occurred_idx on public.activities (opportunity_id, occurred_at desc);

create trigger activities_stamp
  before insert or update on public.activities
  for each row execute function private.stamp_tenant_row();

create trigger activities_subject_links
  before insert or update on public.activities
  for each row execute function private.derive_subject_links();

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                uuid primary key default private.uuid_generate_v7(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  company_id        uuid,
  contact_id        uuid,
  opportunity_id    uuid,
  assigned_user_id  uuid,
  type              public.task_type not null default 'other',
  title             text not null check (char_length(btrim(title)) between 1 and 300),
  description       text,
  due_date          date,
  due_at            timestamptz,
  priority          public.task_priority not null default 'normal',
  status            public.task_status not null default 'open',
  closed_at         timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tasks_org_id_key unique (organization_id, id),
  constraint tasks_company_fk foreign key (organization_id, company_id)
    references public.companies (organization_id, id) on delete cascade,
  constraint tasks_contact_fk foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete set null (contact_id),
  constraint tasks_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete cascade,
  constraint tasks_assignee_fk foreign key (organization_id, assigned_user_id)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_user_id),
  constraint tasks_single_due_kind check (num_nonnulls(due_date, due_at) <= 1),
  constraint tasks_closed_at_matches_status check ((status = 'open') = (closed_at is null))
);

comment on table public.tasks is
  'Something someone needs to do. An open task linked to an opportunity is a candidate next action. Tasks without any subject are allowed (personal reminders).';
comment on column public.tasks.due_date is
  'Date-only due ("by Friday"). Interpreted in the assignee''s timezone. Mutually exclusive with due_at.';
comment on column public.tasks.due_at is
  'Exact due instant (UTC) for time-specific tasks ("call at 14:00"). Mutually exclusive with due_date.';

create index tasks_company_idx on public.tasks (company_id);
create index tasks_contact_idx on public.tasks (contact_id);
create index tasks_open_by_opportunity_idx on public.tasks (opportunity_id) where status = 'open';
create index tasks_open_by_assignee_idx on public.tasks (organization_id, assigned_user_id, due_date, due_at)
  where status = 'open';

create trigger tasks_stamp
  before insert or update on public.tasks
  for each row execute function private.stamp_tenant_row();

create trigger tasks_subject_links
  before insert or update on public.tasks
  for each row execute function private.derive_subject_links();

create or replace function private.task_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'open' then
    new.closed_at := null;
  elsif tg_op = 'INSERT' then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.closed_at is null or new.closed_at is not distinct from old.closed_at then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

create trigger tasks_lifecycle
  before insert or update of status on public.tasks
  for each row execute function private.task_lifecycle();

-- -----------------------------------------------------------------------------
-- System timeline entries for opportunity stage/status changes.
-- SECURITY DEFINER because clients may not write source = 'system' rows; the
-- organization and opportunity come from the row the caller was just allowed
-- (by RLS) to update, so this cannot cross tenants.
-- -----------------------------------------------------------------------------
create or replace function private.log_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  summary text;
begin
  if new.stage is not distinct from old.stage and new.status is not distinct from old.status then
    return null;
  end if;

  summary := case
    when new.status is distinct from old.status and new.status = 'won' then 'Opportunity won'
    when new.status is distinct from old.status and new.status = 'lost' then 'Opportunity lost'
    when new.status is distinct from old.status and new.status = 'active' then 'Opportunity reopened'
    else 'Stage changed: ' || old.stage::text || ' → ' || new.stage::text
  end;

  insert into public.activities (
    organization_id, company_id, opportunity_id, performed_by_user_id,
    type, source, title, occurred_at, metadata
  )
  values (
    new.organization_id, new.company_id, new.id,
    -- Only attribute to the actor if they are a member (service role has no uid).
    (select m.user_id from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = actor),
    'status_change', 'system', summary, now(),
    jsonb_strip_nulls(jsonb_build_object(
      'from_stage', old.stage, 'to_stage', new.stage,
      'from_status', old.status, 'to_status', new.status,
      'lost_reason', new.lost_reason
    ))
  );
  return null;
end;
$$;

create trigger opportunities_log_change
  after update of stage, status on public.opportunities
  for each row execute function private.log_opportunity_change();

-- -----------------------------------------------------------------------------
-- Derived read model: opportunity + next action + last activity.
--
-- security_invoker → the caller's RLS applies to every underlying table.
-- Ordering of "next": the earliest effective due moment first. A date-only due
-- date counts from the start of that day in the organization's timezone; tasks
-- without any due date come last; ties broken by creation order.
-- Per-user concerns ("overdue for me", "due today") are evaluated in the
-- domain layer with the user's timezone.
-- -----------------------------------------------------------------------------
create view public.opportunity_overview
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
    coalesce(t.due_at, t.due_date::timestamp at time zone org.timezone) asc nulls last,
    t.created_at asc,
    t.id asc
  limit 1
) na on true
left join lateral (
  select max(a.occurred_at) as last_activity_at
  from public.activities a
  where a.opportunity_id = o.id
) la on true;

comment on view public.opportunity_overview is
  'Opportunities with their derived next action (earliest open task) and last activity. needs_next_action = active opportunity with no open task — the core "needs attention" signal (ADR-0004).';

-- -----------------------------------------------------------------------------
-- Privileges & RLS
-- -----------------------------------------------------------------------------
alter table public.activities enable row level security;
alter table public.tasks enable row level security;

revoke all on public.activities, public.tasks, public.opportunity_overview from anon, authenticated;
grant select, insert, update, delete on public.activities, public.tasks to authenticated;
grant select on public.opportunity_overview to authenticated;

-- Activities: everyone in the org reads the timeline; authors (or owner/admin)
-- edit/delete their own manual entries; system entries are immutable for users
-- (owner/admin may delete them).
create policy activities_select on public.activities for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));

create policy activities_insert on public.activities for insert to authenticated
  with check (
    organization_id in (select private.current_user_org_ids())
    and source <> 'system'
  );

create policy activities_update on public.activities for update to authenticated
  using (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids())
    and (
      created_by = (select auth.uid())
      or performed_by_user_id = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin}'))
    )
  )
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids())
  );

create policy activities_delete on public.activities for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin}'))
    or (
      source <> 'system'
      and organization_id in (select private.current_user_org_ids())
      and (created_by = (select auth.uid()) or performed_by_user_id = (select auth.uid()))
    )
  );

-- Tasks: team-visible; assignee, creator or owner/admin/manager may edit;
-- creator or owner/admin/manager may delete.
create policy tasks_select on public.tasks for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));

create policy tasks_insert on public.tasks for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));

create policy tasks_update on public.tasks for update to authenticated
  using (
    organization_id in (select private.current_user_org_ids())
    and (
      assigned_user_id = (select auth.uid())
      or created_by = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    )
  )
  with check (organization_id in (select private.current_user_org_ids()));

create policy tasks_delete on public.tasks for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids())
    and (
      created_by = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    )
  );
