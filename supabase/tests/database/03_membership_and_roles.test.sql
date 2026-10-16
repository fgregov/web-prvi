-- Role and membership invariants.
begin;
create extension if not exists pgtap with schema extensions;
-- ---------------------------------------------------------------- fixtures --
set local search_path = public, extensions;

create function pg_temp.login_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end
$f$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'alice@org-a.test', '{"full_name":"Alice Owner"}'),
  ('d4000000-0000-4000-8000-000000000004', 'dave@org-a.test',  '{"full_name":"Dave Admin"}'),
  ('c3000000-0000-4000-8000-000000000003', 'carol@org-a.test', '{"full_name":"Carol Sales"}'),
  ('b2000000-0000-4000-8000-000000000002', 'bob@org-b.test',   '{"full_name":"Bob Owner"}');

insert into public.organizations (id, name, timezone) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A d.o.o.', 'Europe/Zagreb'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B GmbH',   'Europe/Berlin');

insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'admin'),
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'sales'),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'owner');

insert into public.companies (id, organization_id, name, owner_user_id) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM', 'c3000000-0000-4000-8000-000000000003'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico',    'b2000000-0000-4000-8000-000000000002');

insert into public.contacts (id, organization_id, company_id, first_name, last_name, is_primary) values
  ('ea000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'Marko', 'Lukač', true);

insert into public.opportunities (id, organization_id, company_id, primary_contact_id, owner_user_id, title, estimated_value, currency, stage) values
  ('0aa00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1',
   'ea000000-0000-4000-8000-0000000000a1', 'c3000000-0000-4000-8000-000000000003', 'Vending machine deployment', 5000, 'EUR', 'proposal');
-- ------------------------------------------------------------ end fixtures --
select plan(14);

-- create_organization makes the caller the owner.
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select lives_ok($$ select public.create_organization('Carol Consulting', 'Europe/Zagreb', 'eur') $$,
  'any authenticated user can create an organization');
select is(
  (select m.role::text from public.organization_members m
     join public.organizations o on o.id = m.organization_id
    where o.name = 'Carol Consulting' and m.user_id = auth.uid() and m.status = 'active'),
  'owner', 'create_organization makes the caller an active owner'
);
select is((select count(*)::int from public.organizations), 2, 'Carol now belongs to two organizations');
select throws_ok($$ insert into public.organizations (name) values ('Direct') $$, '42501', null,
  'organizations cannot be inserted directly');
select throws_ok($$ insert into public.organization_members (organization_id, user_id, role)
  values ('0a000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-000000000002', 'owner') $$,
  '42501', null, 'memberships cannot be inserted directly by clients');

-- Sales cannot manage members or organization settings.
update public.organization_members set role = 'admin' where user_id = 'c3000000-0000-4000-8000-000000000003'
  and organization_id = '0a000000-0000-4000-8000-00000000000a';
update public.organizations set name = 'Renamed' where id = '0a000000-0000-4000-8000-00000000000a';
reset role;
select is((select role::text from public.organization_members where user_id = 'c3000000-0000-4000-8000-000000000003'
  and organization_id = '0a000000-0000-4000-8000-00000000000a'), 'sales', 'sales cannot change memberships');
select is((select name from public.organizations where id = '0a000000-0000-4000-8000-00000000000a'), 'Org A d.o.o.',
  'sales cannot change organization settings');

-- Admin (Dave)
select pg_temp.login_as('d4000000-0000-4000-8000-000000000004');
select lives_ok($$ update public.organization_members set role = 'manager'
  where user_id = 'c3000000-0000-4000-8000-000000000003' and organization_id = '0a000000-0000-4000-8000-00000000000a' $$,
  'admin can change a sales member''s role');
select throws_ok($$ update public.organization_members set role = 'owner'
  where user_id = 'c3000000-0000-4000-8000-000000000003' and organization_id = '0a000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'admin cannot grant the owner role');
select throws_ok($$ update public.organization_members set status = 'removed'
  where user_id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'admin cannot remove an owner');
select throws_ok($$ update public.organization_members set role = 'owner'
  where user_id = 'd4000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'members cannot change their own role');
select lives_ok($$ update public.organizations set name = 'Org A (renamed)' where id = '0a000000-0000-4000-8000-00000000000a' $$,
  'admin can update organization settings');

-- Owner (Alice)
reset role;
select pg_temp.login_as('a1000000-0000-4000-8000-000000000001');
select lives_ok($$ update public.organization_members set role = 'owner'
  where user_id = 'd4000000-0000-4000-8000-000000000004' $$, 'owner can grant the owner role');
reset role;
-- Back-office (no auth.uid()) still cannot leave an org without an owner.
select set_config('request.jwt.claims', '', true);
update public.organization_members set role = 'admin' where user_id = 'd4000000-0000-4000-8000-000000000004';
select throws_ok($$ update public.organization_members set status = 'removed'
  where user_id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the last active owner can never be removed');

select * from finish();
rollback;
