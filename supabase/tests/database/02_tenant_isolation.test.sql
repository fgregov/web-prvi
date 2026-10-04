-- A member of Org B must never read, write or reference Org A data,
-- whatever ids they send. Org A members see only Org A.
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
select plan(19);

-- ------------------------------------------------------------------ Bob (B) --
select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');

select is((select count(*)::int from public.organizations), 1, 'Bob sees only his organization');
select is((select count(*)::int from public.organization_members), 1, 'Bob sees only Org B memberships');
select is((select count(*)::int from public.profiles), 1, 'Bob sees only profiles of people sharing an org');
select is((select count(*)::int from public.companies), 1, 'Bob sees only Org B companies');
select is((select count(*)::int from public.contacts), 0, 'Bob sees no Org A contacts');
select is((select count(*)::int from public.opportunities), 0, 'Bob sees no Org A opportunities');
select is((select count(*)::int from public.opportunity_overview), 0, 'Bob sees no Org A rows through the overview view');
select is((select count(*)::int from public.activities where organization_id = '0a000000-0000-4000-8000-00000000000a'), 0,
  'Bob cannot select Org A activities even by filtering on its id');

select throws_ok(
  $$ insert into public.companies (organization_id, name) values ('0a000000-0000-4000-8000-00000000000a', 'Injected') $$,
  '42501', null, 'Bob cannot insert a company into Org A'
);

select throws_ok(
  $$ insert into public.contacts (organization_id, company_id, first_name)
     values ('0b000000-0000-4000-8000-00000000000b', 'ca000000-0000-4000-8000-0000000000a1', 'Cross') $$,
  '23503', null, 'Bob cannot link his contact to an Org A company (composite FK)'
);

select throws_ok(
  $$ insert into public.tasks (organization_id, title, assigned_user_id)
     values ('0b000000-0000-4000-8000-00000000000b', 'Steal', 'c3000000-0000-4000-8000-000000000003') $$,
  '23503', null, 'Bob cannot assign a task to a member of another organization'
);

update public.companies set name = 'Hacked' where id = 'ca000000-0000-4000-8000-0000000000a1';
delete from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1';
select lives_ok($$ select public.create_organization('Bob Side Project') $$, 'any user may create a new organization');

reset role;
select is((select name from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1'), 'FERO-TERM',
  'Bob''s update/delete of an Org A company silently affected nothing');

-- ---------------------------------------------------------------- Carol (A) --
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.companies), 1, 'Carol sees Org A companies only');
select is((select count(*)::int from public.profiles), 3, 'Carol sees her three Org A teammates (incl. herself)');

-- ------------------------------------------------ suspended member (Carol) --
reset role;
select set_config('request.jwt.claims', '', true);
update public.organization_members set status = 'suspended'
 where user_id = 'c3000000-0000-4000-8000-000000000003';
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.companies), 0, 'a suspended member loses all access');
select is((select count(*)::int from public.organizations), 0, 'a suspended member no longer sees the organization');

-- --------------------------------------------------------------------- anon --
reset role;
set local role anon;
select throws_ok($$ select * from public.companies $$, '42501', null, 'anon is denied outright');
select throws_ok($$ select * from public.opportunity_overview $$, '42501', null, 'anon is denied on views');

select * from finish();
rollback;
