-- Offers (sent → answered), won value, reminders (exactly one target, same
-- organization, member recipient) and push subscriptions (private per user).
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

insert into public.companies (id, organization_id, name) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico');

insert into public.opportunities (id, organization_id, company_id, title, estimated_value, currency) values
  ('0a110000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Vending', 10000, 'EUR'),
  ('0b110000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b',
   'cb000000-0000-4000-8000-0000000000b1', 'Medico deal', 5000, 'EUR');

insert into public.leads (id, organization_id, name) values
  ('1a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'ABC d.o.o.'),
  ('1b000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Lead of org B');

insert into public.tasks (id, organization_id, title, assigned_user_id) values
  ('7a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'Poslati ponudu',
   'c3000000-0000-4000-8000-000000000003');
-- ------------------------------------------------------------ end fixtures --
select plan(24);

select has_table('public', 'offers', 'offers table exists');
select has_table('public', 'reminders', 'reminders table exists');
select has_table('public', 'push_subscriptions', 'push_subscriptions table exists');
select col_is_null('public', 'opportunities', 'won_value', 'won_value is optional');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ offers --
select lives_ok($$
  insert into public.offers (id, organization_id, opportunity_id, title, status, sent_at)
  values ('0f000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          '0a110000-0000-4000-8000-0000000000a1', 'Vending ponuda', 'sent', now() - interval '4 days')
$$, 'a sent offer is recorded with its sending time');
select throws_ok($$
  insert into public.offers (organization_id, opportunity_id, title, status)
  values ('0a000000-0000-4000-8000-00000000000a', '0a110000-0000-4000-8000-0000000000a1', 'X', 'sent')
$$, '23514', null, 'a sent offer needs sent_at');
select throws_ok($$
  insert into public.offers (organization_id, opportunity_id, title, status, sent_at)
  values ('0a000000-0000-4000-8000-00000000000a', '0a110000-0000-4000-8000-0000000000a1', 'X', 'draft', now())
$$, '23514', null, 'a draft is not sent');
select throws_ok($$
  insert into public.offers (organization_id, opportunity_id, title, status, sent_at)
  values ('0a000000-0000-4000-8000-00000000000a', '0b110000-0000-4000-8000-0000000000b1', 'X', 'sent', now())
$$, '23503', null, 'an offer cannot point at another organization''s opportunity');
select throws_ok($$
  update public.offers set status = 'answered' where id = '0f000000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'answered needs answered_at');
select lives_ok($$
  update public.offers set status = 'answered', answered_at = now() where id = '0f000000-0000-4000-8000-0000000000a1'
$$, 'an answered offer keeps its sending time');
select isnt((select sent_at from public.offers where id = '0f000000-0000-4000-8000-0000000000a1'), null,
  'sent_at survives the answer');

-- --------------------------------------------------------------- won value --
select throws_ok($$
  update public.opportunities set won_value = 9000 where id = '0a110000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'an active deal has no won value');
update public.opportunities set status = 'won', won_value = 9000 where id = '0a110000-0000-4000-8000-0000000000a1';
select results_eq(
  $$select won_value, closed_at is not null from public.opportunities where id = '0a110000-0000-4000-8000-0000000000a1'$$,
  $$values (9000.00::numeric, true)$$, 'winning keeps the final amount and stamps closed_at');
update public.opportunities set status = 'active' where id = '0a110000-0000-4000-8000-0000000000a1';
select is((select won_value from public.opportunities where id = '0a110000-0000-4000-8000-0000000000a1'), null,
  'reopening clears the final amount');

-- --------------------------------------------------------------- reminders --
select lives_ok($$
  insert into public.reminders (organization_id, recipient_user_id, task_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          '7a000000-0000-4000-8000-0000000000a1', now() + interval '1 day', 'Europe/Zagreb')
$$, 'a reminder for a task');
select lives_ok($$
  insert into public.reminders (organization_id, recipient_user_id, lead_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          '1a000000-0000-4000-8000-0000000000a1', now() + interval '2 days', 'Europe/Zagreb')
$$, 'a reminder for a lead');
select throws_ok($$
  insert into public.reminders (organization_id, recipient_user_id, task_id, lead_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          '7a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', now(), 'Europe/Zagreb')
$$, '23514', null, 'a reminder has exactly one target');
select throws_ok($$
  insert into public.reminders (organization_id, recipient_user_id, lead_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          '1b000000-0000-4000-8000-0000000000b1', now(), 'Europe/Zagreb')
$$, '23503', null, 'a reminder cannot target another organization''s lead');
select throws_ok($$
  insert into public.reminders (organization_id, recipient_user_id, task_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-000000000002',
          '7a000000-0000-4000-8000-0000000000a1', now(), 'Europe/Zagreb')
$$, '23503', null, 'the recipient must be a member of the organization');
select throws_ok($$
  insert into public.reminders (organization_id, recipient_user_id, task_id, remind_at, time_zone)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003',
          '7a000000-0000-4000-8000-0000000000a1', now(), 'Mars/Olympus')
$$, '23514', null, 'the time zone must be real');
select throws_ok($$
  update public.reminders set status = 'sent' where lead_id = '1a000000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'sent needs delivered_at');

-- -------------------------------------------------------- push subscriptions --
select lives_ok($$
  insert into public.push_subscriptions (user_id, organization_id, endpoint, p256dh, auth)
  values ('c3000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
          'https://push.example/carol-phone', 'BPub', 'secret')
$$, 'a member registers a device');

select pg_temp.login_as('d4000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.push_subscriptions), 0,
  'another member does not see someone else''s devices');

select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.reminders) + (select count(*)::int from public.offers), 0,
  'another organization sees no reminders or offers');

select * from finish();
rollback;
