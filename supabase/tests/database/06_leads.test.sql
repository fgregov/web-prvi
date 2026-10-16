-- Leads: separate entity, lifecycle timestamps, conversion references,
-- tenant isolation, and lead links on tasks and activities.
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
  ('c3000000-0000-4000-8000-000000000003', 'carol@org-a.test', '{"full_name":"Carol Sales"}'),
  ('b2000000-0000-4000-8000-000000000002', 'bob@org-b.test',   '{"full_name":"Bob Owner"}');

insert into public.organizations (id, name, timezone) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A d.o.o.', 'Europe/Zagreb'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B GmbH',   'Europe/Berlin');

insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'sales'),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'owner');

insert into public.companies (id, organization_id, name) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ABC d.o.o.'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico');

insert into public.leads (id, organization_id, name) values
  ('1b000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Lead of org B');
-- ------------------------------------------------------------ end fixtures --
select plan(20);

select has_table('public', 'leads', 'leads is its own table');
select col_is_null('public', 'tasks', 'lead_id', 'tasks.lead_id is optional');
select col_is_null('public', 'activities', 'lead_id', 'activities.lead_id is optional');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ create --
select lives_ok($$
  insert into public.leads (id, organization_id, owner_user_id, name, company_name, phone, source)
  values ('1a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          'c3000000-0000-4000-8000-000000000003', 'Marko Horvat', 'ABC d.o.o.', '091 111 222', 'referral')
$$, 'a lead needs only a name');
select results_eq(
  $$select stage::text, status::text from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('new', 'active')$$,
  'a new lead is new and active');
select throws_ok($$
  insert into public.leads (organization_id, name) values ('0a000000-0000-4000-8000-00000000000a', '   ')
$$, '23514', null, 'a blank name is rejected');
select throws_ok($$
  insert into public.leads (organization_id, name, email) values ('0a000000-0000-4000-8000-00000000000a', 'X', 'not-an-email')
$$, '23514', null, 'an invalid e-mail is rejected');
select throws_ok($$
  insert into public.leads (organization_id, name, estimated_value, currency)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', -1, 'EUR')
$$, '23514', null, 'a negative value is rejected');

-- --------------------------------------------------------------- lifecycle --
update public.leads set stage = 'qualified' where id = '1a000000-0000-4000-8000-0000000000a1';
select isnt((select qualified_at from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  null, 'reaching qualified stamps qualified_at');

select throws_ok($$
  update public.leads set converted_customer_id = 'ca000000-0000-4000-8000-0000000000a1'
  where id = '1a000000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'an active lead cannot carry conversion references');

update public.leads
set status = 'won', converted_customer_id = 'ca000000-0000-4000-8000-0000000000a1'
where id = '1a000000-0000-4000-8000-0000000000a1';
select isnt((select converted_at from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  null, 'winning stamps converted_at');
select is((select count(*)::int from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  1, 'the converted lead is kept');

select throws_ok($$
  update public.leads set converted_customer_id = 'cb000000-0000-4000-8000-0000000000b1'
  where id = '1a000000-0000-4000-8000-0000000000a1'
$$, '23503', null, 'a lead cannot convert into another organization''s customer');

insert into public.leads (id, organization_id, name) values
  ('1a000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Kafić Centar');
update public.leads set status = 'lost', lost_reason = 'price' where id = '1a000000-0000-4000-8000-0000000000a2';
select results_eq(
  $$select status::text, lost_reason::text, lost_at is not null from public.leads where id = '1a000000-0000-4000-8000-0000000000a2'$$,
  $$values ('lost', 'price', true)$$,
  'losing stamps lost_at and keeps the reason');
select throws_ok($$
  insert into public.leads (organization_id, name, lost_reason) values ('0a000000-0000-4000-8000-00000000000a', 'X', 'price')
$$, '23514', null, 'a lost reason needs a lost lead');

-- ---------------------------------------------------------------- isolation --
select is((select count(*)::int from public.leads where id = '1b000000-0000-4000-8000-0000000000b1'),
  0, 'another organization''s leads are invisible');
select throws_ok($$
  insert into public.leads (organization_id, name) values ('0b000000-0000-4000-8000-00000000000b', 'Intruder')
$$, '42501', null, 'cannot create a lead in another organization');

-- ------------------------------------------------------- tasks & activities --
select lives_ok($$
  insert into public.tasks (organization_id, title, lead_id, scheduled_start_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'Follow-up Marko', '1a000000-0000-4000-8000-0000000000a2', now() + interval '1 day')
$$, 'a task can concern a lead without any company');
select throws_ok($$
  insert into public.tasks (organization_id, title, lead_id)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', '1b000000-0000-4000-8000-0000000000b1')
$$, '23503', null, 'a task cannot point at another organization''s lead');
select lives_ok($$
  insert into public.activities (organization_id, lead_id, type, title)
  values ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a2', 'phone_call', 'Poziv')
$$, 'an activity may concern only a lead');

select * from finish();
rollback;
