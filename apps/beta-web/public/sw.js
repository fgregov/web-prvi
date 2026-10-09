// Renvara service worker: shows push reminders and opens their record when
// tapped. It holds no data and caches nothing; the server checks the session
// when the record's page opens.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard';
  event.waitUntil(
    self.registration.showNotification(data.title || 'RENVARA', {
      body: data.body || '',
      tag: data.tag,
      icon: '/brand/renvara-logo.png',
      badge: '/brand/renvara-logo.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
