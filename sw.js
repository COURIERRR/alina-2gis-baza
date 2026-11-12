// Кэш оболочки приложения: сначала сеть (чтобы обновления приходили сразу), без сети — кэш.
const CACHE = 'alina-sales-v24';
// Каталоги и их просмотрщик: кэш не зависит от версии, обновление приложения его не стирает
const CATALOGS = 'alina-catalogs';
const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/alina-logo.svg', 'icons/alina-logo-navy.svg',
  'zayavki/index.html', 'zayavki/config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CATALOGS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  // Библиотека Excel для заявок: версия не меняется, сначала кэш — файл собирается и без связи
  if (e.request.url === EXCELJS) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // PDF сохраняет само приложение (app.js), здесь их кэшировать незачем
  if (/\/catalogs\/[^/]+\.pdf$/.test(url.pathname)) return;
  // Версия просмотрщика указана в адресе: сначала кэш, чтобы каталоги открывались без связи
  if (/\/vendor\/pdfjs\//.test(url.pathname)) {
    e.respondWith(caches.open(CATALOGS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
