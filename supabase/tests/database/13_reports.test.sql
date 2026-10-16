-- IZVJEŠTAJI (ADR-0015): the report rights, the status history of
-- opportunities, the canonical rows of the reports and their totals, and the
-- e-mail log — each behind row level security.
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

create function pg_temp.as_server() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
end
$f$;

create function pg_temp.as_postgres() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end
$f$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'alice@org-a.test', '{"full_name":"Alice Owner"}'),
  ('d4000000-0000-4000-8000-000000000004', 'dave@org-a.test',  '{"full_name":"Dave Admin"}'),
  ('c3000000-0000-4000-8000-000000000003', 'carol@org-a.test', '{"full_name":"Carol Sales"}'),
  ('f6000000-0000-4000-8000-000000000006', 'frank@org-a.test', '{"full_name":"Frank Sales"}'),
  ('b2000000-0000-4000-8000-000000000002', 'bob@org-b.test',   '{"full_name":"Bob Owner"}');

insert into public.organizations (id, name, timezone) values
  ('0a000000-0000-4000-8000-00000000000a', 'Org A d.o.o.', 'Europe/Zagreb'),
  ('0b000000-0000-4000-8000-00000000000b', 'Org B GmbH',   'Europe/Berlin');

insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'admin'),
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'sales'),
  ('0a000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-000000000006', 'sales'),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'owner');

-- Frank may see opportunities, but not the reports.
delete from public.member_permissions
 where user_id = 'f6000000-0000-4000-8000-000000000006'
   and permission_key in ('reports.view', 'reports.email');

insert into public.companies (id, organization_id, name) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM'),
  ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Nova d.o.o.'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Berlin GmbH');

-- Org A, Q3/Q4 2026 (Europe/Zagreb is UTC+2 in summer: 22:30 UTC on 30.9. is 1.10.)
insert into public.opportunities (id, organization_id, company_id, owner_user_id, title, estimated_value, currency, status, closed_at, won_value) values
  ('0a100000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1',
   'c3000000-0000-4000-8000-000000000003', 'Vending', 5000, 'EUR', 'won', '2026-08-15 10:00:00+00', 5200),
  ('0a100000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a2',
   'c3000000-0000-4000-8000-000000000003', 'Servis', 2500, 'EUR', 'won', '2026-09-30 22:30:00+00', null),
  ('0a100000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a2',
   null, 'Licence', 7000, 'EUR', 'lost', '2026-09-10 09:00:00+00', null),
  ('0a100000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1',
   'c3000000-0000-4000-8000-000000000003', 'Hlađenje', 1000, 'EUR', 'active', null, null);
insert into public.opportunities (id, organization_id, company_id, title, estimated_value, currency, status, closed_at) values
  ('0b100000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-0000000000b1',
   'Berlin deal', 9999, 'EUR', 'won', '2026-08-01 10:00:00+00');
-- ------------------------------------------------------------ end fixtures --
select plan(38);

-- ------------------------------------------------------------- rights ---
select is((select requires from private.permission_definitions where key = 'reports.view'),
  '{opportunities.view}'::text[], 'reports.view requires opportunities.view (a report is made of them)');
select ok((select not default_grant from private.permission_definitions where key = 'reports.sales_reps'),
  'comparing representatives is not a Korisnik default');
select ok((select default_grant from private.permission_definitions where key = 'reports.email'),
  'e-mailing reports is a Korisnik default');
select ok(exists (select 1 from public.member_permissions where user_id = 'c3000000-0000-4000-8000-000000000003' and permission_key = 'reports.email')
  and not exists (select 1 from public.member_permissions where user_id = 'c3000000-0000-4000-8000-000000000003' and permission_key = 'reports.sales_reps'),
  'a new Korisnik may e-mail reports but not compare representatives');
select ok(exists (select 1 from public.member_permissions where user_id = 'd4000000-0000-4000-8000-000000000004' and permission_key = 'reports.sales_reps'),
  'an administrator compares representatives');

-- ----------------------------------------------------- status history ---
select is((select count(*)::int from public.opportunity_status_history
            where opportunity_id = '0a100000-0000-4000-8000-000000000001'),
  1, 'a deal created as won has one entry');
select is((select array[coalesce(from_status::text, '-'), to_status::text, amount::text]
             from public.opportunity_status_history where opportunity_id = '0a100000-0000-4000-8000-000000000001'),
  array['-', 'won', '5200.00'], 'its entry: created as won, with the final amount');

-- Hlađenje: won, reopened, lost — every step recorded.
update public.opportunities set status = 'won', won_value = 1100 where id = '0a100000-0000-4000-8000-000000000004';
update public.opportunities set status = 'active' where id = '0a100000-0000-4000-8000-000000000004';
update public.opportunities set status = 'lost', lost_reason = 'Cijena', closed_at = '2026-10-05 10:00:00+00' where id = '0a100000-0000-4000-8000-000000000004';
update public.opportunities set title = 'Hlađenje (uređeno)' where id = '0a100000-0000-4000-8000-000000000004';
select is((select array_agg(coalesce(from_status::text, '-') || '>' || to_status::text || ':' || coalesce(amount::text, '') order by changed_at, id)
             from public.opportunity_status_history where opportunity_id = '0a100000-0000-4000-8000-000000000004'),
  array['->active:1000.00', 'active>won:1100.00', 'won>active:1000.00', 'active>lost:1000.00'],
  'created, won (final amount), reopened, lost (estimate); a title change adds nothing');
select ok((select closed_at is null from public.opportunity_status_history
            where opportunity_id = '0a100000-0000-4000-8000-000000000004' and to_status = 'active' and from_status = 'won'),
  'reopening clears closed_at in the history too');
select throws_ok($$ update public.opportunity_status_history set to_status = 'won' $$,
  '42501', null, 'the history is append-only');

-- ---------------------------------------------- report rows (Carol) ---
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.opportunity_status_history), 7,
  'Carol reads the history of her organization only');
select throws_ok($$ insert into public.opportunity_status_history (organization_id, opportunity_id, to_status)
  values ('0a000000-0000-4000-8000-00000000000a', '0a100000-0000-4000-8000-000000000001', 'lost') $$,
  '42501', null, 'no member writes the history');
select is((select count(*)::int from public.report_closed_opportunities), 4,
  'closed deals of her organization: 2 won, 2 lost (active ones are not in reports)');
select is((select closed_date from public.report_closed_opportunities where opportunity_id = '0a100000-0000-4000-8000-000000000002'),
  '2026-10-01'::date, 'the closing day is counted in the organization''s timezone (Q4, not Q3)');
select is((select amount from public.report_closed_opportunities where opportunity_id = '0a100000-0000-4000-8000-000000000001'),
  5200.00, 'revenue of a won deal = its final amount');
select is((select amount from public.report_closed_opportunities where opportunity_id = '0a100000-0000-4000-8000-000000000002'),
  2500.00, 'without a final amount = its estimate');
select is((select amount from public.report_closed_opportunities where opportunity_id = '0a100000-0000-4000-8000-000000000003'),
  7000.00, 'a lost deal carries its potential');
select is((select array[won_count, lost_count] from public.report_outcome_totals('0a000000-0000-4000-8000-00000000000a', '2026-07-01', '2026-09-30')),
  array[1, 1], 'Q3 2026: 1 WON, 1 LOST');
select is((select array[won_amount, lost_amount] from public.report_outcome_totals('0a000000-0000-4000-8000-00000000000a', '2026-07-01', '2026-09-30')),
  array[5200.00, 7000.00]::numeric[], 'Q3 2026: revenue 5.200 €, LOST potential 7.000 €');
select is((select array[win_rate, loss_rate] from public.report_outcome_totals('0a000000-0000-4000-8000-00000000000a', '2026-07-01', '2026-09-30')),
  array[50.0000, 50.0000]::numeric[], 'WIN RATE = WON ÷ (WON + LOST) × 100');
select is((select array[won_count, lost_count] from public.report_outcome_totals('0a000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-12-31')),
  array[1, 1], 'Q4 2026: the deal won on 1.10. (Zagreb) and the one lost on 5.10.');
select ok((select win_rate is null and loss_rate is null and won_count = 0
             from public.report_outcome_totals('0a000000-0000-4000-8000-00000000000a', '2025-01-01', '2025-12-31')),
  'without closed deals the rates are N/P (null), not 0 %');
select is((select won_count from public.report_outcome_totals('0b000000-0000-4000-8000-00000000000b', '2026-01-01', '2026-12-31')),
  0, 'another organization''s deals are not visible through the function');

-- --------------------------------------------- without the report right ---
select pg_temp.login_as('f6000000-0000-4000-8000-000000000006');
select ok(private.has_permission('0a000000-0000-4000-8000-00000000000a', 'opportunities.view'),
  'Frank may see opportunities');
select is((select count(*)::int from public.report_closed_opportunities), 0,
  'without reports.view the report rows are empty');

select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.report_closed_opportunities), 1,
  'Bob sees only his organization''s closed deal');
select is((select count(*)::int from public.opportunity_status_history
            where organization_id = '0a000000-0000-4000-8000-00000000000a'), 0,
  'Bob cannot read Org A''s history');

-- ------------------------------------------------------- e-mail log ---
select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select throws_ok($$ insert into public.report_email_log (organization_id, sent_by, recipient, report_type, attachment_name, status, provider)
  values ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'kupac@example.com', 'revenue', 'Izvjestaj.pdf', 'sent', 'resend') $$,
  '42501', null, 'a member cannot write the e-mail log (the server does)');

select pg_temp.as_server();
select lives_ok($$ insert into public.report_email_log (organization_id, sent_by, recipient, report_type, period_from, period_to, attachment_name, status, provider, provider_message_id) values
  ('0a000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000003', 'kupac@example.com', 'revenue', '2026-07-01', '2026-09-30', 'RENVARA_Ukupni_prihod.pdf', 'sent', 'resend', 're_1'),
  ('0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004', 'uprava@example.com', 'sales_reps', '2026-01-01', '2026-12-31', 'RENVARA_Usporedba.pdf', 'failed', 'resend', null),
  ('0b000000-0000-4000-8000-00000000000b', 'b2000000-0000-4000-8000-000000000002', 'x@example.com', 'won_lost', null, null, 'RENVARA_WON.pdf', 'sent', 'resend', 're_2') $$,
  'the server (service role) logs sends');
select throws_ok($$ insert into public.report_email_log (organization_id, recipient, report_type, attachment_name, status, provider)
  values ('0a000000-0000-4000-8000-00000000000a', 'kupac@example.com', 'revenue', 'x.pdf', 'pending', 'resend') $$,
  '23514', null, 'only sent or failed is a status');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.report_email_log), 1, 'Carol sees her own send only');
select pg_temp.login_as('d4000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.report_email_log), 2, 'an administrator sees all sends of the organization');
select pg_temp.login_as('a1000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.report_email_log), 2, 'so does the owner');
select pg_temp.login_as('f6000000-0000-4000-8000-000000000006');
select is((select count(*)::int from public.report_email_log), 0, 'without reports.email: none');
select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.report_email_log), 1, 'Bob sees only his organization''s');

select pg_temp.as_postgres();
select throws_ok($$ update public.report_email_log set status = 'sent' $$,
  '42501', null, 'the e-mail log is append-only');
select lives_ok($$ delete from public.opportunities where id = '0a100000-0000-4000-8000-000000000004' $$,
  'deleting a deal is not blocked by its history');
select is((select count(*)::int from public.opportunity_status_history where opportunity_id = '0a100000-0000-4000-8000-000000000004'),
  0, 'its history goes with it');

select * from finish();
rollback;
