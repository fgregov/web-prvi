// Engagement signals of a shared offer (ADR-0008): pure functions, no I/O.
//
// Two different facts are kept apart:
//   link_access    the link was requested. Corporate mail gateways and link
//                  previews do this too, so it is never shown as a human click.
//   document_view  the viewer rendered the PDF in a visible tab for a moment.
// Bot detection is conservative and cannot be perfect: a scanner that runs a
// full browser can look like a person. Counts are signals, not proof.
import type { OfferEvent } from './types.ts';

/** Crawlers, link scanners of mail gateways, link previews, scripts and automation. */
const AUTOMATED_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|fireeye|trendmicro|symantec|forcepoint|sophos|zscaler|ironport|messagelabs|python|curl\/|wget|httpclient|go-http|java\/|okhttp|axios|node-fetch|undici|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|facebookexternalhit|whatsapp|telegram|slack|discord|skypeuripreview|ms-office|microsoft office|outlook-com/i;

export interface RequestSignals {
  readonly method: string;
  readonly userAgent: string | null;
  /** Purpose / Sec-Purpose / X-Moz / X-Purpose request headers (prefetch, prerender). */
  readonly purpose: string | null;
  /** The viewer reports navigator.webdriver (automated browser). */
  readonly automation?: boolean;
}

export interface Classification {
  readonly suspectedBot: boolean;
  readonly reason: string | null;
}

export function classifyRequest(signals: RequestSignals): Classification {
  const ua = (signals.userAgent ?? '').trim();
  if (signals.method === 'HEAD') return { suspectedBot: true, reason: 'head_request' };
  if (signals.purpose && /prefetch|prerender|preview/i.test(signals.purpose)) {
    return { suspectedBot: true, reason: 'prefetch' };
  }
  if (!ua) return { suspectedBot: true, reason: 'no_user_agent' };
  if (AUTOMATED_AGENT.test(ua)) return { suspectedBot: true, reason: 'scanner_user_agent' };
  if (signals.automation) return { suspectedBot: true, reason: 'automation' };
  return { suspectedBot: false, reason: null };
}

/** "Safari · iOS", "Chrome · Android", "Edge · Windows" … or null. Never the raw user agent. */
export function clientFamily(userAgent: string | null): string | null {
  const ua = userAgent ?? '';
  if (!ua) return null;
  const os = /iphone|ipad|ipod/i.test(ua)
    ? 'iOS'
    : /android/i.test(ua)
      ? 'Android'
      : /windows/i.test(ua)
        ? 'Windows'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : null;
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /chrome|crios|chromium/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua)
            ? 'Safari'
            : null;
  const family = [browser, os].filter(Boolean).join(' · ');
  return family || 'Ostalo';
}

/** One document view per viewing session per window: a reload does not count twice. */
export const VIEW_DEDUP_MS = 30 * 60 * 1000;
/** Accesses of one link this close together are a machine following links, not a person. */
export const RAPID_REPEAT_MS = 3 * 1000;

export interface EngagementSummary {
  /** Every recorded request of the link (scanners and previews included). */
  readonly rawAccessCount: number;
  /** Link requests that do not look automated. */
  readonly accessCount: number;
  /** Link requests and views that look automated. */
  readonly suspectedBotCount: number;
  /** Qualifying document views (rendered in a visible tab, not automated). */
  readonly viewCount: number;
  /** Distinct viewing sessions (browser tabs) with a qualifying view. Not distinct people. */
  readonly uniqueSessions: number;
  readonly firstViewAt: string | null;
  readonly lastViewAt: string | null;
  readonly lastAccessAt: string | null;
}

export function engagementSummary(events: readonly OfferEvent[]): EngagementSummary {
  let rawAccessCount = 0;
  let accessCount = 0;
  let suspectedBotCount = 0;
  let viewCount = 0;
  const sessions = new Set<string>();
  let firstViewAt: string | null = null;
  let lastViewAt: string | null = null;
  let lastAccessAt: string | null = null;
  for (const event of events) {
    if (event.suspectedBot) suspectedBotCount += 1;
    if (event.type === 'link_access') {
      rawAccessCount += 1;
      if (!event.suspectedBot) {
        accessCount += 1;
        if (!lastAccessAt || event.occurredAt > lastAccessAt) lastAccessAt = event.occurredAt;
      }
    } else if (!event.suspectedBot) {
      viewCount += 1;
      if (event.sessionId) sessions.add(event.sessionId);
      if (!firstViewAt || event.occurredAt < firstViewAt) firstViewAt = event.occurredAt;
      if (!lastViewAt || event.occurredAt > lastViewAt) lastViewAt = event.occurredAt;
    }
  }
  return {
    rawAccessCount,
    accessCount,
    suspectedBotCount,
    viewCount,
    uniqueSessions: sessions.size,
    firstViewAt,
    lastViewAt,
    lastAccessAt,
  };
}
