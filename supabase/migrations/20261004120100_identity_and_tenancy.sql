-- =============================================================================
-- RENVARA · Migration 0002 · Identity & tenancy
--
--   auth.users (Supabase Auth, owns credentials)
--        │ 1:1
--   public.profiles (application-level user data, no credentials)
--        │ 1:N
--   public.organization_members ─── N:1 ─── public.organizations (tenant)
--
-- Every business table carries organization_id and is protected by RLS that
-- resolves the caller's active memberships via private.current_user_org_ids().
-- See docs/architecture/03-tenancy-and-security.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  full_name    text check (full_name is null or char_length(full_name) <= 200),
  timezone     text not null default 'UTC' check (private.is_valid_timezone(timezone)),
  locale       text check (locale is null or locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for a Supabase Auth user. Credentials live only in auth.users. `email` is a read-only mirror maintained by trigger so teammates can see each other''s email without access to auth.users.';
comment on column public.profiles.timezone is
  'IANA timezone used to render times and evaluate date-only due dates ("today", "overdue") for this user.';

create trigger profiles_stamp
  before insert or update on public.profiles
  for each row execute function private.stamp_timestamps();

-- Create / sync the profile when Supabase Auth creates or updates a user.
create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      new.email,
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '')
    )
    on conflict (id) do nothing;
  elsif new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user_change();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_auth_user_change();

-- -----------------------------------------------------------------------------
-- organizations (tenants)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default private.uuid_generate_v7(),
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  legal_name        text check (legal_name is null or char_length(legal_name) <= 300),
  country_code      char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  timezone          text not null default 'UTC' check (private.is_valid_timezone(timezone)),
  default_currency  char(3) not null default 'EUR' check (default_currency ~ '^[A-Z]{3}$'),
  locale            text not null default 'en' check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  tax_id            text check (tax_id is null or char_length(tax_id) <= 50),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant root. Every business record belongs to exactly one organization. Billing/plan/seat data is intentionally NOT stored here (see ADR-0007).';
comment on column public.organizations.timezone is
  'Organization default timezone: used for team-level reporting and as the fallback for date-only values.';

create trigger organizations_stamp
  before insert or update on public.organizations
  for each row execute function private.stamp_timestamps();

-- -----------------------------------------------------------------------------
-- organization_members (user ↔ organization, with role)
-- -----------------------------------------------------------------------------
create table public.organization_members (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.member_role not null default 'sales',
  status           public.member_status not null default 'active',
  invited_by       uuid references public.profiles (id) on delete set null,
  joined_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

comment on table public.organization_members is
  'Membership of a user in an organization. (organization_id, user_id) is the target of composite foreign keys from business tables, which guarantees that owners/assignees are members of the same tenant. Removal sets status = removed; rows are only hard-deleted when the user account itself is deleted.';

create index organization_members_user_id_idx on public.organization_members (user_id);

create trigger organization_members_stamp
  before insert or update on public.organization_members
  for each row execute function private.stamp_timestamps();

-- -----------------------------------------------------------------------------
-- Tenancy helpers used by RLS policies.
--
-- SECURITY DEFINER so they can read organization_members without recursing
-- into that table's own RLS policies. They only ever answer questions about
-- the *calling* user (auth.uid()), so they cannot be used to probe other users.
--
-- Policies call them as `organization_id in (select private.current_user_org_ids())`
-- so PostgreSQL evaluates the function once per statement (InitPlan), not once
-- per row. This is the main RLS performance lever at scale.
-- -----------------------------------------------------------------------------
create or replace function private.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

create or replace function private.current_user_org_ids_with_role(roles public.member_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any (roles);
$$;

create or replace function private.current_user_role(org_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = org_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

revoke all on function private.current_user_org_ids() from public;
revoke all on function private.current_user_org_ids_with_role(public.member_role[]) from public;
revoke all on function private.current_user_role(uuid) from public;
grant execute on function private.current_user_org_ids() to authenticated, service_role;
grant execute on function private.current_user_org_ids_with_role(public.member_role[]) to authenticated, service_role;
grant execute on function private.current_user_role(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Membership invariants
--   1. user_id / organization_id are immutable.
--   2. Only an owner may grant the owner role or modify an owner's membership.
--   3. Members cannot change their own role or status (no self-escalation).
--   4. An organization always keeps at least one active owner.
-- Rules 2–3 apply to end users (auth.uid() present); service-role/back-office
-- operations bypass them but never rule 4.
-- -----------------------------------------------------------------------------
create or replace function private.guard_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.member_role;
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id then
    raise exception 'organization_id and user_id of a membership are immutable'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  if actor is not null then
    if actor = old.user_id
       and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'members cannot change their own role or status'
        using errcode = 'insufficient_privilege';
    end if;

    actor_role := private.current_user_role(old.organization_id);
    if (old.role = 'owner' or new.role = 'owner')
       and actor_role is distinct from 'owner'
       and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'only an owner can grant, revoke or modify the owner role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.role = 'owner' and old.status = 'active'
     and (new.role <> 'owner' or new.status <> 'active')
     and not exists (
       select 1 from public.organization_members m
       where m.organization_id = old.organization_id
         and m.id <> old.id
         and m.role = 'owner'
         and m.status = 'active'
     ) then
    raise exception 'an organization must keep at least one active owner'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger organization_members_guard
  before update on public.organization_members
  for each row execute function private.guard_membership_change();

-- -----------------------------------------------------------------------------
-- RPC: create an organization and make the caller its owner (atomically).
-- Clients have no INSERT privilege on organizations/organization_members.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_timezone text default 'UTC',
  p_default_currency text default 'EUR',
  p_country_code text default null,
  p_locale text default 'en'
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org public.organizations;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, timezone, default_currency, country_code, locale, created_by)
  values (btrim(p_name), p_timezone, upper(p_default_currency), upper(p_country_code), p_locale, actor)
  returning * into org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (org.id, actor, 'owner', 'active');

  return org;
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Privileges & RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

revoke all on public.profiles, public.organizations, public.organization_members from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, timezone, locale, avatar_path) on public.profiles to authenticated;

grant select on public.organizations to authenticated;
grant update (name, legal_name, country_code, timezone, default_currency, locale, tax_id)
  on public.organizations to authenticated;

grant select on public.organization_members to authenticated;
grant update (role, status) on public.organization_members to authenticated;

-- profiles: yourself, plus anyone who shares (or shared) an organization with
-- you, so names of current and former teammates render in history.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.user_id = profiles.id
        and m.organization_id in (select private.current_user_org_ids())
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select private.current_user_org_ids()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (id in (select private.current_user_org_ids_with_role('{owner,admin}')))
  with check (id in (select private.current_user_org_ids_with_role('{owner,admin}')));

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));

create policy organization_members_update on public.organization_members
  for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_role('{owner,admin}')))
  with check (organization_id in (select private.current_user_org_ids_with_role('{owner,admin}')));
