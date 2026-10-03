// Service Worker leve para PWA Ao Ponto
const CACHE_NAME = 'aoponto-cache-v1';
const ASSETS_TO_CACHE = [
  '/css/design-system.css',
  '/assets/logo-dark-theme.png',
  '/assets/logo.png',
  '/assets/iFood-New-Logo-Small.png',
  '/assets/Logotipo_da_99.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NUNCA cachear chamadas de API ou requisições POST/PUT/DELETE
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return;
  }

  // Network First para páginas HTML, garantindo dados sempre frescos
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/motoboy' || url.pathname === '/fechamento') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache First com fallback para rede em arquivos estáticos (CSS, imagens, fontes)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
