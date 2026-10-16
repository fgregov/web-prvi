// Server-side reminder delivery. Runs in the server process, independent of
// any open page: every `intervalMs` it claims the reminders that are due
// (pending → processing, so a reminder is never sent twice by overlapping
// runs), sends each to every enabled device of its recipient, and records the
// outcome (sent, or failed after up to MAX_ATTEMPTS with backoff). Devices the
// push service reports as gone are switched off. Delivery is at most about one
// interval late; the push service and the device's settings decide the rest.
// MOBILNE OBAVIJESTI: a reminder is sent only while its recipient has
// "Podsjetnik" on; the same run collects the other event types (deadlines,
// Feedback Overview bands, offer views queued by the viewer) and sends them
// the same way, each exactly once.
import type { Logger } from '../app.ts';
import type { CrmServices } from '../crm/index.ts';
import type { PushSender } from './web-push.ts';

/** Outcome of a test notification ("Pošalji probnu obavijest"). */
export interface PushTestResult {
  status: 'sent' | 'not_configured' | 'no_device' | 'failed';
  devices: number;
  delivered: number;
  error: string | null;
}

export function createReminderScheduler({
  services,
  sender,
  logger,
  now = () => new Date(),
  intervalMs = 30_000,
}: {
  services: Pick<CrmServices, 'reminders' | 'pushSubscriptions' | 'notifications'>;
  sender: PushSender;
  logger: Logger;
  now?: () => Date;
  intervalMs?: number;
}) {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** One run. Returns how many reminders it handled. */
  async function tick(): Promise<number> {
    if (running) return 0; // a slow run is still going: never two at once
    running = true;
    try {
      const at = now();
      const released = services.reminders.releaseStale(at);
      if (released) logger.warn('reminders_released', { count: released });
      const due = services.reminders.claimDue(at);
      for (const reminder of due) {
        const fail = (error: string, retryable: boolean) => {
          services.reminders.markFailed(reminder.id, now(), error, retryable);
          logger.warn('reminder_not_delivered', { reminder: reminder.id, error, retryable });
        };
        const payload = services.reminders.payload(reminder);
        if (!payload) {
          fail('target_missing', false);
          continue;
        }
        if (
          !services.notifications.remindersOn(reminder.organizationId, reminder.recipientUserId)
        ) {
          fail('notifications_off', false);
          continue;
        }
        if (!sender.configured) {
          fail('push_not_configured', false);
          continue;
        }
        const devices = services.pushSubscriptions.enabledFor(
          reminder.organizationId,
          reminder.recipientUserId,
        );
        if (!devices.length) {
          fail('no_device', false);
          continue;
        }
        const results = await Promise.all(devices.map((device) => sender.send(device, payload)));
        results.forEach((result, i) => {
          if (!result.ok && result.gone)
            services.pushSubscriptions.disable(devices[i]!.endpoint, now());
        });
        if (results.some((result) => result.ok)) {
          services.reminders.markSent(reminder.id, now());
          logger.info('reminder_delivered', {
            reminder: reminder.id,
            devices: results.filter((r) => r.ok).length,
          });
        } else {
          const errors = [...new Set(results.map((r) => (r.ok ? '' : r.error)))].join(',');
          fail(
            errors,
            results.some((r) => !r.ok && r.retryable),
          );
        }
      }
      return due.length + (await deliverNotifications(at));
    } finally {
      running = false;
    }
  }

  /** The other notification types: collect what became due, then send what is queued. */
  async function deliverNotifications(at: Date): Promise<number> {
    const { notifications, pushSubscriptions } = services;
    if (notifications.releaseStale(at)) logger.warn('notifications_released');
    notifications.collectDue(at);
    const queued = notifications.claimDue(at);
    for (const item of queued) {
      const fail = (error: string, retryable: boolean) => {
        notifications.markFailed(item.id, now(), error, retryable);
        logger.warn('notification_not_delivered', { type: item.type, error, retryable });
      };
      if (!sender.configured) {
        fail('push_not_configured', false);
        continue;
      }
      const devices = pushSubscriptions.enabledFor(item.organizationId, item.recipientUserId);
      if (!devices.length) {
        fail('no_device', false);
        continue;
      }
      const payload = notifications.payload(item);
      const results = await Promise.all(devices.map((device) => sender.send(device, payload)));
      results.forEach((result, i) => {
        if (!result.ok && result.gone) pushSubscriptions.disable(devices[i]!.endpoint, now());
      });
      const accepted = results.filter((r) => r.ok).length;
      if (accepted) {
        notifications.markSent(item.id, now(), accepted);
        logger.info('notification_delivered', { type: item.type, devices: accepted });
      } else {
        fail(
          [...new Set(results.map((r) => (r.ok ? '' : r.error)))].join(','),
          results.some((r) => !r.ok && r.retryable),
        );
      }
    }
    return queued.length;
  }

  /** A test notification to every enabled device of one user, now. */
  async function sendTest(organizationId: string, userId: string): Promise<PushTestResult> {
    if (!sender.configured)
      return { status: 'not_configured', devices: 0, delivered: 0, error: null };
    const devices = services.pushSubscriptions.enabledFor(organizationId, userId);
    if (!devices.length) return { status: 'no_device', devices: 0, delivered: 0, error: null };
    const payload = {
      title: 'RENVARA',
      body: 'Probna obavijest: obavijesti stižu na ovaj uređaj.',
      url: '/dashboard',
      tag: 'renvara-test',
    };
    const results = await Promise.all(devices.map((device) => sender.send(device, payload)));
    results.forEach((result, i) => {
      if (!result.ok && result.gone)
        services.pushSubscriptions.disable(devices[i]!.endpoint, now());
    });
    const delivered = results.filter((r) => r.ok).length;
    const failure = results.find((r) => !r.ok);
    logger.info('push_test', { devices: devices.length, delivered });
    return {
      status: delivered ? 'sent' : 'failed',
      devices: devices.length,
      delivered,
      error: failure && !failure.ok ? failure.error : null,
    };
  }

  return {
    tick,
    sendTest,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch((error: unknown) =>
          logger.error('reminder_scheduler_failed', {
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
