-- MOBILNE OBAVIJESTI: per-member notification preferences (independent per
-- user, database-clock enabled_at, upsert without duplicates), the date-only
-- deadline time, and the server-written delivery log (idempotent, private).
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
  ('d4000000-0000-4000-8000-000000000004', 'dave@org-a.test',  '{"full_name":"Dave Sales"}'),
  ('b2000000-0000-4000-8000-000000000002', 'bob@org-b.test',   '{"full_name":"Bob Owner"}');

insert into public.organizations (id, name, timezone) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A d.o.o.', 'Europe/Zagreb'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B GmbH',   'Europe/Berlin');

insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'sales'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'sales'),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'owner');

-- Written by the server scheduler (service role), one for each salesperson of org A.
insert into public.notification_deliveries
  (organization_id, recipient_user_id, type, source_id, idempotency_key, occurred_at, title, body, url) values
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'feedback_medium',
   'f0000000-0000-4000-8000-0000000000f1', 'feedback_medium:f1:2026-10-01T08:00:00Z', now(),
   'RENVARA — Follow-up prioritet', 'FERO-TERM čeka odgovor na ponudu već 5 dana.', '/follow-up/f1'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'offer_viewed',
   'f0000000-0000-4000-8000-0000000000f2', 'offer_viewed:e1', now(),
   'RENVARA — Ponuda pregledana', 'Zabilježen je novi pregled ponude za BMW.', '/follow-up/f2');
-- ------------------------------------------------------------ end fixtures --
select plan(26);

select has_table('public', 'notification_preferences', 'preferences table');
select has_table('public', 'notification_settings', 'settings table');
select has_table('public', 'notification_deliveries', 'delivery log table');
select enum_has_labels('public', 'notification_type',
  array['offer_viewed', 'reminder_due', 'task_deadline', 'opportunity_deadline',
        'feedback_low', 'feedback_medium', 'feedback_high'],
  'the seven notification types');

-- ---------------------------------------------------------------- preferences --
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select lives_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled, enabled_at)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          'offer_viewed', true, '2000-01-01')
$$, 'a member switches a type on');
select ok(
  (select enabled_at > '2020-01-01' from public.notification_preferences where type = 'offer_viewed'),
  'enabled_at comes from the database clock, not from the client');
select throws_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'offer_viewed', false)
$$, '23505', null, 'one row per member and type');
select lives_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'offer_viewed', false)
  on conflict (organization_id, user_id, type) do update set enabled = excluded.enabled
$$, 'a toggle is an upsert');
select is(
  (select count(*)::int from public.notification_preferences where type = 'offer_viewed'), 1,
  'no duplicate row after the upsert');
select is(
  (select format('%s/%s', enabled, enabled_at is not null) from public.notification_preferences where type = 'offer_viewed'),
  'f/t',
  'switched off: enabled_at keeps when it was last on');
select throws_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'task_deadline', true)
$$, '42501', null, 'nobody sets another member''s preferences');
select throws_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0b000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-000000000003', 'task_deadline', true)
$$, '42501', null, 'not in an organization one is not a member of');
select lives_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'feedback_high', true)
$$, 'another type of the same member');

select pg_temp.login_as('d4000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.notification_preferences), 0,
  'a colleague does not see another member''s preferences');
select lives_ok($$
  insert into public.notification_preferences (organization_id, user_id, type, enabled)
  values ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'feedback_high', false)
$$, 'the colleague chooses independently');
reset role;
select is(
  (select array_agg(enabled order by user_id) from public.notification_preferences where type = 'feedback_high'),
  array[true, false],
  'same organization, same type, different choices');

-- ------------------------------------------------------------------ settings --
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select lives_ok($$
  insert into public.notification_settings (organization_id, user_id, deadline_time, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', '08:00', 'Europe/Zagreb')
$$, 'a member sets the time for date-only deadlines');
select throws_ok($$
  update public.notification_settings set time_zone = 'Mars/Olympus'
$$, '23514', null, 'an unknown timezone is refused');
select throws_ok($$
  insert into public.notification_settings (organization_id, user_id, deadline_time, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', '09:00', 'Europe/Zagreb')
$$, '42501', null, 'not for a colleague');

-- ---------------------------------------------------------------- deliveries --
select is((select count(*)::int from public.notification_deliveries), 1,
  'a member sees only their own notifications');
select throws_ok($$
  insert into public.notification_deliveries
    (organization_id, recipient_user_id, type, source_id, idempotency_key, occurred_at, title, body, url)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'offer_viewed',
          'f0000000-0000-4000-8000-0000000000f1', 'x', now(), 'T', 'B', '/x')
$$, '42501', null, 'clients cannot write the delivery log');
select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.notification_deliveries), 0,
  'another organization sees none of them');
reset role;

select throws_ok($$
  insert into public.notification_deliveries
    (organization_id, recipient_user_id, type, source_id, idempotency_key, occurred_at, title, body, url)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'feedback_medium',
          'f0000000-0000-4000-8000-0000000000f1', 'feedback_medium:f1:2026-10-01T08:00:00Z', now(), 'T', 'B', '/x')
$$, '23505', null, 'one event is notified once (idempotency key)');
select throws_ok($$
  update public.notification_deliveries set status = 'sent' where type = 'offer_viewed'
$$, '23514', null, 'sent only with the moment the push service accepted it');
select throws_ok($$
  insert into public.notification_deliveries
    (organization_id, recipient_user_id, type, source_id, idempotency_key, occurred_at, title, body, url)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'offer_viewed',
          'f0000000-0000-4000-8000-0000000000f1', 'k2', now(), 'T', 'B', 'https://example.com/o/token')
$$, '23514', null, 'a notification opens a Renvara path, never an outside link');
select throws_ok($$
  insert into public.notification_deliveries
    (organization_id, recipient_user_id, type, source_id, idempotency_key, occurred_at, title, body, url)
  values ('0a000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-000000000002', 'offer_viewed',
          'f0000000-0000-4000-8000-0000000000f1', 'k3', now(), 'T', 'B', '/x')
$$, '23503', null, 'only to a member of the record''s organization');

select * from finish();
rollback;
