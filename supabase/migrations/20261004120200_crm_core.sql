-- =============================================================================
-- RENVARA · Migration 0003 · CRM core: companies, contacts, opportunities
--
-- Tenant-safe relationships: every reference between tenant-scoped tables is a
-- COMPOSITE foreign key (organization_id, <ref>_id) → (organization_id, id).
-- The database therefore rejects any row that links records of two different
-- organizations, independently of RLS and of application code (ADR-0002).
--
-- References to people (owner, assignee, performer) target
-- organization_members (organization_id, user_id): a record can only be owned
-- by a member of the same organization.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- companies — customers and prospects (B2B accounts)
-- -----------------------------------------------------------------------------
create table public.companies (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 300),
  legal_name       text check (legal_name is null or char_length(legal_name) <= 300),
  tax_id           text check (tax_id is null or char_length(tax_id) <= 50),
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  phone            text check (phone is null or char_length(phone) <= 50),
  website          text check (website is null or char_length(website) <= 300),
  address_line     text check (address_line is null or char_length(address_line) <= 300),
  city             text check (city is null or char_length(city) <= 120),
  postal_code      text check (postal_code is null or char_length(postal_code) <= 20),
  country_code     char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  notes            text,
  owner_user_id    uuid,
  customer_status  public.customer_status not null default 'prospect',
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint companies_org_id_key unique (organization_id, id),
  constraint companies_owner_fk foreign key (organization_id, owner_user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (owner_user_id)
);

comment on table public.companies is
  'Customer or prospect account. `customer_status` describes the relationship, not any deal. Archive (archived_at) is the normal user-facing "delete"; hard delete purges the company and everything attached to it (ADR-0006).';

create index companies_org_name_idx on public.companies (organization_id, lower(name));
create index companies_owner_idx on public.companies (organization_id, owner_user_id);

create trigger companies_stamp
  before insert or update on public.companies
  for each row execute function private.stamp_tenant_row();

-- -----------------------------------------------------------------------------
-- contacts — people
-- -----------------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  company_id       uuid,
  first_name       text not null check (char_length(btrim(first_name)) between 1 and 120),
  last_name        text check (last_name is null or char_length(last_name) <= 120),
  job_title        text check (job_title is null or char_length(job_title) <= 200),
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  phone            text check (phone is null or char_length(phone) <= 50),
  mobile_phone     text check (mobile_phone is null or char_length(mobile_phone) <= 50),
  notes            text,
  is_primary       boolean not null default false,
  owner_user_id    uuid,
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint contacts_org_id_key unique (organization_id, id),
  constraint contacts_company_fk foreign key (organization_id, company_id)
    references public.companies (organization_id, id)
    on delete cascade,
  constraint contacts_owner_fk foreign key (organization_id, owner_user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (owner_user_id),
  constraint contacts_primary_requires_company check (not is_primary or company_id is not null)
);

comment on table public.contacts is
  'A person. Usually belongs to one company (MVP); company_id is nullable so a person can be captured before their company is known. Many-to-many contact↔company roles can be added later as a junction table without changing this table''s identity.';

create index contacts_company_idx on public.contacts (company_id);
create index contacts_org_name_idx on public.contacts (organization_id, lower(first_name), lower(last_name));
create unique index contacts_one_primary_per_company_idx
  on public.contacts (company_id) where is_primary and archived_at is null;

create trigger contacts_stamp
  before insert or update on public.contacts
  for each row execute function private.stamp_tenant_row();

-- -----------------------------------------------------------------------------
-- opportunities — sales deals
-- -----------------------------------------------------------------------------
create table public.opportunities (
  id                  uuid primary key default private.uuid_generate_v7(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  company_id          uuid not null,
  primary_contact_id  uuid,
  owner_user_id       uuid,
  title               text not null check (char_length(btrim(title)) between 1 and 300),
  description         text,
  estimated_value     numeric(15, 2) check (estimated_value is null or estimated_value >= 0),
  currency            char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  stage               public.opportunity_stage not null default 'new_lead',
  status              public.opportunity_status not null default 'active',
  manual_probability  smallint check (manual_probability is null or manual_probability between 0 and 100),
  interest_level      public.interest_level,
  expected_close_date date,
  closed_at           timestamptz,
  lost_reason         text check (lost_reason is null or char_length(lost_reason) <= 1000),
  created_by          uuid references public.profiles (id) on delete set null,
  updated_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint opportunities_org_id_key unique (organization_id, id),
  constraint opportunities_company_fk foreign key (organization_id, company_id)
    references public.companies (organization_id, id)
    on delete cascade,
  constraint opportunities_primary_contact_fk foreign key (organization_id, primary_contact_id)
    references public.contacts (organization_id, id)
    on delete set null (primary_contact_id),
  constraint opportunities_owner_fk foreign key (organization_id, owner_user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (owner_user_id),
  constraint opportunities_value_needs_currency check (estimated_value is null or currency is not null),
  constraint opportunities_closed_at_matches_status check ((status = 'active') = (closed_at is null)),
  constraint opportunities_lost_reason_only_when_lost check (lost_reason is null or status = 'lost')
);

comment on table public.opportunities is
  'A sales deal with one company. `stage` = pipeline position, `status` = outcome (ADR-0003). The next action is NOT stored here: it is derived from open tasks (ADR-0004); read it through public.opportunity_overview.';
comment on column public.opportunities.expected_close_date is
  'Calendar date (no time, no timezone): a business-day estimate, not an instant.';
comment on column public.opportunities.closed_at is
  'When the deal was won/lost. Filled automatically on close if not provided (back-dating allowed), cleared on reopen.';

create index opportunities_company_idx on public.opportunities (company_id);
create index opportunities_primary_contact_idx on public.opportunities (primary_contact_id);
create index opportunities_org_status_stage_idx on public.opportunities (organization_id, status, stage);
create index opportunities_owner_active_idx on public.opportunities (organization_id, owner_user_id)
  where status = 'active';

create trigger opportunities_stamp
  before insert or update on public.opportunities
  for each row execute function private.stamp_tenant_row();

-- Lifecycle bookkeeping that must hold no matter which client writes the row.
-- The *rules* about which transitions are allowed live in the domain layer
-- (packages/domain/src/opportunity); the database guarantees consistency.
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
  end if;

  return new;
end;
$$;

create trigger opportunities_lifecycle
  before insert or update of status on public.opportunities
  for each row execute function private.opportunity_lifecycle();

-- -----------------------------------------------------------------------------
-- Privileges & RLS
--
-- Phase 1 visibility model: all active members of an organization can read and
-- edit its CRM records (small teams share one CRM). Hard delete is limited to
-- owner/admin/manager; everyone else archives. Narrower visibility (e.g. "sales
-- sees only own records") can later be added by changing these policies only.
-- -----------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.opportunities enable row level security;

revoke all on public.companies, public.contacts, public.opportunities from anon, authenticated;
grant select, insert, update, delete on public.companies, public.contacts, public.opportunities to authenticated;

create policy companies_select on public.companies for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy companies_insert on public.companies for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy companies_update on public.companies for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));
create policy companies_delete on public.companies for delete to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}')));

create policy contacts_select on public.contacts for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy contacts_update on public.contacts for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));
create policy contacts_delete on public.contacts for delete to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}')));

create policy opportunities_select on public.opportunities for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy opportunities_update on public.opportunities for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));
create policy opportunities_delete on public.opportunities for delete to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}')));
