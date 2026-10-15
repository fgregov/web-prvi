// Current signed-in user and their rights, from the server (read on every
// request there; the browser only uses them to show what is allowed).
let pending = null;

function load() {
  pending ??= fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : { authenticated: false }))
    .then((session) => {
      if (!session.authenticated) {
        window.location.replace('/login');
        throw new Error('Not authenticated');
      }
      return { user: session.user, permissions: new Set(session.permissions ?? []) };
    });
  return pending;
}

export function getCurrentUser() {
  return load().then((session) => session.user);
}

/** `{ user, permissions: Set<string> }` of the signed-in member. */
export function getAccess() {
  return load();
}
