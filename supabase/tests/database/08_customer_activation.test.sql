-- Customer activation: deactivate / reactivate the same company row, stamped
-- and logged by the database, with nothing else changed and no access across
-- organizations.
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

insert into public.companies (id, organization_id, name, customer_status) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'FERO-TERM', 'active_customer'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico', 'active_customer');

insert into public.contacts (id, organization_id, company_id, first_name) values
  ('c0000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Ana');

insert into public.opportunities (id, organization_id, company_id, title, estimated_value, currency) values
  ('0a110000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Vending', 10000, 'EUR');

insert into public.offers (id, organization_id, opportunity_id, title, status, sent_at) values
  ('0f000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   '0a110000-0000-4000-8000-0000000000a1', 'Vending ponuda', 'sent', now() - interval '3 days');

insert into public.tasks (id, organization_id, company_id, title, assigned_user_id) values
  ('7a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Nazvati kupca', 'c3000000-0000-4000-8000-000000000003');

-- What deactivation must not touch, as it was before.
create temp table before_rows on commit drop as
select
  (select to_jsonb(c) from public.contacts c where c.id = 'c0000000-0000-4000-8000-0000000000a1') as contact,
  (select to_jsonb(o) - 'updated_at' from public.opportunities o where o.id = '0a110000-0000-4000-8000-0000000000a1') as opportunity,
  (select to_jsonb(f) from public.offers f where f.id = '0f000000-0000-4000-8000-0000000000a1') as offer,
  (select to_jsonb(t) from public.tasks t where t.id = '7a000000-0000-4000-8000-0000000000a1') as task;
grant select on before_rows to authenticated;
-- ------------------------------------------------------------ end fixtures --
select plan(17);

select has_column('public', 'companies', 'is_active', 'companies.is_active exists');
select col_default_is('public', 'companies', 'is_active', 'true', 'new companies are active');
select has_column('public', 'companies', 'deactivated_at', 'companies.deactivated_at exists');
select has_column('public', 'companies', 'deactivated_by', 'companies.deactivated_by exists');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------- deactivate --
select lives_ok($$
  update public.companies set is_active = false where id = 'ca000000-0000-4000-8000-0000000000a1'
$$, 'a member deactivates a customer of their organization');
select results_eq($$
  select is_active, deactivated_at is not null, deactivated_by, customer_status::text
    from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1'
$$, $$ values (false, true, 'c3000000-0000-4000-8000-000000000003'::uuid, 'active_customer') $$,
  'deactivation is stamped by the database; the commercial status is unchanged');
select is((select count(*)::int from public.activities
            where company_id = 'ca000000-0000-4000-8000-0000000000a1'
              and type = 'status_change' and source = 'system'
              and metadata ->> 'to_active' = 'false'), 1,
  'deactivation is logged once on the timeline');
select ok((select
    (select to_jsonb(c) from public.contacts c where c.id = 'c0000000-0000-4000-8000-0000000000a1') = b.contact
    and (select to_jsonb(o) - 'updated_at' from public.opportunities o where o.id = '0a110000-0000-4000-8000-0000000000a1') = b.opportunity
    and (select to_jsonb(f) from public.offers f where f.id = '0f000000-0000-4000-8000-0000000000a1') = b.offer
    and (select to_jsonb(t) from public.tasks t where t.id = '7a000000-0000-4000-8000-0000000000a1') = b.task
  from before_rows b),
  'contacts, opportunities, offers and tasks are untouched');

select lives_ok($$
  update public.companies set deactivated_at = now() - interval '1 year', deactivated_by = null
   where id = 'ca000000-0000-4000-8000-0000000000a1'
$$, 'an update of the stamps alone is accepted …');
select is((select deactivated_by from public.companies where id = 'ca000000-0000-4000-8000-0000000000a1'),
  'c3000000-0000-4000-8000-000000000003'::uuid, '… but the database keeps the recorded stamps');

select lives_ok($$
  update public.companies set is_active = false where id = 'ca000000-0000-4000-8000-0000000000a1'
$$, 'deactivating an inactive customer again is harmless');
select is((select count(*)::int from public.activities
            where company_id = 'ca000000-0000-4000-8000-0000000000a1' and type = 'status_change'), 1,
  'and logs nothing new');

-- ------------------------------------------------------------- reactivate --
select lives_ok($$
  update public.companies set is_active = true where id = 'ca000000-0000-4000-8000-0000000000a1'
$$, 'a member reactivates the customer');
select results_eq($$
  select id, is_active, deactivated_at, deactivated_by from public.companies
   where name = 'FERO-TERM'
$$, $$ values ('ca000000-0000-4000-8000-0000000000a1'::uuid, true, null::timestamptz, null::uuid) $$,
  'reactivation keeps the same row and clears the stamps (no duplicate)');

-- --------------------------------------------------------- other tenants --
select lives_ok($$
  update public.companies set is_active = false where id = 'cb000000-0000-4000-8000-0000000000b1'
$$, 'an update aimed at another organization''s customer …');

reset role;
select is((select is_active from public.companies where id = 'cb000000-0000-4000-8000-0000000000b1'), true,
  '… changes nothing: RLS hides the row, it stays active');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
insert into public.companies (id, organization_id, name, is_active, deactivated_at)
values ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Nova', true, now());
select is((select deactivated_at from public.companies where id = 'ca000000-0000-4000-8000-0000000000a2'),
  null, 'an active company never carries a deactivation time');

select * from finish();
rollback;
