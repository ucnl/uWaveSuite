// modules/ui-map.js — Карта uWaveSuite
// Отображение устройств, треков, антенны на canvas
// Поддержка декартовых и географических координат

const UIMap = (() => {

    // ========== СОСТОЯНИЕ ==========
    let canvas = null;
    let ctx = null;
    let container = null;
    
    // Параметры отображения
    let view = {
        scale: 100,             // пикселей на метр (в декартовом режиме)
        offsetX: 0,             // смещение X (пиксели)
        offsetY: 0,             // смещение Y (пиксели)
        centerX: 0,             // центр X (метры)
        centerY: 0,             // центр Y (метры)
        autoScale: true,
        followTarget: null,     // { type: 'antenna' | 'device', address? }
        showGrid: true,
        showAxes: true,
        showScale: true,
        showLabels: true
    };
    
    // Состояние перетаскивания
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    // Обработчики
    let listeners = [];

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(canvasId = 'map-canvas', containerId = 'map-container') {
        canvas = document.getElementById(canvasId);
        container = document.getElementById(containerId);
        
        if (!canvas || !container) {
            console.warn('[UIMap] Canvas or container not found');
            return;
        }
        
        ctx = canvas.getContext('2d');
        
        // Загружаем настройки
        loadViewSettings();
        
        // Инициализация обработчиков
        initEventHandlers();
        
        // Запускаем рендер
        requestAnimationFrame(renderLoop);
        
        // Подписка на изменения устройств
        subscribeToDeviceEvents();
    }

	function initEventHandlers() {
		// Resize
		window.addEventListener('resize', () => resizeCanvas());
		
		// Мышь
		canvas.addEventListener('wheel', (e) => {
			e.preventDefault();
			zoom(e.deltaY, e.clientX, e.clientY);
		});
		
		canvas.addEventListener('mousedown', (e) => {
			isDragging = true;
			lastMouseX = e.clientX;
			lastMouseY = e.clientY;
			canvas.style.cursor = 'grabbing';
		});
		
		canvas.addEventListener('mousemove', (e) => {
			if (isDragging) {
				const dx = e.clientX - lastMouseX;
				const dy = e.clientY - lastMouseY;
				view.offsetX += dx;
				view.offsetY += dy;
				lastMouseX = e.clientX;
				lastMouseY = e.clientY;
				
				if (view.followTarget) {
					view.followTarget = null;
					notifyListeners('followCleared');
				}
			}
			
			// Для линейки
			if (typeof UIRuler !== 'undefined' && UIRuler.isRulerActive && UIRuler.isRulerActive()) {
				UIRuler.handleMouseMove(e);
			}
		});
		
		canvas.addEventListener('mouseup', () => {
			isDragging = false;
			canvas.style.cursor = 'grab';
		});
		
		canvas.addEventListener('mouseleave', () => {
			isDragging = false;
			canvas.style.cursor = 'grab';
		});
		
		canvas.addEventListener('dblclick', () => {
			resetView();
		});
		
		canvas.addEventListener('click', (e) => {
			// Для линейки
			if (typeof UIRuler !== 'undefined' && UIRuler.isRulerActive && UIRuler.isRulerActive()) {
				UIRuler.handleClick(e);
				return;
			}
			
			// Обычный клик
			if (view.followTarget) {
				view.followTarget = null;
				notifyListeners('followCleared');
			}
		});
		
		// Тач
		initTouchHandlers();
	}

    function initTouchHandlers() {
        let initDist = 0;
        let initScale = 1;
        
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                isDragging = true;
                lastMouseX = e.touches[0].clientX;
                lastMouseY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                isDragging = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initDist = Math.sqrt(dx * dx + dy * dy);
                initScale = view.scale;
            }
        });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1 && isDragging) {
                const dx = e.touches[0].clientX - lastMouseX;
                const dy = e.touches[0].clientY - lastMouseY;
                view.offsetX += dx;
                view.offsetY += dy;
                lastMouseX = e.touches[0].clientX;
                lastMouseY = e.touches[0].clientY;
                
                if (view.followTarget) {
                    view.followTarget = null;
                    notifyListeners('followCleared');
                }
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (initDist > 0) {
                    const newScale = initScale * (dist / initDist);
                    setScale(newScale);
                    view.autoScale = false;
                }
            }
        });
        
        canvas.addEventListener('touchend', (e) => {
            isDragging = false;
        });
    }

    function subscribeToDeviceEvents() {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        deviceManager.addEventListener('deviceAdded', () => {
            if (view.autoScale && deviceManager.getAllDevices().length === 1) {
                autoScale();
            }
        });
        
        deviceManager.addEventListener('deviceUpdated', () => {
            // Обновляем слежение если нужно
            if (view.followTarget && view.followTarget.type === 'device') {
                const device = deviceManager.getDevice(view.followTarget.address, 'cdma');
                if (device && !isNaN(device.xM) && !isNaN(device.yM)) {
                    view.centerX = device.xM;
                    view.centerY = device.yM;
                }
            }
        });
    }

    // ========== НАСТРОЙКИ ВИДА ==========
    
    function loadViewSettings() {
        view.scale = UWSettingsStorage.get('display.scale', 100);
        view.autoScale = UWSettingsStorage.get('display.autoScale', true);
        view.showGrid = UWSettingsStorage.get('display.showGrid', true);
        view.showScale = UWSettingsStorage.get('display.showScale', true);
        view.showLabels = UWSettingsStorage.get('display.showLabels', true);
    }

    function saveViewSettings() {
        UWSettingsStorage.set('display.scale', view.scale);
        UWSettingsStorage.set('display.autoScale', view.autoScale);
        UWSettingsStorage.set('display.showGrid', view.showGrid);
        UWSettingsStorage.set('display.showScale', view.showScale);
        UWSettingsStorage.set('display.showLabels', view.showLabels);
    }

    // ========== УПРАВЛЕНИЕ ВИДОМ ==========
    
	function setScale(scale) {
		// Минимальный масштаб: 0.01 м/пиксель (1 см)
		// Максимальный масштаб: 10000 м/пиксель (10 км)
		if (scale < 0.01) scale = 0.01;
		if (scale > 1000) scale = 1000;
		view.scale = scale;
		view.autoScale = false;
		saveViewSettings();
	}

    function getScale() {
        return view.scale;
    }

    function zoom(deltaY, mouseX, mouseY) {
        const rect = canvas.getBoundingClientRect();
        const scaleFactor = deltaY > 0 ? 0.9 : 1.1;
        
        const oldScale = view.scale;
        const newScale = oldScale * scaleFactor;
        
        // Ограничиваем масштаб
        if (newScale < 0.1 || newScale > 1000) return;
        
        // Сохраняем точку под курсором
        const mouseCanvasX = mouseX - rect.left;
        const mouseCanvasY = mouseY - rect.top;
        
        const worldX = (mouseCanvasX - view.offsetX - rect.width / 2) / oldScale + view.centerX;
        const worldY = (view.centerY - (mouseCanvasY - view.offsetY - rect.height / 2) / oldScale);
        
        view.scale = newScale;
        view.autoScale = false;
        
        // Корректируем смещение
        view.offsetX = mouseCanvasX - rect.width / 2 - (worldX - view.centerX) * newScale;
        view.offsetY = mouseCanvasY - rect.height / 2 + (worldY - view.centerY) * newScale;
        
        saveViewSettings();
		
		if (typeof UIRuler !== 'undefined' && UIRuler.isRulerActive && UIRuler.isRulerActive()) {
			UIRuler.handleMouseMove({ clientX: mouseX, clientY: mouseY });
			}
    }

    function resetView() {
        view.scale = 100;
        view.offsetX = 0;
        view.offsetY = 0;
        view.centerX = 0;
        view.centerY = 0;
        view.autoScale = true;
        view.followTarget = null;
        
        saveViewSettings();
        notifyListeners('viewReset');
    }

    function autoScale() {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        const devices = deviceManager.getAllDevices();
        
        if (devices.length === 0) {
            view.scale = 100;
            view.centerX = 0;
            view.centerY = 0;
            return;
        }
        
        // Находим границы
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const device of devices) {
            if (!isNaN(device.xM)) {
                minX = Math.min(minX, device.xM);
                maxX = Math.max(maxX, device.xM);
            }
            if (!isNaN(device.yM)) {
                minY = Math.min(minY, device.yM);
                maxY = Math.max(maxY, device.yM);
            }
        }
        
        if (minX === Infinity || minY === Infinity) {
            view.scale = 100;
            view.centerX = 0;
            view.centerY = 0;
            return;
        }
        
        // Добавляем отступы
        const padding = 50;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / width;
        const scaleY = rect.height / height;
        
        view.scale = Math.min(scaleX, scaleY);
        view.centerX = (minX + maxX) / 2;
        view.centerY = (minY + maxY) / 2;
        
        view.autoScale = true;
        saveViewSettings();
    }

    function followDevice(address, type = 'cdma') {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        const device = deviceManager.getDevice(address, type);
        if (!device) return;
        
        if (!isNaN(device.xM) && !isNaN(device.yM)) {
            view.centerX = device.xM;
            view.centerY = device.yM;
            view.followTarget = { type: 'device', address, deviceType: type };
            notifyListeners('followStarted', { type: 'device', address });
        } else if (!isNaN(device.latitudeDeg) && !isNaN(device.longitudeDeg)) {
            // Географический режим — конвертируем в декартовы
            const antennaLat = UWSettingsStorage.get('antenna.latDeg', NaN);
            const antennaLon = UWSettingsStorage.get('antenna.lonDeg', NaN);
            
            if (!isNaN(antennaLat) && !isNaN(antennaLon)) {
                const deltas = GeoUtils.deltasByDegrees(
                    antennaLat, antennaLon,
                    device.latitudeDeg, device.longitudeDeg
                );
                
                view.centerX = deltas.deltaLonM;
                view.centerY = deltas.deltaLatM;
                view.followTarget = { type: 'device', address, deviceType: type };
                notifyListeners('followStarted', { type: 'device', address });
            }
        }
    }

    function followAntenna() {
        view.centerX = 0;
        view.centerY = 0;
        view.followTarget = { type: 'antenna' };
        notifyListeners('followStarted', { type: 'antenna' });
    }

    function clearFollow() {
        view.followTarget = null;
        notifyListeners('followCleared');
    }

    // ========== КОНВЕРТАЦИЯ КООРДИНАТ ==========
    
    function worldToScreen(worldX, worldY) {
        const rect = canvas.getBoundingClientRect();
        const screenX = (worldX - view.centerX) * view.scale + rect.width / 2 + view.offsetX;
        const screenY = (view.centerY - worldY) * view.scale + rect.height / 2 + view.offsetY;
        return { x: screenX, y: screenY };
    }

    function screenToWorld(screenX, screenY) {
        const rect = canvas.getBoundingClientRect();
        const worldX = (screenX - rect.width / 2 - view.offsetX) / view.scale + view.centerX;
        const worldY = view.centerY - (screenY - rect.height / 2 - view.offsetY) / view.scale;
        return { x: worldX, y: worldY };
    }

    // ========== ОТРИСОВКА ==========
    
    function renderLoop() {
        draw();
        requestAnimationFrame(renderLoop);
    }

	function draw() {
		if (!canvas || !ctx) return;
		
		resizeCanvas();
		
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		
		ctx.fillStyle = getComputedStyle(document.documentElement)
			.getPropertyValue('--bg-primary').trim() || '#1a1a2e';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		
		if (view.showGrid) drawGrid();
		if (view.showAxes) drawAxes();
		
		drawTracks();
		drawDevices();
		drawAntenna();
		drawPOI();
		
		// Линейка — рисуется поверх всего
		if (typeof UIRuler !== 'undefined' && UIRuler.draw) {
			UIRuler.draw();
		}
		
		if (view.showScale) drawScale();
		drawInfo();
	}
	
    function resizeCanvas() {
        if (!canvas || !container) return;
        
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawGrid() {
        const rect = canvas.getBoundingClientRect();
        const gridSize = getGridSize();
        
        // Вычисляем границы мира
        const topLeft = screenToWorld(0, 0);
        const bottomRight = screenToWorld(rect.width, rect.height);
        
        const startX = Math.floor(topLeft.x / gridSize) * gridSize;
        const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
        const startY = Math.floor(bottomRight.y / gridSize) * gridSize;
        const endY = Math.ceil(topLeft.y / gridSize) * gridSize;
        
        ctx.strokeStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--map-grid').trim() || 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        
        // Вертикальные линии
        for (let x = startX; x <= endX; x += gridSize) {
            const screen = worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(screen.x, 0);
            ctx.lineTo(screen.x, rect.height);
            ctx.stroke();
        }
        
        // Горизонтальные линии
        for (let y = startY; y <= endY; y += gridSize) {
            const screen = worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, screen.y);
            ctx.lineTo(rect.width, screen.y);
            ctx.stroke();
        }
    }

    function drawAxes() {
        const rect = canvas.getBoundingClientRect();
        
        // Ось X
        const xAxis = worldToScreen(0, 0);
        ctx.strokeStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--map-axis').trim() || 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, xAxis.y);
        ctx.lineTo(rect.width, xAxis.y);
        ctx.stroke();
        
        // Ось Y
        ctx.beginPath();
        ctx.moveTo(xAxis.x, 0);
        ctx.lineTo(xAxis.x, rect.height);
        ctx.stroke();
        
        // Подписи осей
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--map-text').trim() || '#ffffff';
        ctx.font = '10px monospace';
        ctx.fillText('X →', rect.width - 30, xAxis.y - 10);
        ctx.fillText('Y ↑', xAxis.x + 10, 20);
    }

	function drawDevices() {
		const deviceManager = getDeviceManager();
		if (!deviceManager) return;
		
		const devices = deviceManager.getAllDevices();
		const st = typeof UWUSBLsolver !== 'undefined' ? UWUSBLsolver.getState() : null;
		const antennaMode = st ? st.antennaMode : 'cartesian_fixed';
		
		// В географическом режиме нужны координаты антенны
		const antennaLat = UWSettingsStorage.get('antenna.latDeg', NaN);
		const antennaLon = UWSettingsStorage.get('antenna.lonDeg', NaN);
		const hasAntenna = !isNaN(antennaLat) && !isNaN(antennaLon);
		
		for (const device of devices) {
			let screenX, screenY;
			
			if (antennaMode === 'geographic') {
				// Географический режим — только lat/lon
				if (isNaN(device.latitudeDeg) || isNaN(device.longitudeDeg)) continue;
				if (!hasAntenna) continue;
				
				const deltas = GeoUtils.deltasByDegrees(
					antennaLat, antennaLon,
					device.latitudeDeg, device.longitudeDeg
				);
				
				const screen = worldToScreen(deltas.deltaLonM, deltas.deltaLatM);
				screenX = screen.x;
				screenY = screen.y;
			} else {
				// Декартов режим — только xM/yM
				if (isNaN(device.xM) || isNaN(device.yM)) continue;
				
				const screen = worldToScreen(device.xM, device.yM);
				screenX = screen.x;
				screenY = screen.y;
			}
			
			const rect = canvas.getBoundingClientRect();
			if (screenX < -20 || screenX > rect.width + 20 || screenY < -20 || screenY > rect.height + 20) {
				continue;
			}
			
			// Цвет: USBL — зелёный, обычное — синий
			const color = device.isUSBL ? '#00ff88' : '#4488ff';
			
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
			ctx.fill();
			
			// Подпись
			if (view.showLabels) {
				ctx.fillStyle = getComputedStyle(document.documentElement)
					.getPropertyValue('--map-text').trim() || '#ffffff';
				ctx.font = '10px monospace';
				ctx.fillText(`#${device.userAddress}`, screenX + 8, screenY - 8);
			}
			
			// ===== VLBL решение =====
			if (device.vlbl && !isNaN(device.vlbl.latDeg) && !isNaN(device.vlbl.lonDeg)) {
				let vlblScreenX, vlblScreenY;
				
				if (antennaMode === 'geographic') {
					// В географическом режиме тоже через deltas
					if (!hasAntenna) continue;
					
					const deltas = GeoUtils.deltasByDegrees(
						antennaLat, antennaLon,
						device.vlbl.latDeg, device.vlbl.lonDeg
					);
					
					const screen = worldToScreen(deltas.deltaLonM, deltas.deltaLatM);
					vlblScreenX = screen.x;
					vlblScreenY = screen.y;
				} else {
					// В декартовом режиме координаты VLBL в lat/lon — не показываем
					// (или считаем через антенну, если есть)
					continue;
				}
				
				// Квадратик оранжевый — VLBL решение
				ctx.fillStyle = '#ffaa00';
				ctx.fillRect(vlblScreenX - 4, vlblScreenY - 4, 8, 8);
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1;
				ctx.strokeRect(vlblScreenX - 4, vlblScreenY - 4, 8, 8);
				
				// Подпись
				if (view.showLabels) {
					ctx.fillStyle = '#ffaa00';
					ctx.font = '9px monospace';
					ctx.fillText(`VLBL #${device.userAddress}`, vlblScreenX + 6, vlblScreenY + 12);
				}
				
				// Радиальная ошибка
				if (!isNaN(device.vlbl.radialError) && device.vlbl.radialError > 0) {
					ctx.strokeStyle = 'rgba(255, 170, 0, 0.3)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.arc(vlblScreenX, vlblScreenY, device.vlbl.radialError * view.scale, 0, Math.PI * 2);
					ctx.stroke();
				}
			}
			
			// Таймаут
			if (device.isTimeout) {
				ctx.strokeStyle = getComputedStyle(document.documentElement)
					.getPropertyValue('--beacon-timeout-color').trim() || '#dc3545';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	}

	function drawTracks() {
		if (typeof Tracks === 'undefined' || !Tracks.getAll) return;
		
		const st = typeof UWUSBLsolver !== 'undefined' ? UWUSBLsolver.getState() : null;
		const antennaMode = st ? st.antennaMode : 'cartesian_fixed';
		
		const antennaLat = UWSettingsStorage.get('antenna.latDeg', NaN);
		const antennaLon = UWSettingsStorage.get('antenna.lonDeg', NaN);
		const hasAntenna = !isNaN(antennaLat) && !isNaN(antennaLon);
		
		const tracks = Tracks.getAll();
		
		for (const address in tracks) {
			const track = tracks[address];
			if (track.length < 2) continue;
			
			ctx.strokeStyle = '#4488ff';
			ctx.lineWidth = 1;
			ctx.beginPath();
			
			let started = false;
			
			for (const point of track) {
				let worldX, worldY;
				
				if (antennaMode === 'geographic') {
					if (isNaN(point.lat) || isNaN(point.lon) || !hasAntenna) continue;
					
					const deltas = GeoUtils.deltasByDegrees(
						antennaLat, antennaLon,
						point.lat, point.lon
					);
					
					worldX = deltas.deltaLonM;
					worldY = deltas.deltaLatM;
				} else {
					if (isNaN(point.xM) || isNaN(point.yM)) continue;
					worldX = point.xM;
					worldY = point.yM;
				}
				
				const screen = worldToScreen(worldX, worldY);
				
				if (!started) {
					ctx.moveTo(screen.x, screen.y);
					started = true;
				} else {
					ctx.lineTo(screen.x, screen.y);
				}
			}
			
			if (started) {
				ctx.stroke();
			}
		}
	}

	function drawAntenna() {
		const st = typeof UWUSBLsolver !== 'undefined' ? UWUSBLsolver.getState() : null;
		const antennaMode = st ? st.antennaMode : 'cartesian_fixed';
		
		let screenX, screenY;
		
		if (antennaMode === 'geographic') {
			// В географическом режиме антенна в центре вида
			const rect = canvas.getBoundingClientRect();
			screenX = rect.width / 2;
			screenY = rect.height / 2;
		} else {
			// Декартов — антенна в (0,0)
			const screen = worldToScreen(0, 0);
			screenX = screen.x;
			screenY = screen.y;
		}
		
		const rect = canvas.getBoundingClientRect();
		if (screenX < -20 || screenX > rect.width + 20 || screenY < -20 || screenY > rect.height + 20) {
			return;
		}
		
		// Антенна
		ctx.fillStyle = '#ff4444';
		ctx.beginPath();
		ctx.arc(screenX, screenY, 7, 0, Math.PI * 2);
		ctx.fill();
		
		// Направление
		const heading = UWSettingsStorage.get('antenna.headingDeg', 0);
		const rad = heading * Math.PI / 180;
		const len = 30;
		
		ctx.strokeStyle = '#ff4444';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(screenX, screenY);
		ctx.lineTo(
			screenX + len * Math.sin(rad),
			screenY - len * Math.cos(rad)
		);
		ctx.stroke();
		
		// Подпись
		if (view.showLabels) {
			ctx.fillStyle = '#ff4444';
			ctx.font = '10px monospace';
			ctx.fillText('ANT', screenX + 10, screenY - 10);
		}
	}
	
	function drawPOI() {
		if (typeof POIManager === 'undefined' || !POIManager.getAll) return;
		
		const pois = POIManager.getAll();
		if (pois.length === 0) return;
		
		const st = typeof UWUSBLsolver !== 'undefined' ? UWUSBLsolver.getState() : null;
		const antennaMode = st ? st.antennaMode : 'cartesian_fixed';
		
		const antennaLat = UWSettingsStorage.get('antenna.latDeg', NaN);
		const antennaLon = UWSettingsStorage.get('antenna.lonDeg', NaN);
		const hasAntenna = !isNaN(antennaLat) && !isNaN(antennaLon);
		
		const rect = canvas.getBoundingClientRect();
		
		for (const poi of pois) {
			let screenX, screenY;
			
			// POI хранятся в географических координатах (lat/lon).
			// Для отображения нужны координаты антенны — они есть только
			// если выполнена топопривязка (или пришли из GNSS).
			if (isNaN(poi.lat) || isNaN(poi.lon)) continue;
			if (!hasAntenna) continue;
			
			const deltas = GeoUtils.deltasByDegrees(
				antennaLat, antennaLon,
				poi.lat, poi.lon
			);
			
			const screen = worldToScreen(deltas.deltaLonM, deltas.deltaLatM);
			screenX = screen.x;
			screenY = screen.y;
			
			if (screenX < -20 || screenX > rect.width + 20 ||
				screenY < -20 || screenY > rect.height + 20) {
				continue;
			}
			
			// Цвет: marked — яркий, loaded — тусклый
			const poiColor = poi.type === 'marked'
				? (getComputedStyle(document.documentElement)
					.getPropertyValue('--poi-marked-color').trim() || '#ffcc00')
				: (getComputedStyle(document.documentElement)
					.getPropertyValue('--poi-loaded-color').trim() || '#ff6600');
			
			// Точка
			ctx.fillStyle = poiColor;
			ctx.beginPath();
			ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
			ctx.fill();
			
			// Обводка
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 1;
			ctx.stroke();
			
			// Подпись
			if (view.showLabels && poi.name) {
				ctx.fillStyle = poiColor;
				ctx.font = '10px monospace';
				ctx.fillText(poi.name, screenX + 8, screenY - 8);
			}
		}
	}

	function drawScale() {
		const rect = canvas.getBoundingClientRect();
		
		// Максимальная длина шкалы — 200 пикселей
		const maxScalePixels = 200;
		const targetPixels = 100;
		
		// Вычисляем метры для шкалы
		let scaleMeters = targetPixels / view.scale;
		
		// Округляем до красивого числа
		const power = Math.pow(10, Math.floor(Math.log10(scaleMeters)));
		const normalized = scaleMeters / power;
		
		if (normalized < 1.5) scaleMeters = 1 * power;
		else if (normalized < 3.5) scaleMeters = 2 * power;
		else if (normalized < 7.5) scaleMeters = 5 * power;
		else scaleMeters = 10 * power;
		
		// Минимальная шкала — 1 метр
		if (scaleMeters < 1) scaleMeters = 1;
		
		let scalePixels = scaleMeters * view.scale;
		
		// Если шкала слишком длинная — уменьшаем
		while (scalePixels > maxScalePixels) {
			scaleMeters /= 2;
			scalePixels = scaleMeters * view.scale;
		}
		
		// Позиция шкалы
		const margin = 20;
		const x1 = rect.width - margin - scalePixels;
		const x2 = rect.width - margin;
		const y = rect.height - margin;
		
		// Рисуем линию
		ctx.strokeStyle = getComputedStyle(document.documentElement)
			.getPropertyValue('--scale-color').trim() || '#fff';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x1, y);
		ctx.lineTo(x2, y);
		ctx.stroke();
		
		// Концы
		ctx.beginPath();
		ctx.moveTo(x1, y - 5);
		ctx.lineTo(x1, y + 5);
		ctx.stroke();
		
		ctx.beginPath();
		ctx.moveTo(x2, y - 5);
		ctx.lineTo(x2, y + 5);
		ctx.stroke();
		
		// Подпись
		ctx.fillStyle = getComputedStyle(document.documentElement)
			.getPropertyValue('--scale-color').trim() || '#fff';
		ctx.font = '11px monospace';
		ctx.textAlign = 'center';
		ctx.fillText(`${scaleMeters} м`, (x1 + x2) / 2, y - 8);
		ctx.textAlign = 'left';
		
		// Очищаем DOM шкалу
		const scaleEl = document.getElementById('scale-bar');
		if (scaleEl) {
			scaleEl.textContent = '';
		}
	}

    function drawInfo() {
        const rect = canvas.getBoundingClientRect();
        
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--map-text-secondary').trim() || 'rgba(255,255,255,0.8)';
        ctx.font = '10px monospace';
        
        // Масштаб
        ctx.fillText(`Масштаб: 1:${Math.round(view.scale * 100)}`, 10, rect.height - 10);
        
        // Слежение
        if (view.followTarget) {
            const targetText = view.followTarget.type === 'antenna' 
                ? 'Слежение: Антенна' 
                : `Слежение: #${view.followTarget.address}`;
            ctx.fillText(targetText, 10, rect.height - 25);
        }
    }

	function getGridSize() {
		const targetPixels = 50;
		const metersPerPixel = 1 / view.scale;
		const targetMeters = targetPixels * metersPerPixel;
		
		// Округляем до 1-2-5
		const power = Math.pow(10, Math.floor(Math.log10(targetMeters)));
		const normalized = targetMeters / power;
		
		let gridSize;
		if (normalized < 1.5) gridSize = 1;
		else if (normalized < 3.5) gridSize = 2;
		else if (normalized < 7.5) gridSize = 5;
		else gridSize = 10;
		
		gridSize = gridSize * power;
		
		// Минимальный размер сетки — 1 мм? Нет, минимум 1 метр для шкалы
		// Но для сетки можно меньше
		return gridSize;
	}

    // ========== ПОЛУЧЕНИЕ ЗАВИСИМОСТЕЙ ==========
    
    function getDeviceManager() {
        if (window.UWApp && window.UWApp.getDeviceManager) {
            return window.UWApp.getDeviceManager();
        }
        return null;
    }

    // ========== ПОДПИСКА ==========
    
    function subscribe(listener) {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }

    function notifyListeners(event, data = {}) {
        for (const listener of listeners) {
            try {
                listener(event, data);
            } catch (e) {
                console.warn('[UIMap] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        setScale,
        getScale,
        zoom,
        resetView,
        autoScale,
        followDevice,
        followAntenna,
        clearFollow,
        worldToScreen,
        screenToWorld,
		draw,
        getView: () => view,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIMap;
}