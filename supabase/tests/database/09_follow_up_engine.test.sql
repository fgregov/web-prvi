-- Follow-up Engine (ADR-0008): offers of a customer (opportunity and contact
-- optional, same customer), documents, share links and engagement events per
-- organization, server-only writes for links and events, private bucket.
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
  ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a', 'BMW TOMIĆ'),
  ('cb000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-00000000000b', 'Medico');

insert into public.contacts (id, organization_id, company_id, first_name, last_name) values
  ('c0a00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Marko', 'Lukač'),
  ('c0a00000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a2', 'Ivo', 'Tomić');

insert into public.opportunities (id, organization_id, company_id, title, estimated_value, currency) values
  ('0a110000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a1', 'Vending', 10000, 'EUR'),
  ('0a110000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a',
   'ca000000-0000-4000-8000-0000000000a2', 'Dodatna oprema', 5000, 'EUR');
-- ------------------------------------------------------------ end fixtures --
select plan(22);

select has_table('public', 'offer_documents', 'offer_documents table exists');
select has_table('public', 'offer_share_links', 'offer_share_links table exists');
select has_table('public', 'offer_engagement_events', 'offer_engagement_events table exists');
select col_is_null('public', 'offers', 'company_id', 'the customer is optional only within a lead''s deal (ADR-0009, test 10)');
select col_is_null('public', 'offers', 'opportunity_id', 'the opportunity is optional');
select is((select public from storage.buckets where id = 'offer-documents'), false,
  'the offer-documents bucket is private');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------- offer relations --
select lives_ok($$
  insert into public.offers (id, organization_id, company_id, title)
  values ('0f000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          'ca000000-0000-4000-8000-0000000000a1', 'Vending — poslovna ponuda')
$$, 'an offer of a customer, without an opportunity');
select lives_ok($$
  insert into public.offers (id, organization_id, opportunity_id, title)
  values ('0f000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a',
          '0a110000-0000-4000-8000-0000000000a1', 'Ponuda u prilici')
$$, 'an offer with only an opportunity (as before) …');
select is((select company_id from public.offers where id = '0f000000-0000-4000-8000-0000000000a2'),
  'ca000000-0000-4000-8000-0000000000a1'::uuid, '… gets the opportunity''s customer');
select throws_ok($$
  insert into public.offers (organization_id, company_id, opportunity_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1',
          '0a110000-0000-4000-8000-0000000000a2', 'X')
$$, '23514', null, 'FERO-TERM''s offer cannot sit in BMW''s opportunity');
select throws_ok($$
  insert into public.offers (organization_id, company_id, contact_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000a1',
          'c0a00000-0000-4000-8000-0000000000a2', 'X')
$$, '23514', null, 'nor name BMW''s contact');
select throws_ok($$
  insert into public.offers (organization_id, company_id, title)
  values ('0a000000-0000-4000-8000-00000000000a', 'cb000000-0000-4000-8000-0000000000b1', 'X')
$$, '23503', null, 'an offer cannot belong to another organization''s customer');

-- -------------------------------------------------------------- documents --
select lives_ok($$
  insert into public.offer_documents (id, organization_id, offer_id, storage_path, file_name, size_bytes, page_count, sha256)
  values ('d0c00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
          '0f000000-0000-4000-8000-0000000000a1',
          '0a000000-0000-4000-8000-00000000000a/0f000000-0000-4000-8000-0000000000a1/d0c00000-0000-4000-8000-0000000000a1.pdf',
          'Ponuda_Feroterm.pdf', 2400000, 3, repeat('a', 64))
$$, 'a member records the offer''s PDF');
select throws_ok($$
  insert into public.offer_documents (organization_id, offer_id, storage_path, file_name, size_bytes, page_count, sha256)
  values ('0a000000-0000-4000-8000-00000000000a', '0f000000-0000-4000-8000-0000000000a1',
          '0b000000-0000-4000-8000-00000000000b/x/y.pdf', 'x.pdf', 10, 1, repeat('a', 64))
$$, '23514', null, 'a document path outside the offer''s own folder is refused');

-- ---------------------------------------- links and events: server only --
select throws_ok($$
  insert into public.offer_share_links (organization_id, offer_id, document_id, token_hash, token_sealed, expires_at)
  values ('0a000000-0000-4000-8000-00000000000a', '0f000000-0000-4000-8000-0000000000a1',
          'd0c00000-0000-4000-8000-0000000000a1', decode(repeat('ab', 32), 'hex'), repeat('x', 60), now() + interval '90 days')
$$, '42501', null, 'members cannot create share links (the server does)');

reset role;
insert into public.offer_share_links (id, organization_id, offer_id, document_id, token_hash, token_sealed, expires_at)
values ('11a00000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
        '0f000000-0000-4000-8000-0000000000a1', 'd0c00000-0000-4000-8000-0000000000a1',
        decode(repeat('ab', 32), 'hex'), repeat('x', 60), now() + interval '90 days');
insert into public.offer_engagement_events (organization_id, offer_id, share_link_id, event_type, session_id)
values ('0a000000-0000-4000-8000-00000000000a', '0f000000-0000-4000-8000-0000000000a1',
        '11a00000-0000-4000-8000-0000000000a1', 'document_view', 'session-aaaaaaaaaaaaaaaa');
select throws_ok($$
  insert into public.offer_engagement_events (organization_id, offer_id, share_link_id, event_type)
  values ('0a000000-0000-4000-8000-00000000000a', '0f000000-0000-4000-8000-0000000000a1',
          '11a00000-0000-4000-8000-0000000000a1', 'document_view')
$$, '23514', null, 'a document view always has its viewing session');
select throws_ok($$
  insert into public.offer_engagement_events (organization_id, offer_id, share_link_id, event_type, suspected_bot)
  values ('0a000000-0000-4000-8000-00000000000a', '0f000000-0000-4000-8000-0000000000a1',
          '11a00000-0000-4000-8000-0000000000a1', 'link_access', true)
$$, '23514', null, 'a suspected bot always has its reason');

-- Private objects of both organizations (written by the server).
insert into storage.objects (bucket_id, name) values
  ('offer-documents', '0a000000-0000-4000-8000-00000000000a/0f000000-0000-4000-8000-0000000000a1/d0c00000-0000-4000-8000-0000000000a1.pdf'),
  ('offer-documents', '0b000000-0000-4000-8000-00000000000b/x/y.pdf');

select pg_temp.login_as('c3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.offer_share_links), 1, 'a member sees the organization''s links');
select is((select count(*)::int from public.offer_engagement_events), 1, '… and its engagement events');
select is((select count(*)::int from storage.objects where bucket_id = 'offer-documents'), 1,
  'a member reads only the organization''s own PDFs from storage');

reset role;
select pg_temp.login_as('b2000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.offer_documents) + (select count(*)::int from public.offer_share_links)
    + (select count(*)::int from public.offer_engagement_events),
  0, 'another organization sees no documents, links or events');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.offer_share_links $$, '42501', null,
  'anonymous callers cannot read share links');

select * from finish();
rollback;
