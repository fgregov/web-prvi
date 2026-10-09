// Navigation between dedicated screens. A screen opened from somewhere returns
// there (?returnTo=, else the previous Renvara page); opened directly, it
// falls back to a sensible list.

/** `?returnTo=` when it is a same-origin path, otherwise `fallback`. */
export function returnTarget(fallback) {
  const raw = new URLSearchParams(window.location.search).get('returnTo');
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  return fallback;
}

function referrerUrl() {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin ? ref : null;
  } catch {
    return null;
  }
}

/** Leave without saving: back to the previous Renvara screen, else to `fallback`. */
export function goBack(fallback) {
  const ref = referrerUrl();
  if (ref && ref.pathname !== window.location.pathname && window.history.length > 1) {
    window.history.back();
  } else {
    window.location.replace(returnTarget(fallback));
  }
}

/**
 * After saving: go to `target`. When `target` is the page we came from, step
 * back in history (the form does not stay behind Back); otherwise replace
 * this entry. Pages reload their data on arrival, so no hard refresh is needed.
 */
export function leaveTo(target) {
  const ref = referrerUrl();
  if (ref && `${ref.pathname}${ref.search}` === target && window.history.length > 1) {
    window.history.back();
  } else {
    window.location.replace(target);
  }
}

/** Builds "/tasks/new?companyId=…&returnTo=…" style links. */
export function withParams(path, params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return entries.length ? `${path}?${new URLSearchParams(entries)}` : path;
}

/** Current path + query, for ?returnTo= on links that should come back here. */
export const here = () => `${window.location.pathname}${window.location.search}`;
