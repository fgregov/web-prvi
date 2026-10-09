// Server-side reminder delivery. Runs in the server process, independent of
// any open page: every `intervalMs` it claims the reminders that are due
// (pending → processing, so a reminder is never sent twice by overlapping
// runs), sends each to every enabled device of its recipient, and records the
// outcome (sent, or failed after up to MAX_ATTEMPTS with backoff). Devices the
// push service reports as gone are switched off. Delivery is at most about one
// interval late; the push service and the device's settings decide the rest.
import type { Logger } from '../app.ts';
import type { CrmServices } from '../crm/index.ts';
import type { PushSender } from './web-push.ts';

export function createReminderScheduler({
  services,
  sender,
  logger,
  now = () => new Date(),
  intervalMs = 30_000,
}: {
  services: Pick<CrmServices, 'reminders' | 'pushSubscriptions'>;
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
      return due.length;
    } finally {
      running = false;
    }
  }

  return {
    tick,
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
