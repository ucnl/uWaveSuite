const CACHE = 'uwave-v16';

const ASSETS = [
	'./',
	'./index.html',
	'./styles.css',
	'./app.js',
	'./geo-utils.js',
	'./vincenty.js',
	'./haversine.js',
	'./dh-filter.js',
	'./median.js',
	'./smoother.js',
	'./dh-filter-xyz.js',
	'./smoother-xyz.js',
	'./sound-speed.js',
	'./gnss-parser.js',
	'./webview-stub.js',
	'./uw-protocol.js',
	'./serial-manager.js',
	'./uw-port.js',
	'./uw-queue-manager.js',
	'./uw-device-manager.js',
	'./uw-tracking-engine.js',
	'./uw-usbl-solver.js',
	'./uw-vlbl-solver.js',
	'./uw-vlbl-measurements.js',
	'./uw-vlbl-store.js',
	'./uw-vlbl-worker.js',
	'./settings-storage.js',
	'./tracks.js',
	'./poi-manager.js',
	'./log-storage.js',
	'./logger.js',
	'./log-analyzer.js',
	'./export.js',
	'./modules/ui-themes.js',
	'./modules/ui-settings.js',
	'./modules/ui-chat.js',
	'./modules/ui-tracking.js',
	'./modules/ui-addressing.js',
	'./modules/ui-vlbl.js',
	'./modules/ui-devices.js',
	'./modules/ui-console.js',
	'./modules/ui-export.js',
	'./modules/ui-map.js',
	'./modules/ui-ruler.js',
	'./modules/ui-topo.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => {
            // Загружаем файлы по одному, игнорируя ошибки
            return Promise.all(
                ASSETS.map(url => 
                    cache.add(url).catch(err => 
                        console.warn('[SW] Failed to cache:', url, err)
                    )
                )
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		Promise.all([
			clients.claim(),
			// Удаляем старые кэши
			caches.keys().then((keys) => {
				return Promise.all(
					keys.filter((key) => key !== CACHE)
						.map((key) => caches.delete(key))
				);
			})
		])
	);
});

self.addEventListener('fetch', (event) => {
	// Не трогаем запросы на другие origin'ы (например, GitHub, docs.unavlab.com
	// вне /uWaveSuite/, CDN и т.д.) — пусть идут в сеть как обычно.
	const url = new URL(event.request.url);
	if (url.origin !== location.origin) {
		return;
	}
	
	// Навигационные запросы (открытие страницы) — отдаём index.html из кэша.
	// Это покрывает случай, когда лаунчер добавляет ?native=1 к URL.
	if (event.request.mode === 'navigate') {
		event.respondWith(
			caches.match('./index.html', { ignoreSearch: true }).then((cached) => {
				return cached || fetch(event.request);
			})
		);
		return;
	}
	
	// Остальные запросы — cache-first с игнором query string.
	// ignoreSearch: true позволяет найти в кэше ./app.js,
	// даже если запрос идёт как ./app.js?v=15 или ./app.js?native=1.
	event.respondWith(
		caches.match(event.request, { ignoreSearch: true }).then((cached) => {
			return cached || fetch(event.request);
		})
	);
});