# ADR-0009: Lead-first sales: opportunities of a lead, WON before conversion

**Context.** Until this ADR an opportunity required a customer
(`opportunities.company_id NOT NULL`), and a lead was WON when it was
converted into a customer. The only way to open a deal for a lead was to
convert it first (Lead → Pretvori u kupca → Prilika → WON / LOST). Every
prospect therefore entered the customer database before it bought anything,
which filled it with companies that never became customers and blurred both
customer management and sales statistics.

**Decision.** The workflow is lead-first:

```
LEAD → OPPORTUNITY (no customer) → … → WON / LOST
                         WON → offer conversion → NEW or EXISTING customer (ACTIVE)
```

* **Opportunity origin.** `opportunities.lead_id` is added; `company_id`
  becomes optional. Constraint `opportunities_has_origin`:
  `lead_id IS NOT NULL OR company_id IS NOT NULL`. Allowed combinations: lead
  only (a lead's deal), customer only (unchanged Path B), both (after the
  lead's conversion). Not exclusive-or. A trigger (`opportunities_relations`)
  allows both only when `company_id` is the customer the lead was converted
  into, refuses a contact without the opportunity's customer, refuses a lead
  of another organization (as do the composite foreign keys, ADR-0002), and
  refuses new deals for a lead closed as lost.
* **Lead WON is the commercial outcome.** A lead is WON when one of its
  opportunities is won (`leads.won_at` = that moment, `won_basis =
  'opportunity'`; a later win keeps the first date and creates nothing). A
  lost opportunity never changes the lead; a lead with active opportunities
  cannot be closed as lost. Customer conversion is a separate, later step
  recorded by the existing fields (`converted_at`, `converted_customer_id`,
  `converted_opportunity_id`, `converted_contact_id`). The conversion state
  is derived, not a new status: WON with no `converted_at` = *pending*.
* **Conversion** (BETA `LeadService.convertLead`, database
  `public.convert_won_lead()`) only for a WON lead, into a NEW customer
  (created ACTIVE) or an EXISTING one (an inactive one only with explicit
  reactivation). One transaction: the customer (and optional contact), the
  lead's conversion references, the originating won opportunity's
  `company_id` (the same row: id, dates, values, offers, tasks and history
  are kept; `lead_id` stays), that opportunity's offers and the lead's own
  tasks. It is idempotent: the lead row is locked (`FOR UPDATE`); a repeated
  or concurrent call returns the customer already linked, and converting into
  a different customer is refused. The lead's other opportunities are not
  reassigned; linking one of them to the converted customer is an explicit
  action (`POST /api/opportunities/{id}/link-customer`) and only to that
  customer.
* **Offers** may belong to a lead's opportunity before any customer exists
  (`offers.company_id` optional, `offers_has_subject`: customer or
  opportunity). The existing `offers_relations` trigger keeps the offer's
  customer equal to its opportunity's. At conversion the offer gets the
  customer. Waiting-day bands are unchanged.
* **Tasks and activities** derive the opportunity's lead like its customer
  (`private.derive_subject_links`): a task of a lead's deal has the lead and no
  customer, and is in the Sales Calendar as before.

**Historical data.** Nothing is invented. Existing opportunities keep their
customer and get no lead. Leads WON before this ADR (WON then meant
"converted") get `won_at = converted_at` and `won_basis = 'conversion'`: they
stay WON and converted, and reports can tell them apart from wins backed by a
won opportunity. No opportunity, sale or lead is created for them. The BETA
JSON store applies the same rule when it loads older data
(`normalizeData`).

**Reporting.**
* LEADS: leads created in the period (unchanged); a lead is counted once,
  not again for its opportunities or its conversion.
* Lead WON / LOST: by `won_at` / `lost_at`; *lead converted* by
  `converted_at`, reported separately (`leads.converted`), with the number of
  WON leads still waiting for conversion (`leads.conversionPending`, now).
* Opportunity WON / LOST, rates, OPPORTUNITY POTENTIAL / WON, NEGOTIATIONS:
  every opportunity, lead or customer, by its own dates — nothing depends on
  `company_id`.
* BUYERS: distinct buyers of won opportunities: the customer, or the lead for
  a lead's deal before conversion (resolved to the customer it became, so one
  party is never counted twice).

**Consequences.** A lead can be sold to without a customer record; the
customer database holds actual customers. Screens: Lead Detail lists the
lead's opportunities with the same card and actions as the customer profile,
"Kreiraj priliku" opens the opportunity form linked to the lead, a won lead
deal prompts "Prilika je osvojena!" (KREIRAJ KUPCA / POVEŽI S POSTOJEĆIM
KUPCEM / KASNIJE), and a WON lead without a customer shows "Čeka pretvaranje
u kupca" with PRETVORI U KUPCA. The opportunity form gets a compact "Poveži
priliku s: Lead | Kupac". Converting an *active* lead (the previous flow) is
no longer offered.

**Alternatives considered.**
* *Create a customer (prospect) automatically with every lead opportunity*:
  rejected — exactly the staging-area use of the customer table this ADR
  removes.
* *Exclusive-or (lead xor customer)*: rejected — a converted lead's deal
  legitimately has both, and keeping `lead_id` preserves attribution and
  sales-cycle history.
* *A new lead status (e.g. `converted`)*: rejected — conversion is derivable
  from the existing conversion fields; overloading the status would mix the
  commercial outcome with the customer record's existence.
* *Backfilling `lead_id` on opportunities created during old conversions*:
  not done — reinterpreting history without verified provenance.
