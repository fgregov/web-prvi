// Web Push sender for reminder notifications, with node:crypto only:
//   - payload encryption, RFC 8291 (aes128gcm content coding, RFC 8188)
//   - server identification, RFC 8292 (VAPID, ES256-signed JWT)
// The browser's push service (FCM for Chrome/Android, APNs for Safari/iOS
// home-screen apps, Mozilla for Firefox) delivers to the device even when
// Renvara is closed. Endpoints and keys are never logged.
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';

/** VAPID key pair (raw P-256, base64url) and the contact the push services may use. */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  /** mailto: or https: contact for push service operators. */
  readonly subject: string;
}

export interface PushDevice {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export type PushResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly retryable: boolean;
      readonly gone: boolean;
      readonly error: string;
    };

export interface PushSender {
  readonly configured: boolean;
  readonly publicKey: string | null;
  send(device: PushDevice, payload: object): Promise<PushResult>;
}

export class PushConfigError extends Error {}

/** How long the push service keeps an undelivered reminder for an offline device. */
const TTL_SECONDS = 6 * 60 * 60;
const RECORD_SIZE = 4096;

/** Reads RENVARA_VAPID_* (all three or none). None → push delivery is off. */
export function loadVapidKeys(env: Record<string, string | undefined>): VapidKeys | null {
  const publicKey = env.RENVARA_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.RENVARA_VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = env.RENVARA_VAPID_SUBJECT?.trim() ?? '';
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) {
    throw new PushConfigError(
      'RENVARA_VAPID_PUBLIC_KEY, RENVARA_VAPID_PRIVATE_KEY and RENVARA_VAPID_SUBJECT must be set together.',
    );
  }
  if (
    Buffer.from(publicKey, 'base64url').length !== 65 ||
    Buffer.from(privateKey, 'base64url').length !== 32
  ) {
    throw new PushConfigError(
      'The VAPID keys are not raw P-256 keys (generate them with `pnpm push:keys`).',
    );
  }
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new PushConfigError('RENVARA_VAPID_SUBJECT must be a mailto: or https: contact.');
  }
  return { publicKey, privateKey, subject };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

/**
 * RFC 8291 message encryption for one subscription. `salt` and `serverKey`
 * are only passed by tests (known-answer checks); normally both are random.
 */
export function encryptPayload(
  payload: Buffer,
  device: Pick<PushDevice, 'p256dh' | 'auth'>,
  testing: { salt?: Buffer; serverPrivateKey?: Buffer } = {},
): Buffer {
  const uaPublic = Buffer.from(device.p256dh, 'base64url');
  const authSecret = Buffer.from(device.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (testing.serverPrivateKey) ecdh.setPrivateKey(testing.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = testing.salt ?? randomBytes(16);
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );

  // One record: the payload, then the last-record delimiter (0x02).
  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  if (plaintext.length + 16 > RECORD_SIZE) throw new Error('Push payload too large');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

/** RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>` for the endpoint's push service. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ typ: 'JWT', alg: 'ES256' });
  const claims = b64({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  });
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

export function createWebPushSender(
  keys: VapidKeys | null,
  {
    fetchImpl = fetch,
    now = () => new Date(),
  }: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): PushSender {
  return {
    configured: keys !== null,
    publicKey: keys?.publicKey ?? null,
    async send(device, payload) {
      if (!keys) return { ok: false, retryable: false, gone: false, error: 'push_not_configured' };
      const body = encryptPayload(Buffer.from(JSON.stringify(payload)), device);
      try {
        const response = await fetchImpl(device.endpoint, {
          method: 'POST',
          headers: {
            Authorization: vapidAuthorization(device.endpoint, keys, now()),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(TTL_SECONDS),
            Urgency: 'high',
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) return { ok: true };
        const gone = response.status === 404 || response.status === 410;
        return {
          ok: false,
          gone,
          retryable: response.status === 429 || response.status >= 500,
          error: `push_service_${response.status}`,
        };
      } catch {
        return { ok: false, gone: false, retryable: true, error: 'push_network_error' };
      }
    },
  };
}
