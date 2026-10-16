-- =============================================================================
-- RENVARA · Migration 0009 · Follow-up Engine (ADR-0008)
--
--   offers                   + company_id (backfilled from the opportunity, then
--                            required); opportunity_id becomes optional; + contact_id;
--                            + note (internal, never shown to the customer)
--   offer_documents          the offer's PDF in private storage (one active version)
--   offer_share_links        secret links: SHA-256 of the token + sealed token,
--                            expiry, revocation. Written by the server only.
--   offer_engagement_events  link_access | document_view, suspected bot, coarse
--                            client family. No IP, no user agent. Server only.
--   storage                  private bucket offer-documents,
--                            path <organization_id>/<offer_id>/<document_id>.pdf
--
-- Existing offers keep their dates, status and meaning. Inserting an offer with
-- only an opportunity still works: its customer is taken from the opportunity.
-- =============================================================================

alter type public.activity_type add value if not exists 'offer_viewed' after 'offer_answered';

-- -----------------------------------------------------------------------------
-- Offers belong to a customer; the opportunity and contact are optional.
-- -----------------------------------------------------------------------------
alter table public.offers
  add column company_id uuid,
  add column contact_id uuid,
  add column note text not null default '' check (char_length(note) <= 5000);

update public.offers o
   set company_id = p.company_id
  from public.opportunities p
 where p.organization_id = o.organization_id
   and p.id = o.opportunity_id;

alter table public.offers
  alter column company_id set not null,
  alter column opportunity_id drop not null,
  drop constraint offers_opportunity_fk,
  -- An offer now belongs to its customer: deleting a deal keeps the offer.
  add constraint offers_opportunity_fk foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete set null (opportunity_id),
  add constraint offers_company_fk foreign key (organization_id, company_id)
    references public.companies (organization_id, id) on delete cascade,
  add constraint offers_contact_fk foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete set null (contact_id);

create index offers_company_idx on public.offers (company_id);
create index offers_contact_idx on public.offers (contact_id) where contact_id is not null;

comment on table public.offers is
  'A sales offer of a customer (made in an ERP or Word), optionally within one of its opportunities. Waiting = sent and not yet answered; a view of the PDF is not an answer. Never deleted when answered.';
comment on column public.offers.company_id is
  'The customer. Taken from the opportunity when only that is given; must match it otherwise.';
comment on column public.offers.note is
  'Internal note of the salesperson. Never shown in the customer''s offer viewer.';

-- The opportunity and the contact must belong to the offer's customer.
create or replace function private.offer_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  deal_company uuid;
  person_company uuid;
begin
  if new.opportunity_id is not null then
    select company_id into deal_company
      from public.opportunities
     where organization_id = new.organization_id and id = new.opportunity_id;
    if not found then
      raise exception 'The offer''s opportunity is not in this organization'
        using errcode = 'foreign_key_violation';
    end if;
    if new.company_id is null then
      new.company_id := deal_company;
    elsif deal_company is distinct from new.company_id then
      raise exception 'The offer''s opportunity belongs to another customer'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.contact_id is not null then
    select company_id into person_company
      from public.contacts
     where organization_id = new.organization_id and id = new.contact_id;
    if not found then
      raise exception 'The offer''s contact is not in this organization'
        using errcode = 'foreign_key_violation';
    end if;
    if person_company is distinct from new.company_id then
      raise exception 'The offer''s contact belongs to another customer'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Fires before offers_stamp (alphabetical): relations first, then authorship.
create trigger offers_relations
  before insert or update of company_id, opportunity_id, contact_id on public.offers
  for each row execute function private.offer_relations();

-- -----------------------------------------------------------------------------
-- Offer documents (the PDF; bytes in the private bucket)
-- -----------------------------------------------------------------------------
create table public.offer_documents (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  offer_id         uuid not null,
  storage_path     text not null,
  file_name        text not null check (char_length(file_name) between 1 and 200),
  content_type     text not null default 'application/pdf' check (content_type = 'application/pdf'),
  size_bytes       integer not null check (size_bytes between 1 and 52428800),
  page_count       integer not null check (page_count >= 1),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  version          integer not null default 1 check (version >= 1),
  replaced_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint offer_documents_org_id_key unique (organization_id, id),
  constraint offer_documents_offer_fk foreign key (organization_id, offer_id)
    references public.offers (organization_id, id) on delete cascade,
  constraint offer_documents_version_key unique (offer_id, version),
  -- The path is generated by the server and always inside the offer's own folder.
  constraint offer_documents_path_check check (
    storage_path = organization_id::text || '/' || offer_id::text || '/' || id::text || '.pdf'
  )
);

comment on table public.offer_documents is
  'The PDF of an offer. One active version per offer (replaced_at null); a replacement adds a version instead of overwriting.';

create unique index offer_documents_one_active_idx
  on public.offer_documents (offer_id) where replaced_at is null;

create trigger offer_documents_stamp
  before insert or update on public.offer_documents
  for each row execute function private.stamp_tenant_row();

-- -----------------------------------------------------------------------------
-- Share links (bearer access to one offer's PDF). The token itself is never
-- stored readable: token_hash for lookup, token_sealed (AES-256-GCM, server key)
-- so the salesperson can copy the link again.
-- -----------------------------------------------------------------------------
create table public.offer_share_links (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  offer_id         uuid not null,
  document_id      uuid not null,
  token_hash       bytea not null check (octet_length(token_hash) = 32),
  token_sealed     text not null check (char_length(token_sealed) between 40 and 200),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  revoked_by       uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint offer_share_links_org_id_key unique (organization_id, id),
  constraint offer_share_links_token_hash_key unique (token_hash),
  constraint offer_share_links_offer_fk foreign key (organization_id, offer_id)
    references public.offers (organization_id, id) on delete cascade,
  constraint offer_share_links_document_fk foreign key (organization_id, document_id)
    references public.offer_documents (organization_id, id) on delete cascade,
  constraint offer_share_links_expiry_check check (expires_at > created_at)
);

comment on table public.offer_share_links is
  'A secret link to one offer''s PDF. Bearer access: whoever has an unexpired, unrevoked link can open it. Written by the server (service role) only.';

create index offer_share_links_offer_idx on public.offer_share_links (offer_id);

create trigger offer_share_links_stamp
  before insert or update on public.offer_share_links
  for each row execute function private.stamp_tenant_row();

-- -----------------------------------------------------------------------------
-- Engagement events (signals, not proof; ADR-0008)
-- -----------------------------------------------------------------------------
create type public.offer_event_type as enum ('link_access', 'document_view');
comment on type public.offer_event_type is
  'link_access: the link was requested (mail scanners included) · document_view: the viewer rendered the PDF in a visible tab.';

create table public.offer_engagement_events (
  id               uuid primary key default private.uuid_generate_v7(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  offer_id         uuid not null,
  share_link_id    uuid not null,
  event_type       public.offer_event_type not null,
  occurred_at      timestamptz not null default now(),
  session_id       text check (session_id is null or session_id ~ '^[A-Za-z0-9-]{16,64}$'),
  suspected_bot    boolean not null default false,
  bot_reason       text check (
    bot_reason is null or bot_reason in
      ('scanner_user_agent', 'prefetch', 'head_request', 'no_user_agent', 'automation', 'rapid_repeat')
  ),
  client_family    text check (client_family is null or char_length(client_family) <= 40),

  constraint offer_engagement_events_offer_fk foreign key (organization_id, offer_id)
    references public.offers (organization_id, id) on delete cascade,
  constraint offer_engagement_events_link_fk foreign key (organization_id, share_link_id)
    references public.offer_share_links (organization_id, id) on delete cascade,
  constraint offer_engagement_events_view_has_session check (
    event_type <> 'document_view' or session_id is not null
  ),
  constraint offer_engagement_events_reason_check check (suspected_bot = (bot_reason is not null))
);

comment on table public.offer_engagement_events is
  'Engagement signals of shared offers. No IP address and no raw user agent; deleted after the configured retention. Written by the server (service role) only.';

create index offer_engagement_events_offer_idx
  on public.offer_engagement_events (offer_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Row level security: members read their organization's rows. Documents are
-- written by members (upload); links and events only by the server.
-- -----------------------------------------------------------------------------
alter table public.offer_documents enable row level security;
alter table public.offer_share_links enable row level security;
alter table public.offer_engagement_events enable row level security;

revoke all on public.offer_documents from anon, authenticated;
revoke all on public.offer_share_links from anon, authenticated;
revoke all on public.offer_engagement_events from anon, authenticated;

grant select, insert, update on public.offer_documents to authenticated;
grant select on public.offer_share_links to authenticated;
grant select on public.offer_engagement_events to authenticated;

create policy offer_documents_select on public.offer_documents for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));
create policy offer_documents_insert on public.offer_documents for insert to authenticated
  with check (organization_id in (select private.current_user_org_ids()));
create policy offer_documents_update on public.offer_documents for update to authenticated
  using (organization_id in (select private.current_user_org_ids()))
  with check (organization_id in (select private.current_user_org_ids()));

create policy offer_share_links_select on public.offer_share_links for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));

create policy offer_engagement_events_select on public.offer_engagement_events
  for select to authenticated
  using (organization_id in (select private.current_user_org_ids()));

-- -----------------------------------------------------------------------------
-- Storage: private bucket; members only under their organization's folder.
-- The customer never reads the bucket: the server streams the PDF after
-- validating the share token.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('offer-documents', 'offer-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy offer_documents_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'offer-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from private.current_user_org_ids() as org_id
    )
  );
create policy offer_documents_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'offer-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from private.current_user_org_ids() as org_id
    )
  );
