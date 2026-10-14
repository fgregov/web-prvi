#!/usr/bin/env bash
# Renvara iOS: build the app and send it to App Store Connect (TestFlight).
# macOS with Xcode 26 only (Apple builds and signs iOS apps nowhere else).
#
#   scripts/testflight.sh upload   archive, sign and upload to App Store Connect (default)
#   scripts/testflight.sh ipa      archive, sign and write build/export/App.ipa
#                                  (upload it with Apple's Transporter app)
#   scripts/testflight.sh check    unsigned simulator build: does it compile? (no Apple account)
#
# upload / ipa need:
#   APPLE_TEAM_ID      your Apple Developer team ID (10 characters)
#   IOS_BUNDLE_ID      the app's bundle ID, registered in your developer account
#                      and used by the app record in App Store Connect
# and either an App Store Connect API key (CI, no Xcode sign-in):
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (path to AuthKey_<id>.p8, outside the repo)
# or, without them, the Apple ID signed in to Xcode (Settings → Accounts).
#
# Optional: IOS_VERSION (default: package.json version), IOS_BUILD_NUMBER (default:
# UTC yymmddHHMM, always increasing), RENVARA_IOS_CONTENT / RENVARA_IOS_SERVER_URL
# (what the app contains, see scripts/prepare-web.mjs).
set -euo pipefail

MODE="${1:-upload}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/ios/App/App.xcodeproj"
BUILD="$ROOT/build"

case "$MODE" in upload | ipa | check) ;; *)
  echo "usage: scripts/testflight.sh [upload|ipa|check]" >&2
  exit 2
  ;;
esac
if [[ "$(uname)" != "Darwin" ]] || ! command -v xcodebuild > /dev/null; then
  echo "This needs macOS with Xcode (xcodebuild)." >&2
  exit 1
fi

echo "== Web content and native project (cap sync)"
(cd "$ROOT" && pnpm run sync)

if [[ "$MODE" == "check" ]]; then
  echo "== Unsigned build for the iOS Simulator"
  xcodebuild -project "$PROJECT" -scheme App -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$BUILD/DerivedData" CODE_SIGNING_ALLOWED=NO build
  echo "OK: the app compiles."
  exit 0
fi

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID (Apple Developer team ID)}"
: "${IOS_BUNDLE_ID:?Set IOS_BUNDLE_ID (the bundle ID of your App Store Connect app record)}"
VERSION="${IOS_VERSION:-$(node -p "require('$ROOT/package.json').version")}"
BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date -u +%y%m%d%H%M)}"

AUTH=(-allowProvisioningUpdates)
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  : "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID with ASC_KEY_ID}"
  : "${ASC_KEY_PATH:?Set ASC_KEY_PATH (the AuthKey_<id>.p8 file) with ASC_KEY_ID}"
  AUTH+=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

rm -rf "$BUILD/Renvara.xcarchive" "$BUILD/export"
mkdir -p "$BUILD"

echo "== Archive $IOS_BUNDLE_ID $VERSION ($BUILD_NUMBER)"
xcodebuild -project "$PROJECT" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$BUILD/Renvara.xcarchive" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID" \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGN_STYLE=Automatic "${AUTH[@]}" archive

DESTINATION=$([[ "$MODE" == "upload" ]] && echo upload || echo export)
cat > "$BUILD/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "== Export ($DESTINATION)"
xcodebuild -exportArchive -archivePath "$BUILD/Renvara.xcarchive" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" -exportPath "$BUILD/export" "${AUTH[@]}"

if [[ "$MODE" == "upload" ]]; then
  echo "OK: $VERSION ($BUILD_NUMBER) uploaded. App Store Connect → TestFlight shows it after processing (usually 5–30 min)."
else
  echo "OK: $BUILD/export/App.ipa — upload it with Transporter (Mac App Store)."
fi
