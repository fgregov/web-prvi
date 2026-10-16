# ADR-0011: iOS test builds through a Capacitor shell (TestFlight)

**Status.** Superseded by ADR-0013 (web-first): `apps/ios`, `demo-app-ios` and
the iOS workflow were removed. Kept for the record.

**Context.** The product owner wants Renvara on iPhones through TestFlight to
test it, before the final version. ADR-0001 plans the native app with Expo;
that app does not exist yet, while the BETA web app (apps/beta-web) and its
in-browser build (`demo/build.ts`) do. Apple builds and signs iOS apps only
with Xcode on macOS, with an Apple Developer account.

**Decision.**
* `apps/ios`: a Capacitor 8 shell (WKWebView, Swift Package Manager, iOS 15+,
  iPhone, portrait). It contains the existing web app unchanged:
  * by default the in-browser build (clean start, or with demo data), which
    runs offline and keeps its records on the phone;
  * optionally (`RENVARA_IOS_SERVER_URL`, https only) the BETA server's pages,
    with the server's sign-in and data.
* No credential, session secret or push key goes into the app: the built-in
  build has none, the server build only an address. A test checks the web
  content against the BETA `.env` values.
* `scripts/testflight.sh` archives, signs (automatic signing; Xcode account
  or App Store Connect API key) and uploads; `.github/workflows/ios.yml` does
  the same on GitHub's macOS runners (secrets in GitHub only) and
  compile-checks every change to `apps/ios`.
* `ITSAppUsesNonExemptEncryption = NO`: the app uses only the system's HTTPS.

**Consequences.** Testers get the real screens on a phone without App Store
review (internal TestFlight). Push does not reach the app: Web Push is not
available in a WKWebView and native APNs push is not built
(`push_subscriptions.platform/provider` are ready for it). Records in the
built-in build live in WebView storage on one phone. This shell is not the
release architecture: an App Store release needs native push, real sign-in
options, privacy answers and review notes, and an app that only opens a
website risks rejection (guideline 4.2).

**Alternatives considered.** Building the Expo app now (rejected for a test:
weeks of work before anything can be tried). Only the Home Screen web app
(PWA) (already works, but is not a TestFlight build). Loading the BETA server
by default (rejected: needs a public HTTPS server before anyone can test).
