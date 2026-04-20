self.addEventListener('install', (e) => {
  console.log('Service Worker: Installed');
});

self.addEventListener('fetch', (e) => {
  // ទុកឱ្យវាដើរតាមធម្មតា (Network Only)
  e.respondWith(fetch(e.request));
});