const CACHE_VERSION = 'v1';
const STATIC_CACHE = `clairo-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `clairo-dynamic-${CACHE_VERSION}`;
const FONTS_CACHE = `clairo-fonts-${CACHE_VERSION}`;

// Core assets to precache immediately on install
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './product-facewash.jpg',
    './product-moisturizer.jpg',
    './product-serum.jpg',
    './product-sunscreen.jpg',
    './product-toner.jpg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-32x32.png',
    './icons/favicon-16x16.png',
    './icons/favicon.svg'
];

// Install Event: cache core shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        }).then(() => {
            return self.skipWaiting();
        }).catch((err) => {
            console.error('[SW] Clairo Precache failed:', err);
        })
    );
});

// Activate Event: clean up legacy caches and claim clients
self.addEventListener('activate', (event) => {
    const expectedCaches = [STATIC_CACHE, DYNAMIC_CACHE, FONTS_CACHE];
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (!expectedCaches.includes(key) && key.startsWith('clairo-')) {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch Event Strategy
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Only handle GET requests
    if (request.method !== 'GET') {
        return;
    }

    // 1. Google Fonts stylesheets & webfonts / CDNs: Stale-While-Revalidate
    if (url.origin === 'https://fonts.googleapis.com' || 
        url.origin === 'https://fonts.gstatic.com' ||
        url.origin === 'https://cdn.jsdelivr.net') {
        event.respondWith(
            caches.open(FONTS_CACHE).then((cache) => {
                return cache.match(request).then((cachedResponse) => {
                    const fetchPromise = fetch(request).then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => cachedResponse);

                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // 2. HTML Navigation requests: Network-First with Cache Fallback
    if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(STATIC_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(async () => {
                // Return cached index.html if offline
                const cachedPage = await caches.match(request);
                if (cachedPage) return cachedPage;
                const cachedIndex = await caches.match('./index.html');
                if (cachedIndex) return cachedIndex;
                return caches.match('./');
            })
        );
        return;
    }

    // 3. Local images and media: Cache-First with Dynamic Cache Fallback
    const isImage = request.destination === 'image' || 
                    url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i);

    if (isImage) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(request).then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }
                    const responseClone = networkResponse.clone();
                    caches.open(DYNAMIC_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return networkResponse;
                }).catch(() => {
                    // Fallback to product serum image if another product image is missing offline
                    return caches.match('./product-serum.jpg');
                });
            })
        );
        return;
    }

    // 4. Default for other assets: Stale-While-Revalidate
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(STATIC_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});

// Listen for message to skip waiting manually if client requests
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
