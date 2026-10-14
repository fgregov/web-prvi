# Renvara iOS (TestFlight test build)

An iOS app around the Renvara web app ([Capacitor](https://capacitorjs.com) 8,
Swift Package Manager, iOS 15+, iPhone, portrait). It exists to put a test
build on iPhones through **TestFlight**. It is not the planned native app
(ADR-0001, Expo) and not ready for an App Store release; see
[ADR-0011](../../docs/adr/0011-ios-testflight-shell.md).

## What the app contains

| Build | How | What testers get |
| --- | --- | --- |
| **Built-in, clean** (default) | nothing to set | The Renvara web app inside the app, empty at first. Runs offline; records stay **on that phone only** (WebView storage, lost if the app is deleted). Login accepts any name and password (as in the web demo); nothing is sent anywhere. |
| Built-in, demo data | `RENVARA_IOS_CONTENT=demo` | The same with the presentation demo data (re-seeded daily). |
| BETA server | `RENVARA_IOS_SERVER_URL=https://…` | The app opens that Renvara BETA server: real sign-in, data on the server. The server must be reachable over HTTPS from the phone (e.g. the tunnel in the BETA README). Without a connection the app shows "Renvara nije dostupna". |

Not in this test build (honest list):

- **No push notifications.** Web Push does not exist inside an iOS app's
  WebView; native push (APNs) is not built yet. The built-in app says so on
  MOBILNE OBAVIJESTI ("U demou se obavijesti ne šalju"). With the BETA server
  build, that screen suggests adding Renvara to the Home Screen in Safari,
  which is how push works there today; inside the app it does not.
- When online, the built-in app loads its font from Google Fonts and the PDF
  viewer (pdf.js) from jsDelivr; offline it uses the system font and PDF
  pages are not drawn.
- The sign-in screen's "Nastavi s Appleom / Googleom" and "Zaboravljena
  lozinka?" are not working features, and the demo texts ("Demo: prijava
  prihvaća…") are shown as in the web demo.

## Before the first upload (once, in your Apple account)

1. **Apple Developer Program** membership (paid, yearly) for the account that
   will publish.
2. **Bundle ID**: [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
   → Identifiers → + → App IDs → App → Explicit, e.g. `hr.yourcompany.renvara`
   (no extra capabilities needed). The project's placeholder is
   `app.renvara.beta`; the build uses yours (`IOS_BUNDLE_ID`).
3. **App record**: [App Store Connect](https://appstoreconnect.apple.com) → Apps
   → + → New App: platform iOS, name (must be unique on the App Store, e.g.
   "Renvara CRM"), primary language Croatian, that bundle ID, any SKU.
4. Your **Team ID**: developer account → Membership details (10 characters).

## Build and upload: on a Mac (simplest)

Needs macOS with **Xcode 26** (App Store Connect accepts only builds made with
the current SDK), Node 22, pnpm 10.

```bash
pnpm install
cd apps/ios
APPLE_TEAM_ID=XXXXXXXXXX IOS_BUNDLE_ID=hr.yourcompany.renvara scripts/testflight.sh
```

Signing uses the Apple ID signed in to Xcode (Xcode → Settings → Accounts);
Xcode creates the certificate and profile itself. The script prepares the web
content, archives, signs and uploads. Alternatives:

- `scripts/testflight.sh ipa` writes `build/export/App.ipa` for Apple's
  Transporter app.
- By hand: `pnpm run sync`, open `ios/App/App.xcodeproj`, choose your team
  under Signing & Capabilities, Product → Archive → Distribute App → App Store
  Connect → Upload.
- `scripts/testflight.sh check` only checks that the app compiles (no account).

Each upload gets a new build number (UTC `yymmddHHMM`); the version is
`package.json` → `version` (0.1.0).

## Build and upload: without a Mac (GitHub Actions)

The workflow `.github/workflows/ios.yml` builds on GitHub's macOS machines.
Every push that changes `apps/ios` runs an unsigned compile check. An upload
needs, once:

1. App Store Connect → Users and Access → Integrations → **App Store Connect
   API** → Team Keys → + (access **Admin**, so Xcode may create the signing
   certificate and profile). Download `AuthKey_<KEY ID>.p8` (only once possible)
   and note the Key ID and the Issuer ID.
2. GitHub → repository Settings → Secrets and variables → Actions:
   - Secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, and
     `ASC_KEY_P8_BASE64` = the output of `base64 -i AuthKey_<KEY ID>.p8`.
   - Variables: `IOS_BUNDLE_ID`.
   Never commit the `.p8` file (it is in `.gitignore`).
3. Start an upload: push a tag such as `ios-0.1.0-1`
   (`git tag ios-0.1.0-1 && git push origin ios-0.1.0-1`), or, once the
   workflow is on the default branch, Actions → iOS → Run workflow (choose
   clean/demo or a server address).

## TestFlight

After processing (usually 5–30 minutes) the build appears under the app's
TestFlight tab.

- **Internal testing** (fastest, no review): add up to 100 members of your
  App Store Connect team to an internal group; they install the TestFlight app
  and accept the invitation.
- **External testing** (anyone by e-mail or public link): needs Beta App
  Review, test information (what to test, contact e-mail) and, for the
  sign-in, a demo account or a note that any name and password works.

## Before an App Store release (not done)

Native push (APNs) and a server for it; a real or removed Apple/Google sign-in;
no demo texts; a privacy policy URL and the App Privacy answers in App Store
Connect; screenshots; review notes. A build that only opens a website can be
rejected under guideline 4.2 (minimum functionality), so the BETA server build
is for testing only.

## Files

| Path | What |
| --- | --- |
| `capacitor.config.js` | App name, web content, server address (env) |
| `scripts/prepare-web.mjs` | Builds `www/` (the web content) |
| `scripts/testflight.sh` | check / archive / sign / upload (macOS) |
| `ios/App` | Xcode project (Info.plist, icon, launch screen) |
| `test/ios-project.test.mjs` | Checks the project and the web content (`pnpm test`) |

The icon and launch screen come from `apps/beta-web/public/brand/icon-512.png`
(redrawn at 1024 px, no transparency, as App Store Connect requires).
