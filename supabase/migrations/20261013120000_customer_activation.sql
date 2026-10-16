-- =============================================================================
-- RENVARA · Migration 0008 · Customer activation (deactivate / reactivate)
--
-- Purely additive. A company is ACTIVE or INACTIVE (`is_active`), separately
-- from what it is commercially (`customer_status`: prospect / customer).
-- Deactivating moves the company out of the default customer list and
-- nothing else: no row is deleted, no contact, task, opportunity, offer,
-- reminder, lead or activity is changed, so reports keep counting its history.
-- Archiving (`archived_at`, ADR-0006) stays the user-facing "delete" and is a
-- different thing.
--
-- Authorization is unchanged: the existing RLS policies (organization members
-- update their organization's companies) cover the new columns.
-- =============================================================================

alter table public.companies
  add column is_active      boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete set null,
  add constraint companies_deactivation_consistent
    check (deactivated_at is null or not is_active);

comment on column public.companies.is_active is
  'Activation: false = inactive customer (out of the default customer list, all data kept). Independent of customer_status (prospect / customer).';
comment on column public.companies.deactivated_at is
  'When the company was last deactivated; null while active. Set by the database.';
comment on column public.companies.deactivated_by is
  'Who deactivated it (auth.uid() at the time); null while active or when done by the service role.';
comment on column public.companies.customer_status is
  'Commercial relationship (prospect / active_customer). The legacy value inactive_customer was mapped to is_active = false by migration 0008; activation itself lives in is_active.';

-- Existing inactive customers stay inactive (never reactivated by this
-- migration). Their deactivation time is unknown, so it stays null rather than
-- being invented; the row's updated_at / updated_by are left untouched too.
alter table public.companies disable trigger companies_stamp;
update public.companies
   set is_active = false
 where customer_status = 'inactive_customer';
alter table public.companies enable trigger companies_stamp;

-- Customer list: active / inactive, by name, per organization.
create index companies_org_active_name_idx
  on public.companies (organization_id, is_active, lower(name));

-- -----------------------------------------------------------------------------
-- The deactivation stamps follow is_active only: clients set is_active, the
-- database records when and by whom. A reactivated company is the same row
-- (same id) with the stamps cleared.
-- -----------------------------------------------------------------------------
create or replace function private.company_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.is_active is distinct from old.is_active then
    if new.is_active then
      new.deactivated_at := null;
      new.deactivated_by := null;
    else
      new.deactivated_at := now();
      new.deactivated_by := (select auth.uid());
    end if;
  else
    new.deactivated_at := old.deactivated_at;
    new.deactivated_by := old.deactivated_by;
  end if;
  return new;
end;
$$;

create trigger companies_activation
  before insert or update on public.companies
  for each row execute function private.company_activation();

-- Timeline entry for each change (system row, like opportunity status changes).
create or replace function private.log_company_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if new.is_active is not distinct from old.is_active then
    return null;
  end if;

  insert into public.activities (
    organization_id, company_id, performed_by_user_id,
    type, source, title, occurred_at, metadata
  )
  values (
    new.organization_id, new.id,
    -- Only attribute to the actor if they are a member (service role has no uid).
    (select m.user_id from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = actor),
    'status_change', 'system',
    case when new.is_active then 'Customer reactivated' else 'Customer deactivated' end,
    now(),
    jsonb_build_object('change', 'activation', 'from_active', old.is_active, 'to_active', new.is_active)
  );
  return null;
end;
$$;

create trigger companies_log_activation
  after update of is_active on public.companies
  for each row execute function private.log_company_activation();
