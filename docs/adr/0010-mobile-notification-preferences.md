# ADR-0010: Mobile notification preferences and event notifications

**Context.** Renvara already delivered push *reminders* from the server (Web
Push, VAPID, a scheduler every 30 s, retries, devices per user; see the BETA
README). Salespeople also want to hear about other events: an offer was
viewed, a task or an opportunity reached its deadline, an offer has waited
long enough to need a follow-up. Each person decides for themselves which of
these they receive. The bottom navigation gives this a place of its own
(**Obavijesti**, the screen MOBILNE OBAVIJESTI); Izvještaji moved under Više.

**Decision.**
* **Seven types, per member, all off for a new user.** `offer_viewed`,
  `reminder_due`, `task_deadline`, `opportunity_deadline`, `feedback_low`,
  `feedback_medium`, `feedback_high` (`public.notification_type`). One row per
  organization member and type (`notification_preferences`, unique; a toggle
  is an upsert); no row = off. Two salespeople of one organization choose
  independently. RLS: a member reads and writes only their own rows.
* **Prospective.** `enabled_at` (set by the database / server clock, never by
  the client) is when a type was last switched on. An event that happened
  before it is never sent, so switching a type on does not flood the device
  with history. An event the server finds more than 24 hours late (server
  down) is skipped rather than delivered out of context.
* **Exactly once.** Every notification is a row in `notification_deliveries`
  with an idempotency key per business event (e.g. `feedback_medium:<offer>:
  <sent_at>`, `task_deadline:<task>:<deadline>`, `offer_viewed:<event>`),
  unique per recipient. Scheduler runs, retries and restarts cannot send it
  twice. Just before sending, the event is re-checked: a type switched off, a
  task completed, an opportunity won or lost, an offer answered, or a moved
  deadline cancels it. The log records what the push service *accepted*
  (`accepted_at`, `devices_accepted`); Web Push has no device receipt, so
  nothing claims "delivered" or "read". Written by the server only.
* **Event sources.**
  * *Pregled ponude:* the existing qualifying `document_view` (rendered and
    visible, not automated, valid link, never the salesperson's preview); at
    most one notification per offer and recipient per 30 minutes. The view is
    counted regardless. The text says a view *was recorded*, never who viewed.
  * *Podsjetnik:* the existing reminder system, unchanged, delivered only while
    the recipient has it on; a reminder held back is recorded as not delivered
    (`notifications_off`) and is not sent later. Members who had reminders
    pending when this was introduced keep `reminder_due` on.
  * *Rok zadatka:* an open task's deadline (`due_at`, or `due_date` at the
    member's chosen time). *Rok prilike:* an active opportunity's expected
    close date at the member's chosen time. **No time is ever assumed:**
    without a chosen time (`notification_settings.deadline_time`, "Rokovi bez
    vremena" on the screen), date-only deadlines are not notified.
  * *Feedback Overview bands:* the existing rule (calendar days in the
    organization's timezone, sending day = 1D; 1–4D, 5–9D, 10D+). An offer
    still waiting enters a band at the band's first day at the time of day it
    was sent (`bandEntryAt` in `@renvara/domain`); one notification per band
    and offer. The bands are independent: low off, medium and high on → one at
    5D and one at 10D.
* **Recipient** of an offer's notifications: the salesperson who created the
  offer (else the opportunity's owner); of a task: its assignee (else its
  creator); of an opportunity: its owner. Only that member's devices in the
  record's organization receive it.
* **Lock-screen privacy.** Titles and bodies name the event and the customer
  or record title only: no amounts, notes, contact details or link tokens.
  The payload carries a Renvara path; the page behind it checks the session.

**Consequences.** One server-side path (the reminder scheduler) sends
reminders and the new types; nothing depends on a page being open. The
in-browser demo saves preferences but queues nothing (it cannot deliver), and
says so. Native app push (APNs/FCM) is still not part of the BETA:
`push_subscriptions` already has `platform`/`provider` for it. In production
the scheduler's queries map to the tables of migration
`20261016120000_notification_preferences.sql`; the worker runs with the
service role, members only read their own rows.

**Alternatives considered.** A single master switch (rejected: the seven types
are independent by requirement). Repeating a band notification every day
(rejected for now: spam; a later recurring policy would be a new type).
Assuming 09:00 for date-only deadlines (rejected: an invented time; the member
chooses it). Notifying a reminder retrospectively when "Podsjetnik" is switched
back on (rejected: prospective by rule).
