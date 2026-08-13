// Outlaw Trading Cards — service worker for Web Push ("show starting" alerts).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Outlaw Trading Cards', {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'otc-live',
    renotify: true,
    data: { url: data.url || '/live/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/live/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if (w.url.includes(url) && 'focus' in w) return w.focus(); }
    return clients.openWindow(url);
  }));
});
