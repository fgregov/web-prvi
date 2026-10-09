// Push reminders on this device. Permission is asked only when the user turns
// a reminder on (never on load); a refusal never blocks saving the record.
import { api } from '../../core/api.js';

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Why push cannot reach this device, in the user's words. */
export const PUSH_UNAVAILABLE = {
  server:
    'Slanje push obavijesti ovdje nije uključeno: podsjetnik se sprema, ali neće stići na uređaj.',
  unsupported:
    'Ovaj preglednik ne prima push obavijesti (na iPhoneu najprije dodajte Renvaru na početni zaslon).',
  denied:
    'Obavijesti su blokirane u postavkama preglednika: podsjetnik se sprema, ali neće stići na uređaj.',
  failed: 'Uređaj se nije uspio prijaviti za obavijesti. Podsjetnik se svejedno sprema.',
};

const keyBytes = (base64url) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * Makes sure this device receives push reminders: asks for permission if it
 * was never asked, registers the service worker and the subscription.
 * @returns {Promise<{ ok: true } | { ok: false, reason: keyof typeof PUSH_UNAVAILABLE }>}
 */
export async function enablePush() {
  if (!supported()) return { ok: false, reason: 'unsupported' };
  let status;
  try {
    status = await api.pushStatus();
  } catch {
    return { ok: false, reason: 'server' };
  }
  if (!status.configured || !status.publicKey) return { ok: false, reason: 'server' };
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(status.publicKey),
      }));
    const { endpoint, keys } = subscription.toJSON();
    await api.subscribePush({ endpoint, keys, userAgent: navigator.userAgent });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
