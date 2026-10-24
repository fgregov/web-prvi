import type { Frame, Page } from 'playwright';
import type { ConnectorConfig } from './config.js';
import { settle, type StepLog } from './browser.js';
import { ANALYZE_LOGIN_SCRIPT, type LoginAnalysis } from './pageScripts.js';

export type LoginStatus =
  | 'ok'
  | 'already_logged_in'
  | 'invalid_credentials'
  | 'mfa_required'
  | 'captcha_required'
  | 'form_not_found'
  | 'uncertain'
  | 'error';

export interface LoginResult {
  status: LoginStatus;
  message: string;
  finalUrl: string | null;
  evidence: Record<string, unknown>;
}

async function analyze(page: Page): Promise<{ frame: Frame; a: LoginAnalysis }> {
  // Glavni okvir ima prednost; ako lozinka nije tamo, provjeri iframeove (npr. ugrađena prijava).
  const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
  let first: { frame: Frame; a: LoginAnalysis } | null = null;
  for (const frame of frames) {
    try {
      const a = (await frame.evaluate(ANALYZE_LOGIN_SCRIPT)) as LoginAnalysis;
      if (!first) first = { frame, a };
      if (a.passwordVisible || a.captcha || a.mfa || a.usernameOnlyStep) return { frame, a };
    } catch {
      /* okvir s drugog izvora ili je u međuvremenu nestao */
    }
  }
  if (!first) throw new Error('Stranica se ne može analizirati.');
  return first;
}

async function customSelectorsPresent(page: Page, sel: ConnectorConfig['loginSelectors']): Promise<boolean> {
  if (!sel.loggedInIndicator) return false;
  return (await page.locator(sel.loggedInIndicator).count().catch(() => 0)) > 0;
}

/** Provjera je li sesija (spremljeni kolačići) još valjana. */
export async function checkLoggedIn(page: Page, sel: ConnectorConfig['loginSelectors']): Promise<{ loggedIn: boolean; a: LoginAnalysis }> {
  const { a } = await analyze(page);
  if (a.passwordVisible || a.captcha || a.mfa || a.usernameOnlyStep) return { loggedIn: false, a };
  if (sel.loggedInIndicator) return { loggedIn: await customSelectorsPresent(page, sel), a };
  return { loggedIn: a.logoutFound, a };
}

/**
 * Prijava putem korisničkog web obrasca. Obrazac se prepoznaje heuristički (polje lozinke,
 * pripadajuće korisničko ime i gumb) ili prema selektorima iz naprednih postavki.
 * CAPTCHA i MFA se NE zaobilaze – prijava se prekida i traži ručna potvrda korisnika.
 * Funkcija radi točno jedan pokušaj prijave; ponavljanje kontrolira pozivatelj.
 */
export async function performLogin(
  page: Page,
  creds: { username: string; password: string },
  cfg: ConnectorConfig,
  log: StepLog,
): Promise<LoginResult> {
  const sel = cfg.loginSelectors;
  const timeout = cfg.navigationTimeoutSeconds * 1000;
  const startUrl = page.url();
  let { frame, a } = await analyze(page);
  log.info(`Stranica: „${a.title}”, polje lozinke: ${a.passwordVisible ? 'da' : 'ne'}`);

  if (a.captcha) {
    return { status: 'captcha_required', message: 'Portal traži CAPTCHA provjeru. Automatska prijava nije moguća – koristite ručnu prijavu.', finalUrl: page.url(), evidence: { stage: 'before_submit' } };
  }
  if (a.mfa) {
    return { status: 'mfa_required', message: 'Portal traži dodatnu (MFA) potvrdu. Koristite ručnu prijavu kroz kontroliranu sesiju.', finalUrl: page.url(), evidence: { stage: 'before_submit' } };
  }
  const hasCustom = !!(sel.username || sel.password);
  if (!a.passwordVisible && !a.usernameOnlyStep && !hasCustom) {
    if (a.logoutFound || (await customSelectorsPresent(page, sel))) {
      return { status: 'already_logged_in', message: 'Sesija je već aktivna.', finalUrl: page.url(), evidence: { logoutFound: a.logoutFound } };
    }
    return {
      status: 'form_not_found',
      message:
        'Na zadanoj adresi nije pronađen obrazac za prijavu. Provjerite URL ili u naprednim postavkama unesite selektore polja za prijavu.',
      finalUrl: page.url(),
      evidence: { title: a.title },
    };
  }

  // Korak 1 (opcionalno): prijava u dva koraka – najprije korisničko ime
  if (!hasCustom && a.usernameOnlyStep) {
    log.info('Prepoznata prijava u dva koraka – unosim korisničko ime.');
    await frame.locator('[data-vs-role=username]').fill(creds.username);
    if (a.submitFound) await frame.locator('[data-vs-role=submit]').click();
    else await frame.locator('[data-vs-role=username]').press('Enter');
    await settle(page, timeout);
    ({ frame, a } = await analyze(page));
    if (a.captcha) return { status: 'captcha_required', message: 'Portal traži CAPTCHA provjeru.', finalUrl: page.url(), evidence: { stage: 'step2' } };
    if (a.mfa) return { status: 'mfa_required', message: 'Portal traži dodatnu (MFA) potvrdu.', finalUrl: page.url(), evidence: { stage: 'step2' } };
    if (!a.passwordVisible) {
      return { status: 'form_not_found', message: 'Nakon unosa korisničkog imena nije se pojavilo polje za lozinku.', finalUrl: page.url(), evidence: { errorText: a.errorText } };
    }
  }

  const userLoc = sel.username ? page.locator(sel.username).first() : a.usernameFound ? frame.locator('[data-vs-role=username]') : null;
  const passLoc = sel.password ? page.locator(sel.password).first() : frame.locator('[data-vs-role=password]');
  const submitLoc = sel.submit ? page.locator(sel.submit).first() : a.submitFound ? frame.locator('[data-vs-role=submit]') : null;

  if (userLoc) {
    const current = await userLoc.inputValue().catch(() => '');
    if (current !== creds.username) await userLoc.fill(creds.username);
  } else {
    log.warn('Polje za korisničko ime nije pronađeno – nastavljam samo s lozinkom.');
  }
  await passLoc.fill(creds.password);
  log.info('Podaci za prijavu uneseni, šaljem obrazac.');
  const nav = page.waitForNavigation({ timeout, waitUntil: 'domcontentloaded' }).catch(() => null);
  if (submitLoc) await submitLoc.click({ timeout: 15_000 });
  else await passLoc.press('Enter');
  await nav;
  await settle(page, timeout);
  // Pričekaj da polje lozinke nestane (SPA aplikacije ne mijenjaju URL)
  await page
    .waitForFunction(
      () => ![...document.querySelectorAll('input[type=password]')].some((i) => (i as HTMLElement).offsetParent !== null),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);

  const after = await analyze(page);
  const evidence = {
    urlChanged: page.url() !== startUrl,
    logoutFound: after.a.logoutFound,
    title: after.a.title,
  };
  if (after.a.captcha) return { status: 'captcha_required', message: 'Nakon slanja obrasca portal traži CAPTCHA provjeru.', finalUrl: page.url(), evidence };
  if (after.a.mfa) return { status: 'mfa_required', message: 'Portal traži dodatnu (MFA) potvrdu. Koristite ručnu prijavu.', finalUrl: page.url(), evidence };
  if (after.a.passwordVisible) {
    return {
      status: 'invalid_credentials',
      message: after.a.errorText
        ? `Prijava nije uspjela. Poruka portala: „${after.a.errorText}”`
        : 'Prijava nije uspjela – obrazac za prijavu je i dalje prikazan. Provjerite korisničko ime i lozinku.',
      finalUrl: page.url(),
      evidence: { ...evidence, errorText: after.a.errorText },
    };
  }
  if (sel.loggedInIndicator) {
    const ok = await customSelectorsPresent(page, sel);
    return ok
      ? { status: 'ok', message: 'Prijava uspješna (potvrđeno indikatorom prijave).', finalUrl: page.url(), evidence }
      : { status: 'uncertain', message: 'Obrazac je poslan, ali indikator prijave nije pronađen.', finalUrl: page.url(), evidence };
  }
  if (after.a.logoutFound) {
    return { status: 'ok', message: 'Prijava uspješna (pronađena opcija odjave).', finalUrl: page.url(), evidence };
  }
  return {
    status: 'uncertain',
    message:
      'Obrazac je poslan i polje lozinke više nije prikazano, ali prijava nije nedvosmisleno potvrđena. Postavite „indikator prijave” u naprednim postavkama.',
    finalUrl: page.url(),
    evidence,
  };
}
