// Follow-up Engine labels: dates, "prije 2 sata", sizes, statuses and the
// careful wording of engagement (a view is "zabilježen", never "pročitano").
import { h } from '../../ui/dom.js';

const pad = (n) => String(n).padStart(2, '0');

/** "10.10.2026." */
export function dateLabel(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}.`;
}

/** "09:42" */
export const timeLabel = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "13.10.2026. u 09:42" */
export const dateTimeLabel = (iso) => `${dateLabel(iso)} u ${timeLabel(iso)}`;

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "upravo sada", "prije 12 min", "prije 2 sata", "danas 08:42", "jučer 17:10", "10.10.2026. u 09:42" */
export function relativeTime(iso, now = new Date()) {
  const date = new Date(iso);
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return 'upravo sada';
  if (minutes < 60) return `prije ${minutes} min`;
  if (minutes < 6 * 60) {
    const hours = Math.round(minutes / 60);
    return `prije ${hours} ${hours === 1 ? 'sat' : hours < 5 ? 'sata' : 'sati'}`;
  }
  if (sameDay(date, now)) return `danas ${timeLabel(iso)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `jučer ${timeLabel(iso)}`;
  return dateTimeLabel(iso);
}

/** "2,4 MB" / "312 KB" */
export function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "1 stranica", "3 stranice", "12 stranica" */
export function pagesLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} stranica`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} stranice`;
  return `${n} stranica`;
}

/** Offer standing as the salesperson reads it. */
export const STANDING_LABEL = {
  waiting: 'Čeka odgovor',
  draft: 'Nacrt',
  answered: 'Odgovoreno',
  withdrawn: 'Povučeno',
  closed: 'Prilika zatvorena',
};

/** Why an access looks automated (shown apart from views, never as a person). */
export const BOT_REASON = {
  scanner_user_agent: 'sigurnosni skener ili pregled poveznice',
  prefetch: 'automatsko predučitavanje',
  head_request: 'tehnička provjera poveznice',
  no_user_agent: 'nepoznat klijent',
  automation: 'automatizirani preglednik',
  rapid_repeat: 'brzo ponovljeno otvaranje',
};

/** The waiting badge (1–4D yellow, 5–9D red, 10D+ black) or the standing badge. */
export function standingBadge(item) {
  if (item.standing === 'waiting' && item.waitingDays) {
    return h(
      'span',
      {
        class: `rv-wait rv-wait--${item.band}`,
        title: `Čeka odgovor: ${item.waitingDays} ${item.waitingDays === 1 ? 'dan' : 'dana'}`,
      },
      `${item.waitingDays}D`,
    );
  }
  return h(
    'span',
    { class: `rv-badge rv-badge--${item.standing === 'answered' ? 'green' : 'neutral'}` },
    STANDING_LABEL[item.standing] ?? item.standing,
  );
}

/** "Pregledi: 4 · Zadnji pregled: prije 2 sata" or "Još nema zabilježenog pregleda". */
export function viewsLine(engagement, now = new Date()) {
  if (!engagement.viewCount) return 'Još nema zabilježenog pregleda';
  return `Pregledi: ${engagement.viewCount} · Zadnji pregled: ${relativeTime(engagement.lastViewAt, now)}`;
}

export const LINK_STATUS_LABEL = {
  active: 'Link aktivan',
  revoked: 'Link opozvan',
  expired: 'Link istekao',
};
