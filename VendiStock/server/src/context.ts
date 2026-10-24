import type { AppConfig } from './config.js';
import type { DB } from './db/index.js';
import type { SecretStore } from './lib/crypto/secretStore.js';
import type { Logger } from './logger.js';
import type { MailTransportFactory } from './modules/email/mailer.js';
import type { TelevendService } from './televend/service.js';
import type { Scheduler } from './scheduler/scheduler.js';

/**
 * Zajednički kontekst aplikacije. `db` se može zamijeniti (vraćanje iz backupa),
 * pa ga servisi uvijek čitaju iz konteksta u trenutku poziva.
 */
export class AppContext {
  /** Tijekom vraćanja iz backupa API odbija zahtjeve. */
  maintenance: string | null = null;
  mailTransportFactory: MailTransportFactory | null = null;
  televend!: TelevendService;
  scheduler!: Scheduler;

  constructor(
    public readonly config: AppConfig,
    public db: DB,
    public readonly secrets: SecretStore,
    public readonly log: Logger,
  ) {}
}
