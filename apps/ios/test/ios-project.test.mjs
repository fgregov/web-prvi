// The iOS shell: what App Store Connect checks on upload (version, icon without
// transparency, export compliance, iPhone portrait) and what goes into the app
// (the web content, never a server secret).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(ROOT, 'ios/App/App');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** Width, height and PNG colour type (2 = RGB, 6 = RGBA) from the IHDR chunk. */
function png(path) {
  const bytes = readFileSync(resolve(APP, path));
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

function config(env = {}) {
  const script = "process.stdout.write(JSON.stringify(require('./capacitor.config.js')))";
  return JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      env: { ...process.env, RENVARA_IOS_SERVER_URL: '', ...env },
    }),
  );
}

const prepare = (env = {}) =>
  execFileSync(process.execPath, ['scripts/prepare-web.mjs'], {
    cwd: ROOT,
    env: { ...process.env, RENVARA_IOS_SERVER_URL: '', RENVARA_IOS_CONTENT: '', ...env },
    stdio: 'pipe',
  });

test('Capacitor config: Renvara, web content from www, offline page', () => {
  const c = config();
  assert.equal(c.appName, 'Renvara');
  assert.equal(c.webDir, 'www');
  assert.equal(c.server.url, undefined);
  assert.equal(c.server.errorPath, 'offline.html');
});

test('a server build opens only an https address', () => {
  const c = config({ RENVARA_IOS_SERVER_URL: 'https://renvara.example.com' });
  assert.equal(c.server.url, 'https://renvara.example.com');
  assert.equal(c.server.cleartext, false);
  assert.throws(() => config({ RENVARA_IOS_SERVER_URL: 'http://renvara.example.com' }));
});

test('Info.plist: export compliance answered, iPhone portrait, arm64, name Renvara', () => {
  const plist = readFileSync(resolve(APP, 'Info.plist'), 'utf8');
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Renvara<\/string>/);
  const orientations = plist.match(
    /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/,
  )[1];
  assert.deepEqual(orientations.match(/UIInterfaceOrientation\w+/g), [
    'UIInterfaceOrientationPortrait',
  ]);
  assert.match(plist, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64/);
  assert.equal(plist.includes('~ipad'), false);
});

test('Xcode project: iPhone only, version from package.json, automatic signing', () => {
  const project = readFileSync(resolve(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  assert.equal(project.match(/TARGETED_DEVICE_FAMILY = 1;/g)?.length, 2);
  assert.equal(project.match(new RegExp(`MARKETING_VERSION = ${pkg.version};`, 'g'))?.length, 2);
  assert.equal(project.match(/CODE_SIGN_STYLE = Automatic;/g)?.length, 2);
  assert.equal(/DEVELOPMENT_TEAM = \w+/.test(project), false); // set when archiving
});

test('App icon 1024×1024 without transparency; Renvara launch screen', () => {
  assert.deepEqual(png('Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), {
    width: 1024,
    height: 1024,
    colorType: 2,
  });
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    assert.equal(png(`Assets.xcassets/Splash.imageset/${name}`).width, 2732);
  }
});

test('server build: www holds only the offline page, retrying the server', () => {
  prepare({ RENVARA_IOS_SERVER_URL: 'https://renvara.example.com' });
  const index = read('www/index.html');
  assert.match(index, /Renvara nije dostupna/);
  assert.match(index, /href="https:\/\/renvara\.example\.com"/);
  assert.equal(index.length < 5000, true);
});

test('bundled build: the whole app in www/index.html, no server secret inside', () => {
  prepare();
  const index = read('www/index.html');
  assert.match(index, /^<!doctype html>/);
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /<meta charset="utf-8" \/>/);
  assert.match(read('www/offline.html'), /href="index\.html"/);
  assert.equal(index.length > 200_000, true);
  // Values from the BETA server's .env (credentials, session and push keys) never get in.
  const envFile = resolve(ROOT, '../beta-web/.env');
  const secrets = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*(\w+)\s*=\s*"?([^"\n]*)"?\s*$/))
        .filter((m) => m && m[2].length >= 6 && !/^(true|false|production|development)$/.test(m[2]))
        .map((m) => [m[1], m[2]])
    : [];
  for (const [name, value] of secrets) assert.equal(index.includes(value), false, name);
});
