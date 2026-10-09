-- =============================================================================
-- RENVARA · Migration 0006 · Leads
--
--   Lead     = a potential business relationship that is NOT yet a customer
--   Customer = public.companies; Contact; Opportunity — unchanged
--
--   lead.stage  : new → contacted → qualified          (how far it got)
--   lead.status : active | won | lost                  (how it ended)
--
-- A lead is WON when it is converted into a customer (new or existing), and
-- optionally a contact and an opportunity. It is never deleted or merged: the
-- row keeps its own history and points at what it became. Lead won/lost is
-- independent of opportunity won/lost.
--
-- Every lifecycle moment has its own timestamp (created_at, qualified_at,
-- converted_at, lost_at), so "leads created in Q3" and "leads won in Q3" are
-- different, correct queries. Nothing resets at a quarter boundary.
-- =============================================================================

create type public.lead_stage as enum ('new', 'contacted', 'qualified');
create type public.lead_status as enum ('active', 'won', 'lost');
create type public.lead_source as enum (
  'manual', 'referral', 'web', 'email', 'phone', 'event', 'social', 'partner', 'other'
);
create type public.lead_lost_reason as enum (
  'not_interested', 'no_response', 'competitor', 'price', 'postponed', 'not_a_fit', 'duplicate', 'other'
);

create table public.leads (
  id                        uuid primary key default private.uuid_generate_v7(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  owner_user_id             uuid,
  name                      text not null check (char_length(btrim(name)) between 1 and 240),
  company_name              text check (company_name is null or char_length(company_name) <= 300),
  email                     text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  phone                     text check (phone is null or char_length(phone) <= 50),
  job_title                 text check (job_title is null or char_length(job_title) <= 200),
  source                    public.lead_source,
  notes                     text,
  stage                     public.lead_stage not null default 'new',
  status                    public.lead_status not null default 'active',
  estimated_value           numeric(15, 2) check (estimated_value is null or estimated_value >= 0),
  currency                  char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  qualified_at              timestamptz,
  converted_at              timestamptz,
  lost_at                   timestamptz,
  lost_reason               public.lead_lost_reason,
  lost_note                 text check (lost_note is null or char_length(lost_note) <= 1000),
  converted_customer_id     uuid,
  converted_contact_id      uuid,
  converted_opportunity_id  uuid,
  created_by                uuid references public.profiles (id) on delete set null,
  updated_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint leads_org_id_key unique (organization_id, id),
  constraint leads_owner_fk foreign key (organization_id, owner_user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (owner_user_id),
  -- What the lead became: same organization only (composite keys, ADR-0002).
  constraint leads_customer_fk foreign key (organization_id, converted_customer_id)
    references public.companies (organization_id, id) on delete set null (converted_customer_id),
  constraint leads_contact_fk foreign key (organization_id, converted_contact_id)
    references public.contacts (organization_id, id) on delete set null (converted_contact_id),
  constraint leads_opportunity_fk foreign key (organization_id, converted_opportunity_id)
    references public.opportunities (organization_id, id) on delete set null (converted_opportunity_id),
  constraint leads_value_needs_currency check (estimated_value is null or currency is not null),
  -- Each outcome has exactly its own timestamp.
  constraint leads_won_has_converted_at check ((status = 'won') = (converted_at is not null)),
  constraint leads_lost_has_lost_at check ((status = 'lost') = (lost_at is not null)),
  constraint leads_lost_reason_only_when_lost check (
    (lost_reason is null and lost_note is null) or status = 'lost'
  ),
  -- Conversion references only on won leads. (The customer reference may later
  -- become null if that customer is deleted; the conversion itself stays.)
  constraint leads_conversion_refs_only_when_won check (
    status = 'won'
    or num_nonnulls(converted_customer_id, converted_contact_id, converted_opportunity_id) = 0
  ),
  constraint leads_qualified_has_qualified_at check (stage <> 'qualified' or qualified_at is not null)
);

comment on table public.leads is
  'Potential customers before they become companies. Kept forever: converted (won) and lost leads stay for reporting.';
comment on column public.leads.name is
  'The lead as people know it: a person ("Ivan Horvat") or a business ("FERO-TERM Rijeka"). company_name is optional.';
comment on column public.leads.converted_at is
  'When the lead was converted into a customer (status won). Reporting date for "leads won in period".';
comment on column public.leads.lost_at is
  'When the lead was closed as lost. Reporting date for "leads lost in period".';
comment on column public.leads.qualified_at is
  'First time the lead reached stage qualified. Never cleared.';

-- Reporting by period: each lifecycle date on its own index.
create index leads_org_created_idx on public.leads (organization_id, created_at);
create index leads_org_status_idx on public.leads (organization_id, status);
create index leads_org_converted_idx on public.leads (organization_id, converted_at)
  where converted_at is not null;
create index leads_org_lost_idx on public.leads (organization_id, lost_at)
  where lost_at is not null;
create index leads_org_owner_idx on public.leads (organization_id, owner_user_id);
create index leads_org_source_idx on public.leads (organization_id, source);
create index leads_converted_customer_idx on public.leads (converted_customer_id);

create trigger leads_stamp
  before insert or update on public.leads
  for each row execute function private.stamp_tenant_row();

-- Lifecycle timestamps follow stage and status, so clients cannot forget them.
create or replace function private.lead_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage = 'qualified' and new.qualified_at is null then
    new.qualified_at := now();
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'won' then
      new.converted_at := coalesce(new.converted_at, now());
    elsif tg_op = 'UPDATE' and old.status = 'won' then
      new.converted_at := null;
    end if;
    if new.status = 'lost' then
      new.lost_at := coalesce(new.lost_at, now());
    elsif tg_op = 'UPDATE' and old.status = 'lost' then
      new.lost_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_lifecycle
  before insert or update of stage, status on public.leads
  for each row execute function private.lead_lifecycle();

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select, insert, update, delete on public.leads to authenticated;

create policy leads_select on public.leads for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy leads_insert on public.leads for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy leads_update on public.leads for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));
create policy leads_delete on public.leads for delete to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}')));

-- -----------------------------------------------------------------------------
-- Tasks and activities may concern a lead (before it becomes a customer).
-- Both columns are nullable: every existing row stays valid.
-- -----------------------------------------------------------------------------
alter table public.tasks
  add column lead_id uuid,
  add constraint tasks_lead_fk foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete set null (lead_id);
create index tasks_lead_idx on public.tasks (lead_id);
comment on column public.tasks.lead_id is
  'Optional lead the task concerns. Same organization only; a lead task needs no company.';

alter table public.activities
  add column lead_id uuid,
  add constraint activities_lead_fk foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade;
alter table public.activities drop constraint activities_has_subject;
alter table public.activities
  add constraint activities_has_subject
    check (num_nonnulls(company_id, contact_id, opportunity_id, lead_id) >= 1);
create index activities_lead_occurred_idx on public.activities (lead_id, occurred_at desc);
comment on column public.activities.lead_id is
  'Timeline entries of a lead (calls, e-mails, notes before conversion). Kept after conversion.';
