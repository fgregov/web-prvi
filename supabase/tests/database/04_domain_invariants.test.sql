-- Business invariants enforced by the database: next-action derivation,
-- opportunity lifecycle, timeline entries, subject links, deletion behaviour.
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
select plan(25);

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------- next action rule --
select is((select needs_next_action from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  true, 'an active opportunity without an open task needs a next action');

insert into public.tasks (organization_id, opportunity_id, assigned_user_id, type, title, due_date)
values ('0a000000-0000-4000-8000-00000000000a', '0aa00000-0000-4000-8000-0000000000a1',
        'c3000000-0000-4000-8000-000000000003', 'follow_up', 'Follow up with Marko', current_date + 7);
insert into public.tasks (organization_id, opportunity_id, assigned_user_id, type, title, due_at)
values ('0a000000-0000-4000-8000-00000000000a', '0aa00000-0000-4000-8000-0000000000a1',
        'c3000000-0000-4000-8000-000000000003', 'send_document', 'Send offer', now() + interval '1 day');

select is((select next_task_title from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  'Send offer', 'the next action is the open task with the earliest effective due moment');
select is((select needs_next_action from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  false, 'an open task satisfies the next-action rule');
select is((select company_id from public.tasks where title = 'Send offer'),
  'ca000000-0000-4000-8000-0000000000a1'::uuid, 'task company is derived from its opportunity');

update public.tasks set status = 'completed' where title = 'Send offer';
select isnt((select closed_at from public.tasks where title = 'Send offer'), null, 'completing a task stamps closed_at');
select is((select next_task_title from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  'Follow up with Marko', 'after completion the next open task becomes the next action');

select throws_ok($$ insert into public.tasks (organization_id, title, due_date, due_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'Ambiguous', current_date, now()) $$,
  '23514', null, 'a task has either a date-only or an exact due, never both');
select lives_ok($$ insert into public.tasks (organization_id, title) values ('0a000000-0000-4000-8000-00000000000a', 'Personal reminder') $$,
  'tasks without a subject (personal reminders) are allowed');

-- ---------------------------------------------------- activities/timeline --
select throws_ok($$ insert into public.activities (organization_id, type, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'note', 'Floating note') $$,
  '23514', null, 'an activity must belong to a company, contact or opportunity');
select throws_ok($$ insert into public.activities (organization_id, opportunity_id, type, source, title)
  values ('0a000000-0000-4000-8000-00000000000a', '0aa00000-0000-4000-8000-0000000000a1', 'note', 'system', 'Forged') $$,
  '42501', null, 'clients cannot write system activities');

insert into public.activities (organization_id, contact_id, performed_by_user_id, type, title, occurred_at, metadata)
values ('0a000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-0000000000a1', 'c3000000-0000-4000-8000-000000000003',
        'phone_call', 'Called Marko regarding offer', now() - interval '1 hour', '{"duration_seconds": 300}');
select is((select company_id from public.activities where title = 'Called Marko regarding offer'),
  'ca000000-0000-4000-8000-0000000000a1'::uuid, 'activity company is derived from the contact');
select is((select created_by from public.activities where title = 'Called Marko regarding offer'),
  'c3000000-0000-4000-8000-000000000003'::uuid, 'created_by is stamped from the JWT, not the client');

-- --------------------------------------------------- opportunity lifecycle --
update public.opportunities set stage = 'negotiation' where id = '0aa00000-0000-4000-8000-0000000000a1';
select is((select metadata ->> 'to_stage' from public.activities
           where opportunity_id = '0aa00000-0000-4000-8000-0000000000a1' and type = 'status_change'),
  'negotiation', 'a stage change writes a system timeline entry');
select is((select last_activity_at is not null from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  true, 'last_activity_at is derived from the timeline');

update public.opportunities set status = 'lost', lost_reason = 'Budget' where id = '0aa00000-0000-4000-8000-0000000000a1';
select isnt((select closed_at from public.opportunities where id = '0aa00000-0000-4000-8000-0000000000a1'), null,
  'closing an opportunity stamps closed_at');
select is((select needs_next_action from public.opportunity_overview where id = '0aa00000-0000-4000-8000-0000000000a1'),
  false, 'closed opportunities never need a next action');
select is((select stage::text from public.opportunities where id = '0aa00000-0000-4000-8000-0000000000a1'),
  'negotiation', 'stage is retained after closing (lost at negotiation)');

update public.opportunities set status = 'active' where id = '0aa00000-0000-4000-8000-0000000000a1';
select is((select row(closed_at, lost_reason)::text from public.opportunities where id = '0aa00000-0000-4000-8000-0000000000a1'),
  '(,)', 'reopening clears closed_at and lost_reason');

select throws_ok($$ update public.opportunities set organization_id = '0b000000-0000-4000-8000-00000000000b'
  where id = '0aa00000-0000-4000-8000-0000000000a1' $$, null, null, 'records can never move between tenants');
select throws_ok($$ insert into public.opportunities (organization_id, company_id, title, estimated_value)
  values ('0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'No currency', 10) $$,
  '23514', null, 'a monetary value requires a currency');

-- -------------------------------------------------------------- deletion --
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.contacts (id, organization_id, first_name)
values ('eb000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Freelancer');
insert into public.activities (organization_id, contact_id, type, title)
values ('0a000000-0000-4000-8000-00000000000a', 'eb000000-0000-4000-8000-0000000000a2', 'note', 'Met at a fair');
select throws_ok($$ delete from public.contacts where id = 'eb000000-0000-4000-8000-0000000000a2' $$,
  '23514', null, 'deleting a contact that would orphan an activity is refused (caller must decide)');

insert into public.opportunities (id, organization_id, company_id, title)
values ('0ab00000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'Second deal');
insert into public.activities (organization_id, opportunity_id, type, title)
values ('0a000000-0000-4000-8000-00000000000a', '0ab00000-0000-4000-8000-0000000000a2', 'meeting', 'Kick-off');
insert into public.tasks (organization_id, opportunity_id, title)
values ('0a000000-0000-4000-8000-00000000000a', '0ab00000-0000-4000-8000-0000000000a2', 'Prepare demo');
delete from public.opportunities where id = '0ab00000-0000-4000-8000-0000000000a2';
select is((select count(*)::int from public.tasks where title = 'Prepare demo'), 0,
  'deleting an opportunity deletes its tasks');
select is((select company_id from public.activities where title = 'Kick-off' and opportunity_id is null),
  'ca000000-0000-4000-8000-0000000000a1'::uuid, '…but its activities stay on the company timeline');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
delete from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1';
reset role;
select is((select count(*)::int from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1'), 1,
  'sales cannot hard-delete a company (archive instead)');

select pg_temp.login_as('a1000000-0000-4000-8000-000000000001');
delete from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1';
reset role;
select is((select count(*)::int from public.opportunities where company_id = 'ca000000-0000-4000-8000-0000000000a1')
        + (select count(*)::int from public.activities where company_id = 'ca000000-0000-4000-8000-0000000000a1')
        + (select count(*)::int from public.contacts where company_id = 'ca000000-0000-4000-8000-0000000000a1'),
  0, 'an owner''s hard delete purges the company with its contacts, deals and timeline');

select * from finish();
rollback;
