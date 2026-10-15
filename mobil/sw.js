/* AMMO Mobil — service worker.
 *  • Proqram faylları keşdə (sürətli açılış), məlumat HƏMİŞƏ serverdən (Firebase sorğuları keşlənmir).
 *  • suite/… — AMMO SUITE panelləri: AMMO_SUITE.zip-dən açılıb «ammo-suite-files» keşinə yazılır (app.js),
 *    buradan verilir. */
const VERSION = 'ammo-mobil-1.1.0';
const SUITE_CACHE = 'ammo-suite-files';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'chrome-shim.js', 'manifest.webmanifest', 'icons/icon192.png', 'icons/icon512.png', 'icons/icon180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SUITE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (url.pathname.startsWith(scope.pathname + 'suite/')) {
    e.respondWith(caches.open(SUITE_CACHE).then((c) => c.match(e.request, { ignoreSearch: true })).then((r) => r || new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:24px">Panel hələ telefona yüklənməyib. <a href="' + scope.href + '#panels">AMMO → Panellər</a> bölməsini açın.</body>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  // Şəbəkə birinci (yeni versiya dərhal gəlsin), internet yoxdursa keşdən
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
