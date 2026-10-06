-- Task scheduling (Sales Calendar as a view over tasks), new task types,
-- task sources and the task link rules.
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
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM'),
  ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Adria Tech'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico');

insert into public.contacts (id, organization_id, company_id, first_name, last_name) values
  ('ea000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'Marko', 'Lukač'),
  ('ea000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a2', 'Ivana', 'Kovač');

insert into public.opportunities (id, organization_id, company_id, title) values
  ('0aa00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'Grijanje hale');
-- ------------------------------------------------------------ end fixtures --
select plan(21);

select has_column('public', 'tasks', 'scheduled_start_at', 'tasks.scheduled_start_at exists');
select has_column('public', 'tasks', 'scheduled_end_at', 'tasks.scheduled_end_at exists');
select has_column('public', 'tasks', 'is_all_day', 'tasks.is_all_day exists');
select has_column('public', 'tasks', 'source', 'tasks.source exists');
select has_index('public', 'tasks', 'tasks_calendar_idx', 'calendar range index exists');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------- independent tasks --
select lives_ok($$
  insert into public.tasks (id, organization_id, title, type)
  values ('7a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a', 'Pripremiti kvartalni izvještaj', 'general')
$$, 'a task needs no company, contact, opportunity or date');

select lives_ok($$
  update public.tasks
  set scheduled_start_at = date_trunc('day', now()) + interval '14 hours',
      scheduled_end_at   = date_trunc('day', now()) + interval '15 hours'
  where id = '7a000000-0000-4000-8000-000000000001'
$$, 'the same task can be put in the calendar later');

select is(
  (select count(*)::int from public.tasks
   where organization_id = '0a000000-0000-4000-8000-00000000000a'
     and scheduled_start_at >= date_trunc('day', now())
     and scheduled_start_at <  date_trunc('day', now()) + interval '1 day'),
  1, 'the calendar is a range query over tasks');

select lives_ok($$
  insert into public.tasks (organization_id, title, type, priority)
  values ('0a000000-0000-4000-8000-00000000000a', 'Poslati ponudu', 'send_offer', 'high')
$$, 'send_offer is a task type');

-- ----------------------------------------------------------- schedule rules --
select throws_ok($$
  insert into public.tasks (organization_id, title, scheduled_start_at, scheduled_end_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', now(), now() - interval '1 hour')
$$, '23514', null, 'the end of a calendar slot cannot be before its start');

select throws_ok($$
  insert into public.tasks (organization_id, title, scheduled_end_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', now())
$$, '23514', null, 'an end without a start is rejected');

select throws_ok($$
  insert into public.tasks (organization_id, title, is_all_day, scheduled_start_at, scheduled_end_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', true, now(), now() + interval '1 hour')
$$, '23514', null, 'an all-day entry has no end time');

-- ---------------------------------------------------------------- links ---
select throws_ok($$
  insert into public.tasks (organization_id, title, company_id, contact_id)
  values ('0a000000-0000-4000-8000-00000000000a', 'X',
          'ca000000-0000-4000-8000-0000000000a2', 'ea000000-0000-4000-8000-0000000000a1')
$$, '23514', null, 'a contact of another company is rejected');

select throws_ok($$
  insert into public.tasks (organization_id, title, opportunity_id, contact_id)
  values ('0a000000-0000-4000-8000-00000000000a', 'X',
          '0aa00000-0000-4000-8000-0000000000a1', 'ea000000-0000-4000-8000-0000000000a2')
$$, '23514', null, 'the company derived from the opportunity must match the contact');

insert into public.tasks (id, organization_id, title, type, contact_id, scheduled_start_at)
values ('7a000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'Follow-up FERO-TERM', 'follow_up', 'ea000000-0000-4000-8000-0000000000a1',
        date_trunc('day', now()) + interval '9 hours');
select is((select company_id from public.tasks where id = '7a000000-0000-4000-8000-000000000002'),
  'ca000000-0000-4000-8000-0000000000a1'::uuid, 'the company is derived from the contact');

select throws_ok($$
  insert into public.tasks (organization_id, title, company_id)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', 'cb000000-0000-4000-8000-0000000000b1')
$$, '23503', null, 'a company of another organization is rejected');

select throws_ok($$
  insert into public.tasks (organization_id, title, source)
  values ('0a000000-0000-4000-8000-00000000000a', 'X', 'system')
$$, '42501', null, 'clients cannot create system tasks');

-- ------------------------------------------------- completion keeps history --
update public.tasks set status = 'completed' where id = '7a000000-0000-4000-8000-000000000002';
select isnt((select closed_at from public.tasks where id = '7a000000-0000-4000-8000-000000000002'),
  null, 'completing sets closed_at');
select is(
  (select count(*)::int from public.tasks
   where id = '7a000000-0000-4000-8000-000000000002' and scheduled_start_at is not null),
  1, 'a completed task keeps its calendar slot (history)');

-- -------------------------------------------- next action uses the slot too --
insert into public.tasks (organization_id, opportunity_id, title, scheduled_start_at)
values ('0a000000-0000-4000-8000-00000000000a', '0aa00000-0000-4000-8000-0000000000a1',
        'Sastanak', now() + interval '2 days');
insert into public.tasks (organization_id, opportunity_id, title, due_at)
values ('0a000000-0000-4000-8000-00000000000a', '0aa00000-0000-4000-8000-0000000000a1',
        'Poslati ponudu', now() + interval '1 day');
select is((select next_task_title from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  'Poslati ponudu', 'the earliest moment wins: deadline tomorrow before a slot in two days');
select is((select needs_next_action from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  false, 'a scheduled open task is a next action');

select * from finish();
rollback;
