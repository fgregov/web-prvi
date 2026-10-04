-- =============================================================================
-- RENVARA · Migration 0001 · Foundation
--
-- Shared building blocks used by every later migration:
--   * `private` schema: helper functions that must never be exposed through
--     the Data API (PostgREST only exposes `public` / `graphql_public`).
--   * UUIDv7 primary-key generator (time-ordered → index-friendly inserts).
--   * Controlled vocabularies (enums) for the Phase 1 domain.
--   * Generic row-stamping triggers.
--
-- Conventions: see docs/architecture/04-data-conventions.md
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- `authenticated` needs USAGE so that RLS policies and column defaults can call
-- helpers in this schema. The schema is not in the API's exposed schemas, so the
-- functions cannot be invoked directly over HTTP.
grant usage on schema private to authenticated, service_role;

-- Secure-by-default: Supabase grants `anon` full privileges on new objects in
-- `public`. RENVARA has no anonymous data access at all, so new tables,
-- sequences and functions created by migrations are not granted to `anon`.
-- (Each table still revokes explicitly; a test asserts anon holds no grants.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
-- `authenticated` only ever needs DML (governed by RLS). TRUNCATE in particular
-- bypasses RLS, so it is never granted to API roles.
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- -----------------------------------------------------------------------------
-- UUIDv7 (RFC 9562). Time-ordered, so B-tree inserts stay append-mostly and
-- indexes remain compact at scale. Replace with the native `uuidv7()` once the
-- platform runs PostgreSQL 18+ (same output format, no data migration needed).
-- -----------------------------------------------------------------------------
create or replace function private.uuid_generate_v7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  -- Take a random v4 UUID, overwrite the first 48 bits with the Unix epoch in
  -- milliseconds, then flip the version nibble from 0100 (v4) to 0111 (v7).
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

grant execute on function private.uuid_generate_v7() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Validation helpers (used in CHECK constraints)
-- -----------------------------------------------------------------------------

-- IANA timezone validation. Declared IMMUTABLE so it can be used in CHECK
-- constraints; the tz database only grows, so a once-valid name stays valid.
create or replace function private.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if tz is null then
    return true;
  end if;
  perform now() at time zone tz;
  return true;
exception when invalid_parameter_value then
  return false;
end;
$$;

grant execute on function private.is_valid_timezone(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Controlled vocabularies
--
-- Enum values are lower_snake_case (PostgreSQL / PostgREST convention). The
-- TypeScript domain package mirrors them 1:1; a test guards the mapping.
-- Adding a value later is cheap (ALTER TYPE … ADD VALUE); removing one is not,
-- so only values with a clear Phase 1 meaning are included.
-- -----------------------------------------------------------------------------

create type public.member_role as enum ('owner', 'admin', 'manager', 'sales');
comment on type public.member_role is
  'Coarse organization role. Mapped to fine-grained permissions in the domain layer and in private.* RLS helpers.';

create type public.member_status as enum ('active', 'suspended', 'removed');
comment on type public.member_status is
  'Only `active` members can access tenant data. Rows are never hard-deleted on removal so historical ownership/authorship stays resolvable.';

create type public.customer_status as enum ('prospect', 'active_customer', 'inactive_customer');
comment on type public.customer_status is
  'Relationship status of a company. Deliberately independent from opportunity status.';

create type public.opportunity_stage as enum ('new_lead', 'contacted', 'qualified', 'proposal', 'negotiation');
comment on type public.opportunity_stage is
  'Pipeline position. Retained after closing so analytics can tell at which stage a deal was won or lost.';

create type public.opportunity_status as enum ('active', 'won', 'lost');
comment on type public.opportunity_status is
  'Lifecycle outcome. Only `active` opportunities require a next action.';

create type public.interest_level as enum ('low', 'medium', 'high');

create type public.activity_type as enum (
  'phone_call', 'email', 'meeting', 'note', 'offer_sent', 'follow_up', 'status_change', 'other'
);

create type public.activity_source as enum ('manual', 'system', 'ai_assistant', 'import', 'integration');
comment on type public.activity_source is
  'Who/what created the record. `system` is reserved for database-generated entries and cannot be written by clients.';

create type public.task_type as enum ('call', 'email', 'meeting', 'follow_up', 'send_document', 'other');

create type public.task_status as enum ('open', 'completed', 'cancelled');

create type public.task_priority as enum ('low', 'normal', 'high');

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------

-- For tables with only created_at / updated_at.
create or replace function private.stamp_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- For tenant-scoped business tables (organization_id, created_by, updated_by,
-- created_at, updated_at). Clients cannot forge authorship or timestamps, and a
-- row can never be moved to another tenant.
create or replace function private.stamp_tenant_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := (select auth.uid());
    new.updated_by := (select auth.uid());
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'organization_id is immutable'
        using errcode = 'check_violation';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;
