// Renvara iOS shell (Capacitor). Two kinds of test build:
//   - default: the Renvara web app built into the app (scripts/prepare-web.mjs);
//     it runs offline and keeps its records on the phone only.
//   - RENVARA_IOS_SERVER_URL=https://…: the app opens that Renvara BETA server
//     (sign-in, data and checks stay on the server). HTTPS only.
// The bundle id and the Apple team are set when archiving (scripts/testflight.sh).
const serverUrl = process.env.RENVARA_IOS_SERVER_URL?.trim() || null;
if (serverUrl && !/^https:\/\/[^/\s]+/.test(serverUrl)) {
  throw new Error('RENVARA_IOS_SERVER_URL must be an https:// address');
}

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: 'app.renvara.beta',
  appName: 'Renvara',
  webDir: 'www',
  backgroundColor: '#ffffff',
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
  server: serverUrl
    ? { url: serverUrl, cleartext: false, errorPath: 'offline.html' }
    : { errorPath: 'offline.html' },
};
