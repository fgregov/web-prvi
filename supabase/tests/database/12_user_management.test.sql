-- KORISNICI (ADR-0014): default rights, RLS by right, personal data,
-- the server's admin_* functions and their rules, the administration log.
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

-- The server: service role, no end-user identity.
create function pg_temp.as_server() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
end
$f$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'alice@org-a.test', '{"full_name":"Alice Owner"}'),
  ('d4000000-0000-4000-8000-000000000004', 'dave@org-a.test',  '{"full_name":"Dave Admin"}'),
  ('c3000000-0000-4000-8000-000000000003', 'carol@org-a.test', '{"full_name":"Carol Sales"}'),
  ('b2000000-0000-4000-8000-000000000002', 'bob@org-b.test',   '{"full_name":"Bob Owner"}'),
  ('e5000000-0000-4000-8000-000000000005', 'eve@org-a.test',   '{}');

insert into public.organizations (id, name, timezone) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A d.o.o.', 'Europe/Zagreb'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B GmbH',   'Europe/Berlin');

insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'admin'),
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'sales'),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'owner');

insert into public.companies (id, organization_id, name, owner_user_id) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM', 'c3000000-0000-4000-8000-000000000003');

select set_config('test.all_keys', (select array_agg(key order by key)::text from private.permission_definitions), true);
update public.profiles set oib = '69435151530', phone = '+385 91 111 2222', first_name = 'Carol', last_name = 'Sales'
 where id = 'c3000000-0000-4000-8000-000000000003';
-- ------------------------------------------------------------ end fixtures --
select plan(49);

-- ----------------------------------------------------------- defaults ---
select is((select count(*)::int from private.permission_definitions), 40, 'the catalog has 40 rights (38 + the two of IZVJEŠTAJI)');
select is((select count(*)::int from public.member_permissions where user_id = 'c3000000-0000-4000-8000-000000000003'),
  32, 'a new Korisnik gets the 32 default rights (no user administration, no comparing representatives)');
select is((select count(*)::int from public.member_permissions where user_id = 'd4000000-0000-4000-8000-000000000004'),
  40, 'a new administrator gets every right');
select is((select count(*)::int from public.member_permissions where user_id = 'a1000000-0000-4000-8000-000000000001'),
  0, 'an owner has no stored rights (holds all implicitly)');
select ok(private.is_valid_oib('69435151530') and not private.is_valid_oib('69435151531')
  and not private.is_valid_oib('1234567890'), 'OIB check digit (ISO 7064 MOD 11,10)');
select throws_ok($$ update public.profiles set oib = '12345678901' where id = 'c3000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'an invalid OIB is refused');

-- ------------------------------------------------- Carol (Korisnik) ---
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select ok(private.has_permission('0a000000-0000-4000-8000-00000000000a', 'customers.view'), 'Carol may see customers');
select ok(not private.has_permission('0a000000-0000-4000-8000-00000000000a', 'users.view'), 'Carol may not see the member list');
select is((select my_access('0a000000-0000-4000-8000-00000000000a') ->> 'role'), 'user', 'my_access: role Korisnik');
select is((select jsonb_array_length(my_access('0a000000-0000-4000-8000-00000000000a') -> 'permissions')), 32,
  'my_access: her rights');
select throws_ok($$ select oib from public.profiles $$, '42501', null, 'teammates cannot read the OIB column');
select throws_ok($$ select phone from public.profiles $$, '42501', null, 'teammates cannot read the phone column');
select is((select first_name from public.profiles where id = 'c3000000-0000-4000-8000-000000000003'), 'Carol',
  'names stay readable');
select is((select count(*)::int from public.admin_audit_log), 0, 'Carol cannot read the administration log');
select throws_ok($$ insert into public.member_permissions (organization_id, user_id, permission_key)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'users.view') $$,
  '42501', null, 'members cannot give themselves rights');
select throws_ok($$ select public.admin_set_member_status('0a000000-0000-4000-8000-00000000000a',
  'c3000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000004', 'inactive') $$,
  '42501', null, 'members cannot call the server functions');
select is((select count(*)::int from public.companies), 1, 'with customers.view Carol sees the customer');

-- A right taken away applies to the next query.
reset role;
delete from public.member_permissions
 where user_id = 'c3000000-0000-4000-8000-000000000003' and permission_key in ('customers.view', 'customers.create', 'customers.edit');
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.companies), 0, 'without customers.view RLS hides customers');
select throws_ok($$ insert into public.companies (organization_id, name) values ('0a000000-0000-4000-8000-00000000000a', 'Nova') $$,
  '42501', null, 'without customers.create RLS refuses a new customer');
select lives_ok($$ insert into public.leads (organization_id, name, company_name, owner_user_id)
  values ('0a000000-0000-4000-8000-00000000000a', 'Iva Lead', 'Lead d.o.o.', 'c3000000-0000-4000-8000-000000000003') $$,
  'with leads.create Carol still adds leads');

-- --------------------------------------------- direct membership edits ---
reset role;
delete from public.member_permissions
 where user_id = 'd4000000-0000-4000-8000-000000000004' and permission_key = 'users.deactivate';
select pg_temp.login_as('d4000000-0000-4000-8000-000000000004');
select throws_ok($$ update public.organization_members set status = 'suspended'
  where user_id = 'c3000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'suspending a member directly needs users.deactivate');
select is((select count(*)::int from public.admin_audit_log), 0, 'the log is empty so far (Dave may read it)');

-- --------------------------------------------- server: create member ---
reset role;
select pg_temp.as_server();
select throws_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'c3000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve@org-a.test', '+385 1 234 567', 'user', '{leads.view}') $$,
  '42501', null, 'a Korisnik cannot create members');
select throws_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve@org-a.test', '+385 1 234 567', 'admin', '{leads.view}') $$,
  '42501', null, 'only an owner creates an administrator');
select throws_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve@org-a.test', '+385 1 234 567', 'user', '{leads.create}') $$,
  '23514', null, 'a right without the right it requires is refused');
select throws_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve@org-a.test', '+385 1 234 567', 'user', '{users.view,users.create}') $$,
  '23514', null, 'user administration is for administrators only');
select throws_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'CAROL@org-a.test', '+385 1 234 567', 'user', '{leads.view}') $$,
  '23505', null, 'an e-mail already used in the organization is refused');
select lives_ok($$ select public.admin_create_member('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve@org-a.test', '+385 1 234 567', 'user', '{leads.view,leads.create}') $$,
  'an administrator creates a Korisnik with chosen rights');
select is((select array_agg(permission_key order by permission_key) from public.member_permissions
  where user_id = 'e5000000-0000-4000-8000-000000000005'), '{leads.create,leads.view}'::text[],
  'exactly the chosen rights are stored');
select is((select public.admin_get_member('0a000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000005') ->> 'firstName'),
  'Eve', 'the profile carries the names');

-- --------------------------------------------- server: status rules ---
select throws_ok($$ select public.admin_set_member_status('0a000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'inactive') $$,
  '42501', null, 'nobody deactivates themselves');
reset role;
insert into public.member_permissions (organization_id, user_id, permission_key)
values ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'users.deactivate');
select pg_temp.as_server();
select throws_ok($$ select public.admin_set_member_status('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'inactive') $$,
  '42501', null, 'an administrator cannot deactivate the owner');
select throws_ok($$ select public.admin_set_member_status('0b000000-0000-4000-8000-00000000000b',
  'b2000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000003', 'inactive') $$,
  '42501', null, 'another organization''s owner cannot reach an Org A member');
select lives_ok($$ select public.admin_set_member_status('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000003', 'inactive') $$,
  'an administrator deactivates a Korisnik');
reset role;
select is((select status::text || ':' || (deactivated_by = 'd4000000-0000-4000-8000-000000000004')::text
  from public.organization_members where user_id = 'c3000000-0000-4000-8000-000000000003'),
  'suspended:true', 'deactivated, with who and when; the membership is kept');
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.leads), 0, 'a deactivated member reads nothing, token or not');
reset role;
select is((select count(*)::int from public.leads where owner_user_id = 'c3000000-0000-4000-8000-000000000003'), 1,
  'her records stay');

-- --------------------------------------------- server: access rules ---
select pg_temp.as_server();
select throws_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000004', 'admin', '{leads.view}') $$,
  '42501', null, 'nobody changes their own rights');
reset role;
delete from public.member_permissions
 where user_id = 'd4000000-0000-4000-8000-000000000004' and permission_key = 'reports.view';
select pg_temp.as_server();
select throws_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005', 'user',
  '{leads.view,leads.create,opportunities.view,reports.view}') $$,
  '42501', null, 'an administrator cannot give a right they do not hold');
select throws_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005', 'admin', '{leads.view}') $$,
  '42501', null, 'only an owner changes roles');
select lives_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005', 'user',
  '{leads.view,customers.view}') $$,
  'an administrator changes a Korisnik''s rights within their own');
select lives_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000004', 'owner', '{}') $$,
  'the owner makes the administrator an owner');
select lives_ok($$ select public.admin_set_member_access('0a000000-0000-4000-8000-00000000000a',
  'd4000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'admin',
  current_setting('test.all_keys')::text[]) $$,
  'an owner demotes another owner while one active owner remains');

-- --------------------------------------------- server: profile edits ---
select lives_ok($$ select public.admin_update_member('0a000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005',
  'Eve', 'Nova', '69435151530', 'eve.nova@org-a.test', '+385 1 999 000') $$,
  'the owner edits a member''s data');
select throws_ok($$ select public.admin_update_member('0a000000-0000-4000-8000-00000000000a',
  'e5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001',
  'Alice', 'Owner', '', 'alice@org-a.test', '') $$,
  '42501', null, 'a Korisnik cannot edit someone else''s data');

-- ------------------------------------------------------------- log ---
reset role;
select is((select array_agg(action || ':' || result order by action) from public.admin_audit_log
  where organization_id = '0a000000-0000-4000-8000-00000000000a'),
  '{user.access:success,user.access:success,user.access:success,user.create:success,user.deactivate:success,user.update:success}'::text[],
  'every change is logged with its result');
select ok((select details ? 'granted' and details ? 'revoked' from public.admin_audit_log
  where target_user_id = 'e5000000-0000-4000-8000-000000000005' and action = 'user.access'),
  'a rights change logs what was granted and revoked');
select is((select details -> 'fields' from public.admin_audit_log where action = 'user.update'),
  '["email", "phone"]'::jsonb, 'a profile edit logs the names of the changed fields, not their values');
select throws_ok($$ update public.admin_audit_log set result = 'denied' $$, '42501', null,
  'the administration log is append-only');

select * from finish();
rollback;
