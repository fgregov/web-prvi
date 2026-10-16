// PushSubscriptionService: the devices that receive a user's push reminders
// (Web Push subscriptions from the browser's PushManager). A user may have
// several devices; registering one never replaces the others. Endpoints are
// capability URLs: they stay on the server and are never logged.
import { CrmValidationError } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import { newId, str, type Body } from './scope.ts';
import type { CrmContext, PushSubscriptionRecord } from './types.ts';

const B64URL = /^[A-Za-z0-9_-]+$/;
/** Decoded length of unpadded base64url (also runs in the browser demo: no Buffer). */
const bytes = (value: string) => Math.floor((value.length * 3) / 4);

/** https endpoints only (plain http just for a push service on this machine, in tests). */
function validEndpoint(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function createPushSubscriptionService(repo: CrmRepository) {
  return {
    /** Registers (or refreshes) this device for the signed-in user. */
    subscribe(ctx: CrmContext, input: Body) {
      const endpoint = str(input.endpoint);
      const keys = (input.keys ?? {}) as Body;
      const p256dh = str(keys.p256dh);
      const auth = str(keys.auth);
      const errors: Record<string, string> = {};
      if (!validEndpoint(endpoint)) errors.endpoint = 'Neispravna adresa uređaja.';
      // P-256 public key (65 bytes, uncompressed) and the 16-byte auth secret.
      if (!B64URL.test(p256dh) || bytes(p256dh) !== 65) errors.p256dh = 'Neispravan ključ uređaja.';
      if (!B64URL.test(auth) || bytes(auth) !== 16) errors.auth = 'Neispravan ključ uređaja.';
      if (Object.keys(errors).length) throw new CrmValidationError(errors);

      const data = repo.data();
      const now = ctx.now.toISOString();
      const existing = data.pushSubscriptions.find((s) => s.endpoint === endpoint);
      const fields = {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        p256dh,
        auth,
        userAgent: str(input.userAgent).slice(0, 300),
        enabled: true,
        lastSeenAt: now,
        updatedAt: now,
      };
      // The same browser signed in as someone else now belongs to that person.
      if (existing) Object.assign(existing, fields);
      else {
        const record: PushSubscriptionRecord = {
          id: newId(),
          platform: 'web',
          provider: 'webpush',
          endpoint,
          createdAt: now,
          ...fields,
        };
        data.pushSubscriptions.push(record);
      }
      repo.commit();
      return { devices: this.devices(ctx) };
    },

    /** Stops push to this device (only the owner's own device). */
    unsubscribe(ctx: CrmContext, input: Body) {
      const endpoint = str(input.endpoint);
      const data = repo.data();
      const sub = data.pushSubscriptions.find(
        (s) =>
          s.endpoint === endpoint &&
          s.userId === ctx.user.id &&
          s.organizationId === ctx.organizationId,
      );
      if (sub) {
        Object.assign(sub, { enabled: false, updatedAt: ctx.now.toISOString() });
        repo.commit();
      }
      return { devices: this.devices(ctx) };
    },

    /** How many devices of the signed-in user receive reminders. */
    devices(ctx: CrmContext): number {
      return this.enabledFor(ctx.organizationId, ctx.user.id).length;
    },

    enabledFor(organizationId: string, userId: string): PushSubscriptionRecord[] {
      return repo
        .data()
        .pushSubscriptions.filter(
          (s) => s.enabled && s.userId === userId && s.organizationId === organizationId,
        );
    },

    /** The push service says this device is gone (404/410): stop sending to it. */
    disable(endpoint: string, now: Date) {
      const sub = repo.data().pushSubscriptions.find((s) => s.endpoint === endpoint);
      if (!sub || !sub.enabled) return;
      Object.assign(sub, { enabled: false, updatedAt: now.toISOString() });
      repo.commit();
    },
  };
}

export type PushSubscriptionService = ReturnType<typeof createPushSubscriptionService>;
