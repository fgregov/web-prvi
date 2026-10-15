# ADR-0013: Web-first cloud CRM (browser app, one address per page)

**Status.** Accepted. Supersedes ADR-0011 (iOS Capacitor shell) and the mobile
part of ADR-0001 (Expo app). The backend part of ADR-0001 (Supabase as the
single backend, RLS as the security boundary) stands.

**Context.** The product owner decided that Renvara is a cloud SaaS used in
a browser (Chrome, Edge, Safari, Firefox) on its own HTTPS domain. Desktop
comes first; tablets and phones use the same app in their browser. There is
no native iOS/Android app, no App Store/Play release and no native navigation.
The BETA web app (apps/beta-web) was built phone-first: a bottom tab bar, a
floating "+" button, a "Više" page, and different top bars per page family.

**Decision.**
* **No native shells.** `apps/ios` (Capacitor), `demo-app-ios` and the iOS
  workflow are removed, with their dependencies. Capacitor, React Native, Expo
  or similar layers are not to be added. The web app manifest and Web Push
  (Home Screen web app, service worker) stay: they are browser features.
* **One address per page.** `public/app/js/core/routes.js` is the single route
  table for the BETA server and the in-browser demo: every module and record
  has its own URL (`/sales/leads/:id`, `/sales/opportunities/:id`, …), so Back,
  Forward, refresh, bookmarks and deep links work. Each page is a real server
  page (multi-page app). Old addresses (`/customers`, `/opportunities`,
  `/calendar`, `/notifications`, `/more`, …) answer **301** with the new address
  and the same query; the browser keeps the `#section`. Unknown addresses get
  a 404 page.
* **One navigation.** A left sidebar on every signed-in page
  (`ui/app-shell.js`): Početna, Follow-up engine, Prodaja ▾ (Leads, Prilike,
  Zadaci, Kupci), Prikaz više ▾ (Sales kalendar, Opportunity pipeline, Feedback
  overview), Izvještaji, Korisnici; at the bottom the profile, Postavke and
  Odjava. "Prodaja" and "Prikaz više" only open and close their lists. "+ Novo"
  opens Quick Add. On computers (1024 px+) the sidebar can be narrowed to icons
  (remembered in the browser); below 1024 px a top bar opens the same sidebar
  as a drawer. No bottom navigation.
* **Modules not built yet** (Izvještaji, Korisnici) have a status page saying
  so; no simulated data.
* The BETA server stays as described in ADR-0012 (one container, JSON store,
  env-configured BETA account) until the Supabase backend is connected; see
  docs/architecture/06-web-security-review.md for what that requires.

**Consequences.** One layout to maintain and test; the same links work on
every device. Links shared before the change keep working through the
redirects, and push notifications already delivered open the right page.
Phones get the browser app, not an app-store app: no offline mode beyond the
in-browser demo, and push only through Web Push (on iPhone from the Home
Screen web app, iOS 16.4+).

**Alternatives considered.** Keeping the phone layout with a rail on wide
screens (the previous step): rejected, the owner wants a desktop-first
product. A client-side single-page router: rejected for now, the server
already serves one page per address and the pages are small; a router would
be a rewrite without a user-visible gain.
