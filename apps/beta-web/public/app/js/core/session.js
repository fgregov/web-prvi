// Current signed-in user, from the BETA auth server.
let pending = null;

export function getCurrentUser() {
  pending ??= fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : { authenticated: false }))
    .then((session) => {
      if (!session.authenticated) {
        window.location.replace('/login');
        throw new Error('Not authenticated');
      }
      return session.user;
    });
  return pending;
}
