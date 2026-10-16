-- =============================================================================
-- RENVARA · Migration · KORISNICI: members, access rights, administration log
-- (ADR-0014)
--
--   auth.users            credentials (Supabase Auth); never in app tables
--   public.profiles       + first_name, last_name, oib, phone, last_login_at
--   organization_members  role owner | admin | (manager, sales = "Korisnik"),
--                         status active | suspended (= deaktiviran) | removed
--   member_permissions    the rights of a non-owner member (an owner has all)
--   admin_audit_log       who changed which member, never passwords or tokens
--
-- The same keys as apps/beta-web/public/app/js/core/permissions.js
-- (a test compares them). RLS on the CRM tables now asks for the right of the
-- module, not just membership. The admin_* functions are for the server only
-- (service role): it signs the member in, checks the rules, and calls them;
-- they check the same rules again (apps/beta-web/src/identity/rules.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- OIB (Croatian personal identification number): 11 digits, ISO 7064 MOD 11,10
-- -----------------------------------------------------------------------------
create or replace function private.is_valid_oib(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  rest int := 10;
  i int;
begin
  if value is null or value !~ '^[0-9]{11}$' then
    return false;
  end if;
  for i in 1..10 loop
    rest := (rest + substr(value, i, 1)::int) % 10;
    if rest = 0 then rest := 10; end if;
    rest := (rest * 2) % 11;
  end loop;
  return (11 - rest) % 10 = substr(value, 11, 1)::int;
end;
$$;

-- App role ↔ database role: Korisnik is 'sales' (an existing 'manager' reads as Korisnik).
create or replace function private.app_role(r public.member_role)
returns text
language sql
immutable
set search_path = ''
as $$
  select case r when 'owner' then 'owner' when 'admin' then 'admin' else 'user' end;
$$;

create or replace function private.db_role(r text)
returns public.member_role
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner' then 'owner'::public.member_role
    when 'admin' then 'admin'::public.member_role
    when 'user' then 'sales'::public.member_role
  end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles: the member's data. OIB and phone are personal data: teammates do
-- not read them (column privileges); administrators read them through the
-- server. Credentials stay in auth.users.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 100),
  add column last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 100),
  add column oib text check (oib is null or private.is_valid_oib(oib)),
  add column phone text check (phone is null or phone ~ '^\+?[0-9 ()/.-]{6,25}$'),
  add column last_login_at timestamptz;

comment on column public.profiles.oib is
  'Personal identification number (OIB). Personal data: not readable by teammates (column privilege); administrators with users.view_details read it through the server.';
comment on column public.profiles.phone is
  'Work phone. Personal data: as for oib.';

revoke select on public.profiles from authenticated;
grant select (id, email, full_name, first_name, last_name, timezone, locale, avatar_path,
              last_login_at, created_at, updated_at)
  on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Memberships: when and by whom a member was deactivated (kept, never deleted).
-- -----------------------------------------------------------------------------
alter table public.organization_members
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Catalog of rights (not a tenant table: private, read by the functions below).
-- -----------------------------------------------------------------------------
create table private.permission_definitions (
  key            text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  group_key      text not null,
  sort_order     int not null,
  admin_only     boolean not null default false,
  default_grant  boolean not null default true,
  requires       text[] not null default '{}'
);

comment on table private.permission_definitions is
  'Access rights (ADR-0014), the same keys as core/permissions.js. default_grant: given to a new Korisnik; an admin gets all, an owner holds all implicitly.';

insert into private.permission_definitions (key, group_key, sort_order, admin_only, default_grant, requires) values
  ('leads.view',                  'sales',          10, false, true,  '{}'),
  ('leads.create',                'sales',          11, false, true,  '{leads.view}'),
  ('leads.edit',                  'sales',          12, false, true,  '{leads.view}'),
  ('opportunities.view',          'sales',          20, false, true,  '{}'),
  ('opportunities.create',        'sales',          21, false, true,  '{opportunities.view}'),
  ('opportunities.edit',          'sales',          22, false, true,  '{opportunities.view}'),
  ('tasks.view',                  'sales',          30, false, true,  '{}'),
  ('tasks.create',                'sales',          31, false, true,  '{tasks.view}'),
  ('tasks.edit',                  'sales',          32, false, true,  '{tasks.view}'),
  ('customers.view',              'sales',          40, false, true,  '{}'),
  ('customers.create',            'sales',          41, false, true,  '{customers.view}'),
  ('customers.edit',              'sales',          42, false, true,  '{customers.view}'),
  ('follow_up.view',              'modules',        50, false, true,  '{}'),
  ('follow_up.create',            'modules',        51, false, true,  '{follow_up.view}'),
  ('follow_up.edit',              'modules',        52, false, true,  '{follow_up.view}'),
  ('calendar.view',               'modules',        60, false, true,  '{}'),
  ('pipeline.view',               'modules',        61, false, true,  '{}'),
  ('feedback.view',               'modules',        62, false, true,  '{}'),
  ('reports.view',                'modules',        63, false, true,  '{}'),
  ('dashboard.view',              'dashboard',      70, false, true,  '{}'),
  ('dashboard.leads',             'dashboard',      71, false, true,  '{dashboard.view,leads.view}'),
  ('dashboard.won_lost',          'dashboard',      72, false, true,  '{dashboard.view,opportunities.view}'),
  ('dashboard.opportunity_value', 'dashboard',      73, false, true,  '{dashboard.view,opportunities.view}'),
  ('dashboard.pipeline',          'dashboard',      74, false, true,  '{dashboard.view,pipeline.view}'),
  ('dashboard.calendar',          'dashboard',      75, false, true,  '{dashboard.view,calendar.view}'),
  ('dashboard.priority_tasks',    'dashboard',      76, false, true,  '{dashboard.view,tasks.view}'),
  ('dashboard.feedback',          'dashboard',      77, false, true,  '{dashboard.view,feedback.view}'),
  ('dashboard.waiting_response',  'dashboard',      78, false, true,  '{dashboard.view,follow_up.view}'),
  ('dashboard.notifications',     'dashboard',      79, false, true,  '{dashboard.view,notifications.view}'),
  ('users.view',                  'users',          80, false, false, '{}'),
  ('users.create',                'users',          81, true,  false, '{users.view}'),
  ('users.view_details',          'users',          82, false, false, '{users.view}'),
  ('users.edit',                  'users',          83, true,  false, '{users.view_details}'),
  ('users.deactivate',            'users',          84, true,  false, '{users.view}'),
  ('users.change_password',       'users',          85, true,  false, '{users.view_details}'),
  ('users.manage_permissions',    'users',          86, true,  false, '{users.view_details}'),
  ('notifications.view',          'notifications',  90, false, true,  '{}'),
  ('notifications.web_push',      'notifications',  91, false, true,  '{notifications.view}');

revoke all on private.permission_definitions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- member_permissions: one row per right a non-owner member holds.
-- -----------------------------------------------------------------------------
create table public.member_permissions (
  organization_id  uuid not null,
  user_id          uuid not null,
  permission_key   text not null references private.permission_definitions (key)
                     on update cascade on delete cascade,
  granted_by       uuid references public.profiles (id) on delete set null,
  granted_at       timestamptz not null default now(),
  primary key (organization_id, user_id, permission_key),
  foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade
);

comment on table public.member_permissions is
  'Access rights of a member (ADR-0014). Owners hold every right implicitly (no rows). Written only by the server''s admin_* functions; revoking a row takes effect on the next request of every open session.';

create index member_permissions_user_idx on public.member_permissions (user_id, organization_id);

-- -----------------------------------------------------------------------------
-- admin_audit_log: append-only record of member administration.
-- -----------------------------------------------------------------------------
create table public.admin_audit_log (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  target_user_id   uuid references public.profiles (id) on delete set null,
  action           text not null check (action in (
                     'user.create', 'user.update', 'user.deactivate', 'user.activate',
                     'user.access', 'user.password_change', 'user.password_link')),
  result           text not null check (result in ('success', 'denied', 'failed')),
  details          jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 4000),
  created_at       timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Who did what to which member (ADR-0014). Details hold field names, rights and reasons, never passwords, tokens or the values of personal data. Append-only.';

create index admin_audit_log_target_idx
  on public.admin_audit_log (organization_id, target_user_id, created_at desc);

create or replace function private.forbid_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the administration log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger admin_audit_log_append_only
  before update on public.admin_audit_log
  for each row execute function private.forbid_audit_change();

-- -----------------------------------------------------------------------------
-- Rights of a member. SECURITY DEFINER (no RLS recursion), stable; the
-- current_user_* variants only answer for the caller (auth.uid()).
-- -----------------------------------------------------------------------------
create or replace function private.member_has_permission(p_org uuid, p_user uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = p_user
      and m.status = 'active'
      and (
        m.role = 'owner'
        or exists (
          select 1 from public.member_permissions mp
          where mp.organization_id = m.organization_id
            and mp.user_id = m.user_id
            and mp.permission_key = p_key
        )
      )
  );
$$;

create or replace function private.has_permission(p_org uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_has_permission(p_org, (select auth.uid()), p_key);
$$;

create or replace function private.current_user_org_ids_with_permission(p_key text)
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
    and (
      m.role = 'owner'
      or exists (
        select 1 from public.member_permissions mp
        where mp.organization_id = m.organization_id
          and mp.user_id = m.user_id
          and mp.permission_key = p_key
      )
    );
$$;

create or replace function private.current_user_org_ids_with_any_permission(p_keys text[])
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
    and (
      m.role = 'owner'
      or exists (
        select 1 from public.member_permissions mp
        where mp.organization_id = m.organization_id
          and mp.user_id = m.user_id
          and mp.permission_key = any (p_keys)
      )
    );
$$;

revoke all on function private.member_has_permission(uuid, uuid, text) from public;
revoke all on function private.has_permission(uuid, text) from public;
revoke all on function private.current_user_org_ids_with_permission(text) from public;
revoke all on function private.current_user_org_ids_with_any_permission(text[]) from public;
grant execute on function private.member_has_permission(uuid, uuid, text) to service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;
grant execute on function private.current_user_org_ids_with_permission(text) to authenticated, service_role;
grant execute on function private.current_user_org_ids_with_any_permission(text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- New members get the default rights (an admin all, an owner none stored);
-- existing members keep working: the same defaults now.
-- -----------------------------------------------------------------------------
create or replace function private.grant_default_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role <> 'owner' then
    insert into public.member_permissions (organization_id, user_id, permission_key, granted_by)
    select new.organization_id, new.user_id, d.key, new.invited_by
    from private.permission_definitions d
    where d.default_grant or new.role = 'admin'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger organization_members_default_permissions
  after insert on public.organization_members
  for each row execute function private.grant_default_permissions();

insert into public.member_permissions (organization_id, user_id, permission_key)
select m.organization_id, m.user_id, d.key
from public.organization_members m
cross join private.permission_definitions d
where m.role <> 'owner'
  and (d.default_grant or m.role = 'admin')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Direct membership changes by a signed-in member (not the server) need the
-- right for them; administrators and owners are changed only by an owner.
-- (private.guard_membership_change keeps: no self change, owner role only by
-- an owner, at least one active owner.)
-- -----------------------------------------------------------------------------
create or replace function private.guard_membership_rights()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    return new; -- the server's admin_* functions check the rules themselves
  end if;
  if new.role is distinct from old.role
     and not private.member_has_permission(old.organization_id, actor, 'users.manage_permissions') then
    raise exception 'changing a role needs the users.manage_permissions right'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     and not private.member_has_permission(old.organization_id, actor, 'users.deactivate') then
    raise exception 'changing a member''s status needs the users.deactivate right'
      using errcode = 'insufficient_privilege';
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and old.role in ('owner', 'admin')
     and private.current_user_role(old.organization_id) is distinct from 'owner' then
    raise exception 'administrators and owners are changed only by an owner'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger organization_members_rights_guard
  before update on public.organization_members
  for each row execute function private.guard_membership_rights();

drop policy organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (organization_id in (
    select private.current_user_org_ids_with_any_permission('{users.deactivate,users.manage_permissions}')))
  with check (organization_id in (
    select private.current_user_org_ids_with_any_permission('{users.deactivate,users.manage_permissions}')));

-- -----------------------------------------------------------------------------
-- Privileges & RLS of the new tables. Writes only through admin_* (server).
-- -----------------------------------------------------------------------------
alter table public.member_permissions enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.member_permissions, public.admin_audit_log from anon, authenticated;
grant select on public.member_permissions, public.admin_audit_log to authenticated;

create policy member_permissions_select on public.member_permissions
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and organization_id in (select private.current_user_org_ids()))
    or organization_id in (select private.current_user_org_ids_with_permission('users.view_details'))
  );

create policy admin_audit_log_select on public.admin_audit_log
  for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('users.view_details')));

-- -----------------------------------------------------------------------------
-- CRM data by right (was: any active member). Delete keeps its role rule and
-- also needs the edit right of the module.
-- -----------------------------------------------------------------------------
drop policy companies_select on public.companies;
drop policy companies_insert on public.companies;
drop policy companies_update on public.companies;
drop policy companies_delete on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('customers.view')));
create policy companies_insert on public.companies for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_permission('customers.create')));
create policy companies_update on public.companies for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('customers.edit')))
  with check (organization_id in (select private.current_user_org_ids_with_permission('customers.edit')));
create policy companies_delete on public.companies for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    and organization_id in (select private.current_user_org_ids_with_permission('customers.edit'))
  );

drop policy contacts_select on public.contacts;
drop policy contacts_insert on public.contacts;
drop policy contacts_update on public.contacts;
drop policy contacts_delete on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('customers.view')));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_any_permission('{customers.create,customers.edit}')));
create policy contacts_update on public.contacts for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('customers.edit')))
  with check (organization_id in (select private.current_user_org_ids_with_permission('customers.edit')));
create policy contacts_delete on public.contacts for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    and organization_id in (select private.current_user_org_ids_with_permission('customers.edit'))
  );

drop policy opportunities_select on public.opportunities;
drop policy opportunities_insert on public.opportunities;
drop policy opportunities_update on public.opportunities;
drop policy opportunities_delete on public.opportunities;
create policy opportunities_select on public.opportunities for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission('{opportunities.view,pipeline.view}')));
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_permission('opportunities.create')));
create policy opportunities_update on public.opportunities for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('opportunities.edit')))
  with check (organization_id in (select private.current_user_org_ids_with_permission('opportunities.edit')));
create policy opportunities_delete on public.opportunities for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    and organization_id in (select private.current_user_org_ids_with_permission('opportunities.edit'))
  );

drop policy leads_select on public.leads;
drop policy leads_insert on public.leads;
drop policy leads_update on public.leads;
drop policy leads_delete on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('leads.view')));
create policy leads_insert on public.leads for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_permission('leads.create')));
create policy leads_update on public.leads for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('leads.edit')))
  with check (organization_id in (select private.current_user_org_ids_with_permission('leads.edit')));
create policy leads_delete on public.leads for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    and organization_id in (select private.current_user_org_ids_with_permission('leads.edit'))
  );

drop policy tasks_select on public.tasks;
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
drop policy tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission('{tasks.view,calendar.view}')));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids_with_permission('tasks.create'))
  );
create policy tasks_update on public.tasks for update to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_permission('tasks.edit'))
    and (
      assigned_user_id = (select auth.uid())
      or created_by = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    )
  )
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids_with_permission('tasks.edit'))
  );
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_permission('tasks.edit'))
    and (
      created_by = (select auth.uid())
      or organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    )
  );

-- Activities (the timeline of customers, leads and deals): with a view right
-- of one of them; written with an edit right.
drop policy activities_select on public.activities;
drop policy activities_insert on public.activities;
drop policy activities_update on public.activities;
drop policy activities_delete on public.activities;
create policy activities_select on public.activities for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{customers.view,leads.view,opportunities.view}')));
create policy activities_insert on public.activities for insert to authenticated
  with check (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids_with_any_permission(
      '{customers.edit,leads.edit,opportunities.edit}'))
  );
create policy activities_update on public.activities for update to authenticated
  using (
    source <> 'system'
    and organization_id in (select private.current_user_org_ids_with_any_permission(
      '{customers.edit,leads.edit,opportunities.edit}'))
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
    organization_id in (select private.current_user_org_ids_with_any_permission(
      '{customers.edit,leads.edit,opportunities.edit}'))
    and (
      organization_id in (select private.current_user_org_ids_with_role('{owner,admin}'))
      or (
        source <> 'system'
        and (created_by = (select auth.uid()) or performed_by_user_id = (select auth.uid()))
      )
    )
  );

drop policy offers_select on public.offers;
drop policy offers_insert on public.offers;
drop policy offers_update on public.offers;
drop policy offers_delete on public.offers;
create policy offers_select on public.offers for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{opportunities.view,feedback.view,follow_up.view}')));
create policy offers_insert on public.offers for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{opportunities.edit,follow_up.create}')));
create policy offers_update on public.offers for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{opportunities.edit,follow_up.edit}')))
  with check (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{opportunities.edit,follow_up.edit}')));
create policy offers_delete on public.offers for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_role('{owner,admin,manager}'))
    and organization_id in (select private.current_user_org_ids_with_permission('opportunities.edit'))
  );

drop policy reminders_select on public.reminders;
drop policy reminders_insert on public.reminders;
drop policy reminders_update on public.reminders;
drop policy reminders_delete on public.reminders;
create policy reminders_select on public.reminders for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{tasks.view,leads.view,opportunities.view}')));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_any_permission(
    '{tasks.edit,leads.edit,opportunities.edit}')));
create policy reminders_update on public.reminders for update to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_any_permission(
      '{tasks.edit,leads.edit,opportunities.edit}'))
    and (recipient_user_id = (select auth.uid()) or created_by = (select auth.uid()))
  )
  with check (organization_id in (select private.current_user_org_ids()));
create policy reminders_delete on public.reminders for delete to authenticated
  using (
    organization_id in (select private.current_user_org_ids_with_any_permission(
      '{tasks.edit,leads.edit,opportunities.edit}'))
    and (recipient_user_id = (select auth.uid()) or created_by = (select auth.uid()))
  );

-- Follow-up Engine
drop policy offer_documents_select on public.offer_documents;
drop policy offer_documents_insert on public.offer_documents;
drop policy offer_documents_update on public.offer_documents;
create policy offer_documents_select on public.offer_documents for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('follow_up.view')));
create policy offer_documents_insert on public.offer_documents for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids_with_permission('follow_up.create')));
create policy offer_documents_update on public.offer_documents for update to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('follow_up.edit')))
  with check (organization_id in (select private.current_user_org_ids_with_permission('follow_up.edit')));

drop policy offer_share_links_select on public.offer_share_links;
create policy offer_share_links_select on public.offer_share_links for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('follow_up.view')));

drop policy offer_engagement_events_select on public.offer_engagement_events;
create policy offer_engagement_events_select on public.offer_engagement_events
  for select to authenticated
  using (organization_id in (select private.current_user_org_ids_with_permission('follow_up.view')));

drop policy offer_documents_objects_select on storage.objects;
drop policy offer_documents_objects_insert on storage.objects;
create policy offer_documents_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'offer-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from private.current_user_org_ids_with_permission('follow_up.view') as org_id
    )
  );
create policy offer_documents_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'offer-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from private.current_user_org_ids_with_permission('follow_up.create') as org_id
    )
  );

-- Notifications: one's own, with the right to notifications; a push device
-- only with the administrator's web push right (separate from the browser's
-- own permission, which the member gives on the device).
drop policy push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids_with_permission('notifications.web_push'))
  );

drop policy notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids_with_permission('notifications.view'))
  );

drop policy notification_settings_own on public.notification_settings;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids_with_permission('notifications.view'))
  );

drop policy notification_deliveries_own on public.notification_deliveries;
create policy notification_deliveries_own on public.notification_deliveries for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and organization_id in (select private.current_user_org_ids_with_permission('notifications.view'))
  );

-- -----------------------------------------------------------------------------
-- my_access: the caller's role and rights in an organization (for clients).
-- -----------------------------------------------------------------------------
create or replace function public.my_access(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', private.app_role(m.role),
    'permissions', coalesce(
      case when m.role = 'owner'
        then (select jsonb_agg(d.key order by d.sort_order) from private.permission_definitions d)
        else (select jsonb_agg(mp.permission_key order by d.sort_order)
                from public.member_permissions mp
                join private.permission_definitions d on d.key = mp.permission_key
               where mp.organization_id = m.organization_id and mp.user_id = m.user_id)
      end, '[]'::jsonb)
  )
  from public.organization_members m
  where m.organization_id = p_org
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

-- =============================================================================
-- Server functions (service role only). The server has signed the actor in,
-- resolved their organization and checked the rules; these check them again
-- and write the change and its log entry in one transaction.
-- =============================================================================

-- Raised as 42501 with a stable reason the server maps to its message.
create or replace function private.deny(reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'renvara: %', reason using errcode = 'insufficient_privilege';
end;
$$;

/** Why `p_actor` may not do `p_action` to `p_target` (rules.ts manageDenial), or null. */
create or replace function private.manage_denial(p_org uuid, p_actor uuid, p_target uuid, p_action text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  target_role public.member_role;
begin
  select m.role into actor_role from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_actor and m.status = 'active';
  if actor_role is null or not private.member_has_permission(p_org, p_actor, 'users.' || p_action) then
    return 'forbidden';
  end if;
  if p_actor = p_target then
    if p_action = 'deactivate' then return 'self_deactivate'; end if;
    if p_action = 'manage_permissions' then return 'self_access'; end if;
    return null;
  end if;
  select m.role into target_role from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_target and m.status <> 'removed';
  if target_role is null then return 'not_found'; end if;
  if target_role in ('owner', 'admin') and actor_role <> 'owner' then return 'owner_only'; end if;
  return null;
end;
$$;

/** Problems of a set of rights for a role (permissions.js permissionSetErrors), or null. */
create or replace function private.permission_set_problem(p_keys text[], p_role text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'unknown: ' || k from unnest(p_keys) k
      where not exists (select 1 from private.permission_definitions d where d.key = k) limit 1),
    (select 'requires: ' || d.key from private.permission_definitions d
      where d.key = any (p_keys) and not (d.requires <@ p_keys) limit 1),
    (select 'admin_only: ' || d.key from private.permission_definitions d
      where d.key = any (p_keys) and d.admin_only and p_role = 'user' limit 1)
  );
$$;

create or replace function private.member_json(p_org uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'firstName', coalesce(p.first_name, ''),
    'lastName', coalesce(p.last_name, ''),
    'oib', coalesce(p.oib, ''),
    'email', coalesce(p.email, ''),
    'phone', coalesce(p.phone, ''),
    'role', private.app_role(m.role),
    'status', case when m.status = 'active' then 'active' else 'inactive' end,
    'createdAt', m.created_at,
    'createdBy', m.invited_by,
    'updatedAt', greatest(m.updated_at, p.updated_at),
    'deactivatedAt', m.deactivated_at,
    'deactivatedBy', m.deactivated_by,
    'lastLoginAt', p.last_login_at,
    'permissions', case when m.role = 'owner' then '[]'::jsonb else coalesce(
      (select jsonb_agg(mp.permission_key order by d.sort_order)
         from public.member_permissions mp
         join private.permission_definitions d on d.key = mp.permission_key
        where mp.organization_id = m.organization_id and mp.user_id = m.user_id), '[]'::jsonb) end
  )
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.user_id = p_user and m.status <> 'removed';
$$;

create or replace function private.write_audit(
  p_org uuid, p_actor uuid, p_target uuid, p_action text, p_result text, p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (organization_id, actor_user_id, target_user_id, action, result, details)
  values (p_org, p_actor, p_target, p_action, p_result, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------- reads ---
create or replace function public.admin_get_member(p_org uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_json(p_org, p_user);
$$;

create or replace function public.admin_find_member_by_email(p_org uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_json(p_org, p.id)
  from public.profiles p
  join public.organization_members m on m.user_id = p.id and m.organization_id = p_org
  where lower(p.email) = lower(btrim(p_email)) and m.status <> 'removed'
  limit 1;
$$;

create or replace function public.admin_active_owner_count(p_org uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.organization_members
   where organization_id = p_org and role = 'owner' and status = 'active';
$$;

/** One page of members: status 'active' | 'inactive' | 'all', search, sort. */
create or replace function public.admin_list_members(
  p_org uuid, p_status text, p_q text, p_sort text, p_dir text, p_page int, p_page_size int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  needle text := lower(btrim(coalesce(p_q, '')));
  result jsonb;
begin
  with rows as (
    select p.id, coalesce(p.first_name, '') as first_name, coalesce(p.last_name, '') as last_name,
           coalesce(p.email, '') as email, coalesce(p.phone, '') as phone,
           private.app_role(m.role) as role,
           case when m.status = 'active' then 'active' else 'inactive' end as status,
           p.last_login_at, m.created_at
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org
      and m.status <> 'removed'
      and (p_status = 'all' or (p_status = 'active') = (m.status = 'active'))
      and (needle = '' or lower(concat_ws(' ', p.first_name, p.last_name, p.email, p.phone)) like '%' || needle || '%')
  ),
  ordered as (
    select r.*, count(*) over () as total,
           row_number() over (order by
             case when p_dir = 'desc' then null else
               case p_sort
                 when 'firstName' then lower(r.first_name) when 'lastName' then lower(r.last_name)
                 when 'email' then r.email when 'phone' then r.phone when 'status' then r.status
                 when 'lastLoginAt' then coalesce(to_char(r.last_login_at, 'YYYYMMDDHH24MISS'), '')
                 when 'createdAt' then to_char(r.created_at, 'YYYYMMDDHH24MISS')
               end end asc nulls last,
             case when p_dir = 'desc' then
               case p_sort
                 when 'firstName' then lower(r.first_name) when 'lastName' then lower(r.last_name)
                 when 'email' then r.email when 'phone' then r.phone when 'status' then r.status
                 when 'lastLoginAt' then coalesce(to_char(r.last_login_at, 'YYYYMMDDHH24MISS'), '')
                 when 'createdAt' then to_char(r.created_at, 'YYYYMMDDHH24MISS')
               end end desc nulls last,
             lower(r.last_name), r.id) as n
    from rows r
  )
  select jsonb_build_object(
    'total', coalesce(max(o.total), 0),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'firstName', o.first_name, 'lastName', o.last_name, 'email', o.email,
      'phone', o.phone, 'role', o.role, 'status', o.status,
      'lastLoginAt', o.last_login_at, 'createdAt', o.created_at) order by o.n)
      filter (where o.n > (greatest(p_page, 1) - 1) * p_page_size and o.n <= greatest(p_page, 1) * p_page_size),
      '[]'::jsonb)
  ) into result
  from ordered o;
  return result;
end;
$$;

create or replace function public.admin_member_audit(p_org uuid, p_user uuid, p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'organizationId', a.organization_id, 'actorUserId', a.actor_user_id,
    'targetUserId', a.target_user_id, 'action', a.action, 'result', a.result,
    'details', a.details, 'at', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from (
    select * from public.admin_audit_log
     where organization_id = p_org and target_user_id = p_user
     order by created_at desc
     limit least(greatest(p_limit, 1), 100)
  ) a;
$$;

-- --------------------------------------------------------------- writes ---
/** A new member whose Supabase Auth account (invited) is `p_user`. */
create or replace function public.admin_create_member(
  p_org uuid, p_actor uuid, p_user uuid,
  p_first_name text, p_last_name text, p_oib text, p_email text, p_phone text,
  p_role text, p_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  keys text[] := coalesce(p_permissions, '{}');
  problem text;
begin
  select m.role into actor_role from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_actor and m.status = 'active';
  if actor_role is null or not private.member_has_permission(p_org, p_actor, 'users.create') then
    perform private.deny('forbidden');
  end if;
  if private.db_role(p_role) is null then
    raise exception 'renvara: invalid role' using errcode = 'check_violation';
  end if;
  if p_role <> 'user' and actor_role <> 'owner' then
    perform private.deny('role_owner_only');
  end if;
  if p_role <> 'owner' then
    problem := private.permission_set_problem(keys, p_role);
    if problem is not null then
      raise exception 'renvara: %', problem using errcode = 'check_violation';
    end if;
    if actor_role <> 'owner' and exists (
      select 1 from unnest(keys) k where not private.member_has_permission(p_org, p_actor, k)
    ) then
      perform private.deny('beyond_own_rights');
    end if;
  end if;
  if exists (
    select 1 from public.profiles p
    join public.organization_members m on m.user_id = p.id and m.organization_id = p_org
    where lower(p.email) = lower(btrim(p_email)) and p.id <> p_user and m.status <> 'removed'
  ) then
    raise exception 'renvara: email_taken' using errcode = 'unique_violation';
  end if;

  update public.profiles
     set first_name = btrim(p_first_name), last_name = btrim(p_last_name),
         full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         oib = nullif(btrim(p_oib), ''), phone = nullif(btrim(p_phone), ''),
         email = lower(btrim(p_email))
   where id = p_user;
  if not found then
    raise exception 'renvara: account not found' using errcode = 'foreign_key_violation';
  end if;

  insert into public.organization_members (organization_id, user_id, role, status, invited_by)
  values (p_org, p_user, private.db_role(p_role), 'active', p_actor);
  -- The defaults from the insert trigger are replaced by the chosen rights.
  delete from public.member_permissions where organization_id = p_org and user_id = p_user;
  if p_role <> 'owner' then
    insert into public.member_permissions (organization_id, user_id, permission_key, granted_by)
    select p_org, p_user, k, p_actor from unnest(keys) k;
  end if;

  perform private.write_audit(p_org, p_actor, p_user, 'user.create', 'success',
    jsonb_build_object('role', p_role, 'rights', case when p_role = 'owner' then to_jsonb('all'::text)
      else to_jsonb(cardinality(keys)) end));
  return private.member_json(p_org, p_user);
end;
$$;

create or replace function public.admin_update_member(
  p_org uuid, p_actor uuid, p_user uuid,
  p_first_name text, p_last_name text, p_oib text, p_email text, p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  denial text := private.manage_denial(p_org, p_actor, p_user, 'edit');
  before public.profiles;
  changed text[] := '{}';
begin
  if denial is not null then perform private.deny(denial); end if;
  select * into before from public.profiles where id = p_user;
  if before.first_name is distinct from btrim(p_first_name) then changed := array_append(changed, 'firstName'); end if;
  if before.last_name is distinct from btrim(p_last_name) then changed := array_append(changed, 'lastName'); end if;
  if coalesce(before.oib, '') is distinct from btrim(coalesce(p_oib, '')) then changed := array_append(changed, 'oib'); end if;
  if lower(coalesce(before.email, '')) is distinct from lower(btrim(p_email)) then changed := array_append(changed, 'email'); end if;
  if coalesce(before.phone, '') is distinct from btrim(coalesce(p_phone, '')) then changed := array_append(changed, 'phone'); end if;
  if cardinality(changed) > 0 then
    update public.profiles
       set first_name = btrim(p_first_name), last_name = btrim(p_last_name),
           full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
           oib = nullif(btrim(p_oib), ''), phone = nullif(btrim(p_phone), ''),
           email = lower(btrim(p_email))
     where id = p_user;
    perform private.write_audit(p_org, p_actor, p_user, 'user.update', 'success',
      jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return private.member_json(p_org, p_user);
end;
$$;

/** p_status: 'active' | 'inactive'. Deactivation keeps every record. */
create or replace function public.admin_set_member_status(p_org uuid, p_actor uuid, p_user uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  denial text := private.manage_denial(p_org, p_actor, p_user, 'deactivate');
  target public.organization_members;
begin
  if denial is not null then perform private.deny(denial); end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'renvara: invalid status' using errcode = 'check_violation';
  end if;
  select * into target from public.organization_members
   where organization_id = p_org and user_id = p_user;
  if (target.status = 'active') = (p_status = 'active') then
    raise exception 'renvara: unchanged' using errcode = 'check_violation';
  end if;
  update public.organization_members
     set status = case when p_status = 'active' then 'active'::public.member_status
                       else 'suspended'::public.member_status end,
         deactivated_at = case when p_status = 'active' then null else now() end,
         deactivated_by = case when p_status = 'active' then null else p_actor end
   where organization_id = p_org and user_id = p_user;
  perform private.write_audit(p_org, p_actor, p_user,
    case when p_status = 'active' then 'user.activate' else 'user.deactivate' end, 'success', '{}'::jsonb);
  return private.member_json(p_org, p_user);
end;
$$;

create or replace function public.admin_set_member_access(
  p_org uuid, p_actor uuid, p_user uuid, p_role text, p_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  denial text := private.manage_denial(p_org, p_actor, p_user, 'manage_permissions');
  actor_role public.member_role;
  target public.organization_members;
  current_keys text[];
  next_keys text[];
  granted text[];
  revoked text[];
  problem text;
begin
  if denial is not null then perform private.deny(denial); end if;
  if private.db_role(p_role) is null then
    raise exception 'renvara: invalid role' using errcode = 'check_violation';
  end if;
  select m.role into actor_role from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_actor;
  select * into target from public.organization_members
   where organization_id = p_org and user_id = p_user;

  if private.app_role(target.role) <> p_role then
    if actor_role <> 'owner' then perform private.deny('role_owner_only'); end if;
  end if;

  current_keys := case when target.role = 'owner'
    then (select array_agg(d.key) from private.permission_definitions d)
    else coalesce((select array_agg(permission_key) from public.member_permissions
                    where organization_id = p_org and user_id = p_user), '{}') end;
  next_keys := case when p_role = 'owner'
    then (select array_agg(d.key) from private.permission_definitions d)
    else coalesce(p_permissions, '{}') end;
  granted := coalesce((select array_agg(k) from unnest(next_keys) k where not k = any (current_keys)), '{}');
  revoked := coalesce((select array_agg(k) from unnest(current_keys) k where not k = any (next_keys)), '{}');

  if p_role <> 'owner' then
    problem := private.permission_set_problem(next_keys, p_role);
    if problem is not null then
      raise exception 'renvara: %', problem using errcode = 'check_violation';
    end if;
    if actor_role <> 'owner' and exists (
      select 1 from unnest(granted || revoked) k where not private.member_has_permission(p_org, p_actor, k)
    ) then
      perform private.deny('beyond_own_rights');
    end if;
  end if;

  -- The membership guard keeps at least one active owner.
  update public.organization_members set role = private.db_role(p_role)
   where organization_id = p_org and user_id = p_user and role is distinct from private.db_role(p_role);
  delete from public.member_permissions where organization_id = p_org and user_id = p_user;
  if p_role <> 'owner' then
    insert into public.member_permissions (organization_id, user_id, permission_key, granted_by)
    select p_org, p_user, k, p_actor from unnest(next_keys) k;
  end if;

  perform private.write_audit(p_org, p_actor, p_user, 'user.access', 'success',
    jsonb_strip_nulls(jsonb_build_object(
      'role', case when private.app_role(target.role) <> p_role
        then jsonb_build_object('from', private.app_role(target.role), 'to', p_role) end,
      'granted', to_jsonb(granted),
      'revoked', to_jsonb(revoked))));
  return private.member_json(p_org, p_user);
end;
$$;

create or replace function public.admin_touch_login(p_org uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_login_at = now()
   where id = p_user
     and exists (select 1 from public.organization_members m
                  where m.organization_id = p_org and m.user_id = p_user and m.status = 'active');
$$;

/** Entries the server writes itself: refusals, password changes and links. */
create or replace function public.admin_log(
  p_org uuid, p_actor uuid, p_target uuid, p_action text, p_result text, p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_target is not null and not exists (
    select 1 from public.organization_members where organization_id = p_org and user_id = p_target
  ) then
    raise exception 'renvara: not a member' using errcode = 'foreign_key_violation';
  end if;
  perform private.write_audit(p_org, p_actor, p_target, p_action, p_result, p_details);
end;
$$;

-- Only the server (service role) calls the admin functions; my_access is for members.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_get_member(uuid, uuid)',
    'public.admin_find_member_by_email(uuid, text)',
    'public.admin_active_owner_count(uuid)',
    'public.admin_list_members(uuid, text, text, text, text, int, int)',
    'public.admin_member_audit(uuid, uuid, int)',
    'public.admin_create_member(uuid, uuid, uuid, text, text, text, text, text, text, text[])',
    'public.admin_update_member(uuid, uuid, uuid, text, text, text, text, text)',
    'public.admin_set_member_status(uuid, uuid, uuid, text)',
    'public.admin_set_member_access(uuid, uuid, uuid, text, text[])',
    'public.admin_touch_login(uuid, uuid)',
    'public.admin_log(uuid, uuid, uuid, text, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

revoke all on function public.my_access(uuid) from public, anon;
grant execute on function public.my_access(uuid) to authenticated;

revoke all on function private.manage_denial(uuid, uuid, uuid, text) from public;
revoke all on function private.permission_set_problem(text[], text) from public;
revoke all on function private.member_json(uuid, uuid) from public;
revoke all on function private.write_audit(uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function private.grant_default_permissions() from public;
revoke all on function private.guard_membership_rights() from public;
