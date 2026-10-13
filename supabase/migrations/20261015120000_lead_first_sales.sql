-- =============================================================================
-- RENVARA · Migration 0010 · Lead-first sales (ADR-0009)
--
--   opportunities   + lead_id. company_id becomes optional: an opportunity
--                   belongs to a lead, a customer, or (after the lead's
--                   conversion) both. Never to neither.
--   leads           a lead is WON when one of its opportunities is won
--                   (won_at, won_basis). Customer conversion is a separate,
--                   later step (converted_at, converted_customer_id):
--                     won, no converted customer → conversion pending
--                     won, converted customer    → conversion completed
--   offers          may belong to a lead's opportunity before any customer
--                   exists (company_id optional when the opportunity is set).
--   tasks,          an opportunity's lead is derived like its customer.
--   activities
--   convert_won_lead()  the conversion as one atomic, idempotent operation.
--
-- Existing data keeps its meaning: every existing opportunity keeps its
-- customer; leads that were WON before this change (WON = converted) get
-- won_at = converted_at and won_basis = 'conversion'. No opportunity, sale or
-- lead is invented.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Leads: commercial outcome (WON) apart from customer conversion
-- -----------------------------------------------------------------------------
create type public.lead_won_basis as enum ('opportunity', 'conversion');
comment on type public.lead_won_basis is
  'Why a lead is WON. opportunity: one of its opportunities was won. conversion: recorded as WON by converting it into a customer, the meaning of WON before ADR-0009 (no won opportunity is known).';

alter table public.leads
  add column won_at timestamptz,
  add column won_basis public.lead_won_basis;

-- Before this change WON meant "converted": those leads were won at their conversion.
update public.leads
   set won_at = converted_at,
       won_basis = 'conversion'
 where status = 'won';

alter table public.leads
  drop constraint leads_won_has_converted_at,
  add constraint leads_won_has_won_at check ((status = 'won') = (won_at is not null)),
  add constraint leads_won_has_basis check ((status = 'won') = (won_basis is not null)),
  -- Conversion into a customer only after the lead is won.
  add constraint leads_converted_only_when_won check (converted_at is null or status = 'won'),
  add constraint leads_converted_customer_has_converted_at check (
    converted_customer_id is null or converted_at is not null
  );

comment on column public.leads.won_at is
  'When the lead was won: the first of its opportunities won (won_basis opportunity), or its conversion for leads won before ADR-0009 (won_basis conversion). Reporting date for "leads won in period".';
comment on column public.leads.converted_at is
  'When the lead was converted into a customer (new or existing). Null on a won lead = conversion pending. Reporting date for "leads converted in period".';

create index leads_org_won_idx on public.leads (organization_id, won_at) where won_at is not null;
create index leads_conversion_pending_idx on public.leads (organization_id)
  where status = 'won' and converted_at is null;

-- -----------------------------------------------------------------------------
-- Opportunities: of a lead, of a customer, or both after conversion
-- -----------------------------------------------------------------------------
alter table public.opportunities
  add column lead_id uuid,
  alter column company_id drop not null,
  -- Deleting a lead keeps the opportunities it brought to a customer; a lead
  -- whose opportunities have no customer cannot be deleted (opportunities_has_origin).
  add constraint opportunities_lead_fk foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete set null (lead_id),
  add constraint opportunities_has_origin check (lead_id is not null or company_id is not null);

create index opportunities_lead_idx on public.opportunities (lead_id) where lead_id is not null;

comment on table public.opportunities is
  'A sales deal of a lead or of a customer (or both, once the lead is converted). `stage` = pipeline position, `status` = outcome (ADR-0003). The next action is NOT stored here: it is derived from open tasks (ADR-0004); read it through public.opportunity_overview.';
comment on column public.opportunities.lead_id is
  'The lead the deal was opened for (ADR-0009). Kept after the lead is converted, so the deal stays in the lead''s history.';
comment on column public.opportunities.company_id is
  'The customer. Null while the deal belongs to a lead that is not (yet) a customer; set when the lead is converted.';

-- The lead, customer and contact of a deal must fit together.
create or replace function private.opportunity_relations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lead_status public.lead_status;
  lead_customer uuid;
  person_company uuid;
begin
  if new.lead_id is not null then
    select status, converted_customer_id into lead_status, lead_customer
      from public.leads
     where organization_id = new.organization_id and id = new.lead_id;
    if not found then
      raise exception 'The opportunity''s lead is not in this organization'
        using errcode = 'foreign_key_violation';
    end if;
    if tg_op = 'INSERT' and lead_status = 'lost' then
      raise exception 'A lead closed as lost gets no new opportunities'
        using errcode = 'check_violation';
    end if;
    if new.company_id is not null and new.company_id is distinct from lead_customer then
      raise exception 'A lead''s opportunity can only belong to the customer the lead was converted into'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.primary_contact_id is not null then
    select company_id into person_company
      from public.contacts
     where organization_id = new.organization_id and id = new.primary_contact_id;
    if found and person_company is distinct from new.company_id then
      raise exception 'The opportunity''s contact belongs to another customer'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunities_relations
  before insert or update of lead_id, company_id, primary_contact_id on public.opportunities
  for each row execute function private.opportunity_relations();

-- An opportunity won for a lead makes the lead WON (once; later wins keep the first date).
-- A lost opportunity changes nothing on the lead.
create or replace function private.opportunity_wins_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'won' and new.lead_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'won') then
    update public.leads
       set status = 'won',
           won_at = coalesce(won_at, new.closed_at, now()),
           won_basis = coalesce(won_basis, 'opportunity')
     where organization_id = new.organization_id
       and id = new.lead_id
       and status = 'active';
  end if;
  return null;
end;
$$;

create trigger opportunities_wins_lead
  after insert or update of status on public.opportunities
  for each row execute function private.opportunity_wins_lead();

-- An offer that existed only within a lead's deal goes with that deal.
create or replace function private.opportunity_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.offers
   where organization_id = old.organization_id
     and opportunity_id = old.id
     and company_id is null;
  return old;
end;
$$;

create trigger opportunities_before_delete
  before delete on public.opportunities
  for each row execute function private.opportunity_before_delete();

-- Lead lifecycle: won_at follows WON, converted_at follows the conversion, and a
-- lead with open deals cannot be closed as lost.
create or replace function private.lead_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage = 'qualified' and new.qualified_at is null then
    new.qualified_at := now();
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'won' then
      new.won_at := coalesce(new.won_at, now());
      if new.won_basis is null then
        new.won_basis := case
          when exists (
            select 1 from public.opportunities o
             where o.organization_id = new.organization_id
               and o.lead_id = new.id
               and o.status = 'won'
          ) then 'opportunity'::public.lead_won_basis
          else 'conversion'::public.lead_won_basis
        end;
      end if;
    elsif tg_op = 'UPDATE' and old.status = 'won' then
      new.won_at := null;
      new.won_basis := null;
      new.converted_at := null;
    end if;
    if new.status = 'lost' then
      if tg_op = 'UPDATE' and exists (
        select 1 from public.opportunities o
         where o.organization_id = new.organization_id
           and o.lead_id = new.id
           and o.status = 'active'
      ) then
        raise exception 'A lead with active opportunities cannot be closed as lost'
          using errcode = 'check_violation';
      end if;
      new.lost_at := coalesce(new.lost_at, now());
    elsif tg_op = 'UPDATE' and old.status = 'lost' then
      new.lost_at := null;
    end if;
  end if;
  -- The conversion has its own moment, stamped when the customer is linked.
  if new.converted_customer_id is not null and new.converted_at is null then
    new.converted_at := now();
  end if;
  return new;
end;
$$;

drop trigger leads_lifecycle on public.leads;
create trigger leads_lifecycle
  before insert or update of stage, status, converted_customer_id on public.leads
  for each row execute function private.lead_lifecycle();

-- -----------------------------------------------------------------------------
-- Offers within a lead's deal (no customer yet)
-- -----------------------------------------------------------------------------
alter table public.offers
  alter column company_id drop not null,
  add constraint offers_has_subject check (company_id is not null or opportunity_id is not null);

comment on column public.offers.company_id is
  'The customer. Null only for an offer within a lead''s opportunity before the lead is converted (ADR-0009); set at conversion. Must match the opportunity''s customer (offers_relations).';

-- -----------------------------------------------------------------------------
-- Tasks and activities: the opportunity's lead is derived like its customer
-- -----------------------------------------------------------------------------
create or replace function private.derive_subject_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_company uuid;
  linked_lead uuid;
begin
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.contact_id is not distinct from old.contact_id
     and new.opportunity_id is not distinct from old.opportunity_id
     and new.lead_id is not distinct from old.lead_id then
    return new;
  end if;

  if new.opportunity_id is not null then
    select o.company_id, o.lead_id into linked_company, linked_lead
    from public.opportunities o
    where o.id = new.opportunity_id and o.organization_id = new.organization_id;

    -- Not found → leave it to the composite FK to reject the row.
    if linked_company is not null then
      if new.company_id is null then
        new.company_id := linked_company;
      elsif new.company_id <> linked_company then
        raise exception 'company_id does not match the company of the linked opportunity'
          using errcode = 'check_violation';
      end if;
    end if;
    if linked_lead is not null then
      if new.lead_id is null then
        new.lead_id := linked_lead;
      elsif new.lead_id <> linked_lead then
        raise exception 'lead_id does not match the lead of the linked opportunity'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.company_id is null and new.contact_id is not null then
    select c.company_id into new.company_id
    from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id;
  end if;

  return new;
end;
$$;

-- The view lists o.* as it was when created: rebuilt so it carries lead_id
-- (and won_value, added after it was created). Same definition otherwise.
drop view public.opportunity_overview;
create view public.opportunity_overview
with (security_invoker = true)
as
select
  o.*,
  na.id                as next_task_id,
  na.type              as next_task_type,
  na.title             as next_task_title,
  na.due_date          as next_task_due_date,
  na.due_at            as next_task_due_at,
  na.assigned_user_id  as next_task_assigned_user_id,
  la.last_activity_at,
  (o.status = 'active' and na.id is null) as needs_next_action
from public.opportunities o
join public.organizations org on org.id = o.organization_id
left join lateral (
  select t.id, t.type, t.title, t.due_date, t.due_at, t.assigned_user_id
  from public.tasks t
  where t.opportunity_id = o.id
    and t.status = 'open'
  order by
    coalesce(t.due_at, t.due_date::timestamp at time zone org.timezone, t.scheduled_start_at) asc nulls last,
    t.created_at asc,
    t.id asc
  limit 1
) na on true
left join lateral (
  select max(a.occurred_at) as last_activity_at
  from public.activities a
  where a.opportunity_id = o.id
) la on true;

comment on view public.opportunity_overview is
  'Opportunities (of a lead and/or a customer) with their derived next action (earliest open task) and last activity. needs_next_action = active opportunity with no open task — the core "needs attention" signal (ADR-0004).';
revoke all on public.opportunity_overview from anon, authenticated;
grant select on public.opportunity_overview to authenticated;

-- -----------------------------------------------------------------------------
-- WON lead → customer, in one transaction (ADR-0009)
--
--   p_customer_id   link to this existing customer, or
--   p_customer      create one: {"name", "tax_id", "email", "phone",
--                   "address_line", "postal_code", "city"}
--   p_opportunity_id  the won opportunity it came from (default: the lead's
--                   first won opportunity)
--   p_reactivate    an inactive existing customer is linked only when true
--                   (it is then reactivated; never silently)
--
-- Locks the lead row: a repeated or concurrent call returns the customer the
-- lead was already converted into instead of creating another one. Runs with
-- the caller's rights, so row level security decides what can be read and
-- written; the organization always comes from the lead.
-- -----------------------------------------------------------------------------
create or replace function public.convert_won_lead(
  p_lead_id uuid,
  p_customer_id uuid default null,
  p_customer jsonb default null,
  p_opportunity_id uuid default null,
  p_reactivate boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_deal uuid := p_opportunity_id;
  v_customer uuid;
  v_active boolean;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;
  if v_lead.status <> 'won' then
    raise exception 'Only a won lead is converted into a customer' using errcode = 'check_violation';
  end if;
  if v_lead.converted_customer_id is not null then
    if p_customer_id is null or p_customer_id = v_lead.converted_customer_id then
      return v_lead.converted_customer_id; -- already converted: idempotent
    end if;
    raise exception 'The lead is already converted into another customer'
      using errcode = 'unique_violation';
  end if;
  if (p_customer_id is null) = (p_customer is null) then
    raise exception 'Give either an existing customer or a new one'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_deal is null then
    select o.id into v_deal
      from public.opportunities o
     where o.organization_id = v_lead.organization_id and o.lead_id = v_lead.id
       and o.status = 'won'
     order by o.closed_at, o.id
     limit 1;
  elsif not exists (
    select 1 from public.opportunities o
     where o.organization_id = v_lead.organization_id and o.id = v_deal
       and o.lead_id = v_lead.id and o.status = 'won'
  ) then
    raise exception 'The opportunity is not a won opportunity of this lead'
      using errcode = 'check_violation';
  end if;

  if p_customer_id is not null then
    select c.id, c.is_active into v_customer, v_active
      from public.companies c
     where c.organization_id = v_lead.organization_id and c.id = p_customer_id
     for update;
    if not found then
      raise exception 'Customer not found in this organization'
        using errcode = 'foreign_key_violation';
    end if;
    if not v_active then
      if not p_reactivate then
        raise exception 'The customer is inactive' using errcode = 'check_violation',
          hint = 'Confirm its reactivation (p_reactivate) or choose another customer.';
      end if;
      update public.companies set is_active = true where id = v_customer;
    end if;
    update public.companies
       set customer_status = 'active_customer'
     where id = v_customer and customer_status = 'prospect';
  else
    insert into public.companies (
      organization_id, name, tax_id, email, phone, address_line, postal_code, city,
      customer_status, is_active, owner_user_id
    ) values (
      v_lead.organization_id,
      btrim(coalesce(p_customer ->> 'name', '')),
      nullif(btrim(coalesce(p_customer ->> 'tax_id', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'address_line', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'postal_code', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'city', '')), ''),
      'active_customer', true, v_lead.owner_user_id
    )
    returning id into v_customer;
  end if;

  -- The lead first: the opportunity may only take the lead's converted customer.
  update public.leads
     set converted_customer_id = v_customer,
         converted_opportunity_id = v_deal,
         converted_at = now()
   where id = v_lead.id;
  if v_deal is not null then
    update public.opportunities set company_id = v_customer where id = v_deal;
    update public.offers o set company_id = v_customer
     where o.organization_id = v_lead.organization_id and o.opportunity_id = v_deal
       and o.company_id is null;
  end if;
  -- The lead's own tasks and those of the converted deal now concern the customer too.
  update public.tasks t set company_id = v_customer
   where t.organization_id = v_lead.organization_id
     and t.company_id is null
     and ((t.lead_id = v_lead.id and t.opportunity_id is null) or t.opportunity_id = v_deal);
  return v_customer;
end;
$$;

comment on function public.convert_won_lead(uuid, uuid, jsonb, uuid, boolean) is
  'Converts a WON lead into a new or an existing customer in one transaction: links the lead, its originating won opportunity, that opportunity''s offers and the lead''s tasks. Idempotent; an inactive customer needs p_reactivate. ADR-0009.';

revoke all on function public.convert_won_lead(uuid, uuid, jsonb, uuid, boolean) from public, anon;
grant execute on function public.convert_won_lead(uuid, uuid, jsonb, uuid, boolean) to authenticated;

-- Timeline entry when a lead is linked to its customer (system row, like the
-- customer activation entries): on the lead, the customer and the deal.
create or replace function private.log_lead_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if new.converted_customer_id is null
     or new.converted_customer_id is not distinct from old.converted_customer_id then
    return null;
  end if;
  insert into public.activities (
    organization_id, company_id, opportunity_id, lead_id, performed_by_user_id,
    type, source, title, occurred_at, metadata
  )
  values (
    new.organization_id, new.converted_customer_id, new.converted_opportunity_id, new.id,
    (select m.user_id from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = actor),
    'status_change', 'system', 'Lead converted to customer', now(),
    jsonb_build_object('change', 'lead_conversion', 'won_basis', new.won_basis)
  );
  return null;
end;
$$;

create trigger leads_log_conversion
  after update of converted_customer_id on public.leads
  for each row execute function private.log_lead_conversion();
