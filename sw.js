// Service worker: чтобы программа открывалась без интернета.
// Стратегия «сначала сеть»: при интернете всегда свежая версия, без него — сохранённая.
// Если интернет есть, но «висит» (слабая связь), ждём недолго и открываем сохранённую версию.
const CACHE = 'zdorovenkiy-v13';
const NAV_WAIT_MS = 3000;   // сколько ждём сеть при открытии программы
const FILE_WAIT_MS = 8000;  // сколько ждём каждый файл, если при открытии сеть ответила
let cacheUntil = 0;         // сеть при открытии не ответила: до этого времени все файлы берём из сохранённых
                            // (целиком одну версию — чтобы не смешать новые файлы со старыми)
const UI_IMG = ['glass-full', 'glass-empty', 'salad', 'camera', 'sneaker', 'dumbbell', 'moon', 'scale', 'calendar', 'bulb',
  'fire', 'star', 'egg', 'soup', 'fish', 'apple', 'family', 'park', 'logo', 'house', 'plate', 'more', 'robot', 'bell', 'nophone', 'trophy',
  'person', 'gear', 'book', 'cart', 'clipboard', 'cloud', 'stopwatch', 'heart', 'target'].map(n => `./img/ui/${n}.webp`);
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/store.js', './js/i18n.js', './js/units.js', './js/health.js', './js/progress.js', './js/content.js',
  './js/recipes.js', './js/planner.js', './js/goal.js', './js/ai.js', './js/remind.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ...UI_IMG,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Напоминание пришло с сервера — показать его
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Здаровенький', {
    body: m.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: m.url || './' },
    tag: m.tag || undefined,
  }));
});

// Нажали на уведомление — открыть программу на нужном экране
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus();
        if ('navigate' in w) await w.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  const saved = () => caches.match(req, { ignoreSearch: true });
  e.respondWith((async () => {
    if (!nav && Date.now() < cacheUntil) {
      const hit = await saved();
      if (hit) return hit;
    }
    const net = fetch(req);
    net.catch(() => { /* обработаем ниже */ });
    let res = null;
    try {
      res = await Promise.race([net, new Promise(ok => setTimeout(ok, nav ? NAV_WAIT_MS : FILE_WAIT_MS, null))]);
    } catch { /* сети нет */ }
    if (res) {
      if (nav) cacheUntil = 0;
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}));
      }
      return res;
    }
    // Сеть не ответила вовремя (или её нет) — сохранённая версия
    const hit = (await saved()) || (nav ? await caches.match('./index.html') : null);
    if (hit) {
      if (nav) cacheUntil = Date.now() + 30_000;
      return hit;
    }
    // Сохранённого нет — ждём сеть до конца
    try { return await net; } catch { return (await caches.match('./index.html')) || Response.error(); }
  })());
});
