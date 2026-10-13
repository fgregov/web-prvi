-- Lead-first sales (ADR-0009): opportunities of a lead without a customer, a
-- lead WON by its won opportunity, conversion into a new or existing customer
-- as one idempotent operation, offers and tasks within a lead's deal, tenants.
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

insert into public.companies (id, organization_id, name, is_active) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'BMW TOMIĆ', true),
  ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Stari kupac', false);

insert into public.contacts (id, organization_id, company_id, first_name, last_name) values
  ('c0a00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Ivo', 'Tomić');

insert into public.leads (id, organization_id, name, company_name, email) values
  ('1a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'Marko Lukač', 'FERO-TERM', 'marko@fero-term.hr'),
  ('1a000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'Kafić Centar', null, null),
  ('1a000000-0000-4000-8000-0000000000a3', '0a000000-0000-4000-8000-00000000000a', 'Pekara Dubravica', null, null),
  ('1b000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Fremder Lead', null, null);
-- ------------------------------------------------------------ end fixtures --
select plan(39);

select has_column('public', 'opportunities', 'lead_id', 'an opportunity can belong to a lead');
select col_is_null('public', 'opportunities', 'company_id', 'the customer of an opportunity is optional');
select has_column('public', 'leads', 'won_at', 'a lead has its own WON date');
select has_column('public', 'opportunity_overview', 'lead_id', 'the overview carries the lead');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------ opportunity origin --
select lives_ok($$
  insert into public.opportunities (id, organization_id, lead_id, title, estimated_value, currency)
  values ('0a110000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          '1a000000-0000-4000-8000-0000000000a1', 'Vending aparat', 5000, 'EUR')
$$, 'case A: an opportunity of a lead, without any customer');
select lives_ok($$
  insert into public.opportunities (organization_id, company_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1', 'Servis')
$$, 'case B: an opportunity of a customer, as before');
select throws_ok($$
  insert into public.opportunities (organization_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'Siroče')
$$, '23514', null, 'case D: neither lead nor customer is refused');
select throws_ok($$
  insert into public.opportunities (organization_id, lead_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', '1b000000-0000-4000-8000-0000000000b1', 'X')
$$, '23503', null, 'another organization''s lead cannot be used');
select throws_ok($$
  insert into public.opportunities (organization_id, lead_id, company_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1',
          'ca000000-0000-4000-8000-0000000000a1', 'X')
$$, '23514', null, 'a lead and an unrelated customer cannot be combined');
select throws_ok($$
  insert into public.opportunities (organization_id, lead_id, primary_contact_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1',
          'c0a00000-0000-4000-8000-0000000000a1', 'X')
$$, '23514', null, 'a customer''s contact cannot be put on a lead''s deal');

-- Several deals of one lead, each with its own outcome.
insert into public.opportunities (id, organization_id, lead_id, title) values
  ('0a110000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-0000000000a1', 'Dodatni snack aparat'),
  ('0a110000-0000-4000-8000-0000000000a3', '0a000000-0000-4000-8000-00000000000a',
   '1a000000-0000-4000-8000-0000000000a1', 'Kapsulni sustav');

-- ---------------------------------------------- tasks and offers in the deal --
insert into public.tasks (id, organization_id, title, opportunity_id, scheduled_start_at)
values ('7a000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a', 'Poslati ponudu',
        '0a110000-0000-4000-8000-0000000000a1', now() + interval '2 days');
select results_eq(
  $$select lead_id, company_id from public.tasks where id = '7a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('1a000000-0000-4000-8000-0000000000a1'::uuid, null::uuid)$$,
  'a task of the deal gets its lead, no customer, and keeps its calendar slot');
select lives_ok($$
  insert into public.offers (id, organization_id, opportunity_id, title)
  values ('0f000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          '0a110000-0000-4000-8000-0000000000a1', 'Vending — ponuda')
$$, 'an offer within the lead''s deal needs no customer');
select throws_ok($$
  insert into public.offers (organization_id, opportunity_id, company_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', '0a110000-0000-4000-8000-0000000000a1',
          'ca000000-0000-4000-8000-0000000000a1', 'X')
$$, '23514', null, 'nor can it name a customer the deal does not have');
select throws_ok($$
  insert into public.offers (organization_id, title) values ('0a000000-0000-4000-8000-00000000000a', 'X')
$$, '23514', null, 'an offer has a customer or a deal');

-- ---------------------------------------------------------------- WON / LOST --
select throws_ok($$
  update public.leads set status = 'lost' where id = '1a000000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'a lead with active opportunities is not closed as lost');

update public.opportunities set status = 'won' where id = '0a110000-0000-4000-8000-0000000000a1';
select results_eq(
  $$select status::text, won_basis::text, converted_at is null, converted_customer_id is null
      from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('won', 'opportunity', true, true)$$,
  'a won deal makes the lead WON, conversion pending, no customer created');
select is(
  (select won_at from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  (select closed_at from public.opportunities where id = '0a110000-0000-4000-8000-0000000000a1'),
  'the lead is won when its deal was won');
select is((select count(*)::int from public.companies), 2, 'no customer is created by winning');

update public.opportunities set status = 'lost' where id = '0a110000-0000-4000-8000-0000000000a3';
select is((select status::text from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  'won', 'a lost deal does not change a won lead');
select is((select status::text from public.opportunities where id = '0a110000-0000-4000-8000-0000000000a2'),
  'active', 'the lead''s other deals keep their own status');

update public.leads set status = 'lost' where id = '1a000000-0000-4000-8000-0000000000a3';
select throws_ok($$
  insert into public.opportunities (organization_id, lead_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a3', 'X')
$$, '23514', null, 'a lead closed as lost gets no new deals');

-- ---------------------------------------------------------------- conversion --
select throws_ok($$
  select public.convert_won_lead('1a000000-0000-4000-8000-0000000000a2', p_customer => '{"name":"Kafić Centar"}')
$$, '23514', null, 'an active lead is not converted');

select isnt(
  public.convert_won_lead('1a000000-0000-4000-8000-0000000000a1',
    p_customer => '{"name":"FERO-TERM d.o.o.","tax_id":"60417283915","city":"Osijek","email":"info@fero-term.hr"}'),
  null, 'KREIRAJ KUPCA: the won lead becomes a customer');
select results_eq(
  $$select c.name, c.is_active, c.customer_status::text
      from public.companies c join public.leads l on l.converted_customer_id = c.id
     where l.id = '1a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('FERO-TERM d.o.o.'::text, true, 'active_customer'::text)$$,
  'an ACTIVE customer');
select results_eq(
  $$select converted_opportunity_id, converted_at is not null, status::text
      from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('0a110000-0000-4000-8000-0000000000a1'::uuid, true, 'won'::text)$$,
  'the lead records the conversion and the deal it came from, and stays');
select results_eq(
  $$select o.lead_id, o.company_id = l.converted_customer_id, o.status::text
      from public.opportunities o join public.leads l on l.id = o.lead_id
     where o.id = '0a110000-0000-4000-8000-0000000000a1'$$,
  $$values ('1a000000-0000-4000-8000-0000000000a1'::uuid, true, 'won'::text)$$,
  'case C: the same won deal now has the lead and the customer');
select is(
  (select company_id from public.offers where id = '0f000000-0000-4000-8000-0000000000a1'),
  (select converted_customer_id from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  'its offer keeps its identity and gets the customer');
select is(
  (select company_id from public.tasks where id = '7a000000-0000-4000-8000-0000000000a1'),
  (select converted_customer_id from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  'its task gets the customer');
select is((select company_id from public.opportunities where id = '0a110000-0000-4000-8000-0000000000a2'),
  null, 'the lead''s other deals are not reassigned');
select is(
  (select count(*)::int from public.activities
    where lead_id = '1a000000-0000-4000-8000-0000000000a1' and title = 'Lead converted to customer'),
  1, 'the conversion is on the timeline');

-- Idempotent: a second tap returns the same customer, nothing new is created.
select is(
  public.convert_won_lead('1a000000-0000-4000-8000-0000000000a1', p_customer => '{"name":"FERO-TERM d.o.o."}'),
  (select converted_customer_id from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'),
  'converting again returns the customer already linked');
select is((select count(*)::int from public.companies), 3, '… and creates no duplicate');
select throws_ok($$
  select public.convert_won_lead('1a000000-0000-4000-8000-0000000000a1', p_customer_id => 'ca000000-0000-4000-8000-0000000000a1')
$$, '23505', null, 'a converted lead cannot be converted into another customer');
select lives_ok($$
  insert into public.opportunities (organization_id, lead_id, company_id, title)
  select '0a000000-0000-4000-8000-00000000000a', id, converted_customer_id, 'Godišnji servis'
    from public.leads where id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'a later deal of a converted lead may name its customer');

-- POVEŽI S POSTOJEĆIM KUPCEM: an inactive customer only with confirmed reactivation.
insert into public.opportunities (id, organization_id, lead_id, title, status)
values ('0a110000-0000-4000-8000-0000000000a5', '0a000000-0000-4000-8000-00000000000a',
        '1a000000-0000-4000-8000-0000000000a2', 'Aparat za kavu', 'won');
select throws_ok($$
  select public.convert_won_lead('1a000000-0000-4000-8000-0000000000a2', p_customer_id => 'ca000000-0000-4000-8000-0000000000a2')
$$, '23514', null, 'an inactive customer is not linked silently');
select is(
  public.convert_won_lead('1a000000-0000-4000-8000-0000000000a2',
    p_customer_id => 'ca000000-0000-4000-8000-0000000000a2', p_reactivate => true),
  'ca000000-0000-4000-8000-0000000000a2'::uuid, 'with confirmation it is linked …');
select is((select is_active from public.companies where id = 'ca000000-0000-4000-8000-0000000000a2'),
  true, '… and active again');

-- --------------------------------------------------------------- compatibility --
insert into public.leads (id, organization_id, name, status, converted_customer_id)
values ('1a000000-0000-4000-8000-0000000000a9', '0a000000-0000-4000-8000-00000000000a', 'Stari lead', 'won',
        'ca000000-0000-4000-8000-0000000000a1');
select results_eq(
  $$select won_basis::text, won_at is not null, converted_at is not null
      from public.leads where id = '1a000000-0000-4000-8000-0000000000a9'$$,
  $$values ('conversion', true, true)$$,
  'WON without a won deal is recorded as a conversion (the meaning before ADR-0009), not as a sale');

-- ------------------------------------------------------------------- tenants --
reset role;
select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select throws_ok($$
  select public.convert_won_lead('1a000000-0000-4000-8000-0000000000a1', p_customer => '{"name":"Ukradeno"}')
$$, 'P0002', null, 'another organization cannot convert the lead (it cannot even see it)');

select * from finish();
rollback;
