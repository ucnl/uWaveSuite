// modules/ui-topo.js — Топопривязка для uWaveSuite
// Адаптировано из AzimuthWebSuite

const UITopo = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    let isGnssConnected = false;
    
    // Компас (для внутреннего GPS телефона)
    let compassActive = false;
    let compassValues = [];
    let compassUpdateTimer = null;
    let compassStabilityTimer = null;

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'topo-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UITopo] Panel not found');
            return;
        }
        
        initEventHandlers();
        loadTopoBinding();
    }
    
    function initEventHandlers() {
        // Кнопки в HTML вызывают методы напрямую
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function toggle() {
        if (isOpen) close();
        else open();
    }
    
    function open() {
        if (!panel) return;
        
        panel.classList.add('visible');
        panel.style.display = 'block';
        isOpen = true;
        
        updateGNSSStatus();
        updateFieldsFromSolver();  // ← заполняем текущими значениями из solver
        
        notifyListeners('open');
    }
    
    function close() {
        if (!panel) return;
        
        panel.classList.remove('visible');
        panel.style.display = 'none';
        isOpen = false;
        
        stopCompassUpdates();
        
        notifyListeners('close');
    }
    
    function isPanelOpen() {
        return isOpen;
    }

    // ========== GNSS ==========
    
    function setGnssConnected(connected) {
        isGnssConnected = connected;
        if (isOpen) updateGNSSStatus();
    }
    
    function updateGNSSStatus() {
        const statusEl = document.getElementById('topo-gnss-status');
        if (!statusEl) return;
        
        if (isGnssConnected) {
            statusEl.textContent = '✓ Внешний GNSS подключен';
            statusEl.className = 'locked';
        } else {
            statusEl.textContent = 'Внешний GNSS не подключен';
            statusEl.className = '';
        }
    }

    // ========== КОМПАС (внутренний GPS телефона) ==========
    
    function startCompassUpdates() {
        if (compassActive) return;
        
        compassActive = true;
        compassValues = [];
        
        // Запускаем нативный компас через iframe
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://start_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
        
        // Слушаем обновления
        window.addEventListener('native-compass-update', handleCompassUpdate);
        
        compassUpdateTimer = setInterval(updateCompassUI, 500);
        compassStabilityTimer = setInterval(checkCompassStability, 2000);
    }
    
    function handleCompassUpdate() {
        if (!compassActive) return;
        
        const heading = window._nativeCompass?.heading;
        if (heading !== undefined && !isNaN(heading)) {
            compassValues.push({
                heading: heading,
                timestamp: Date.now()
            });
            
            if (compassValues.length > 20) compassValues.shift();
        }
    }
    
    function updateCompassUI() {
        if (!compassActive || !isOpen) return;
        
        const heading = window._nativeCompass?.heading;
        const hdgEl = document.getElementById('topo-hdg');
        const statusEl = document.getElementById('topo-gnss-status');
        
        if (heading !== undefined && !isNaN(heading) && hdgEl) {
            hdgEl.value = heading.toFixed(1);
            
            if (statusEl) {
                const stability = getCompassStability();
                const icon = stability === 'stable' ? '✅' : 
                             stability === 'medium' ? '⚠️' : '🔄';
                const text = stability === 'stable' ? 'Стабильно' : 
                             stability === 'medium' ? 'Нестабильно' : 'Измерение...';
                
                statusEl.innerHTML = `
                    🧭 Азимут: ${heading.toFixed(1)}° ${icon} ${text}<br>
                    <small style="font-size:10px;">
                        📱 Держите устройство горизонтально<br>
                        ➡️ Сориентируйте по нулевому направлению антенны
                    </small>
                `;
                statusEl.className = 'locked';
            }
        }
    }
    
    function getCompassStability() {
        if (compassValues.length < 5) return 'measuring';
        
        const recent = compassValues.slice(-5);
        const headings = recent.map(v => v.heading);
        
        let maxDiff = 0;
        for (let i = 0; i < headings.length; i++) {
            for (let j = i + 1; j < headings.length; j++) {
                let diff = Math.abs(headings[i] - headings[j]);
                if (diff > 180) diff = 360 - diff;
                maxDiff = Math.max(maxDiff, diff);
            }
        }
        
        if (maxDiff < 2) return 'stable';
        if (maxDiff < 5) return 'medium';
        return 'unstable';
    }
    
    function checkCompassStability() {
        if (!compassActive || !isOpen) return;
        
        const stability = getCompassStability();
        const statusEl = document.getElementById('topo-gnss-status');
        
        if (statusEl && stability === 'stable') {
            const heading = window._nativeCompass?.heading;
            if (heading !== undefined && !isNaN(heading)) {
                statusEl.innerHTML = `
                    ✅ Азимут стабилен: ${heading.toFixed(1)}°<br>
                    <small style="font-size:10px;">Можно применять топопривязку</small>
                `;
                statusEl.className = 'locked';
            }
        }
    }
    
    function stopCompassUpdates() {
        if (!compassActive) return;
        
        compassActive = false;
        
        window.removeEventListener('native-compass-update', handleCompassUpdate);
        
        if (compassUpdateTimer) {
            clearInterval(compassUpdateTimer);
            compassUpdateTimer = null;
        }
        if (compassStabilityTimer) {
            clearInterval(compassStabilityTimer);
            compassStabilityTimer = null;
        }
        
        // Останавливаем нативный компас
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'app://stop_compass';
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 100);
    }

    // ========== ОБНОВЛЕНИЕ ПОЛЕЙ ==========
    
    /**
     * Обновление полей из внешнего GNSS в реальном времени
     */
    function updateFieldsFromGNSS(lat, lon, heading) {
        if (!isOpen) return;
        
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hdgEl = document.getElementById('topo-hdg');
        
        if (latEl && !isNaN(lat)) latEl.value = lat.toFixed(8);
        if (lonEl && !isNaN(lon)) lonEl.value = lon.toFixed(8);
        if (hdgEl && !isNaN(heading)) hdgEl.value = heading.toFixed(1);
    }
    
    /**
     * Заполнение полей из UWUSBLsolver (при открытии панели)
     */
    function updateFieldsFromSolver() {
        if (typeof UWUSBLsolver === 'undefined') return;
        
        const st = UWUSBLsolver.getState();
        
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hdgEl = document.getElementById('topo-hdg');
        
        if (latEl && !isNaN(st.antennaLatDeg)) latEl.value = st.antennaLatDeg.toFixed(8);
        if (lonEl && !isNaN(st.antennaLonDeg)) lonEl.value = st.antennaLonDeg.toFixed(8);
        if (hdgEl && !isNaN(st.antennaHeadingDeg)) hdgEl.value = st.antennaHeadingDeg.toFixed(1);
    }

    // ========== ПРИМЕНЕНИЕ ==========
    
    function applyBinding() {
        if (!panel) return;
        
        const lat = parseFloat(document.getElementById('topo-lat')?.value);
        const lon = parseFloat(document.getElementById('topo-lon')?.value);
        const heading = parseFloat(document.getElementById('topo-hdg')?.value || 0);
        
        if (isNaN(lat) || isNaN(lon)) {
            alert('Введите корректные координаты');
            return;
        }
        
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            alert('Некорректные координаты');
            return;
        }
        
        if (heading < 0 || heading > 360) {
            alert('Курс должен быть 0-360°');
            return;
        }
        
        // Сохраняем
        const binding = { lat, lon, hdg: heading };
        localStorage.setItem('uwave_topo_binding', JSON.stringify(binding));
        
        // Применяем
        UWSettingsStorage.set('antenna.latDeg', lat);
        UWSettingsStorage.set('antenna.lonDeg', lon);
        UWSettingsStorage.set('antenna.headingDeg', heading);
        UWSettingsStorage.set('antenna.mode', 'geographic');
        UWSettingsStorage.save();
        
        if (typeof UWUSBLsolver !== 'undefined') {
            UWUSBLsolver.setAntennaPosition(lat, lon, heading);
            UWUSBLsolver.setAntennaMode('geographic');
        }
        
        // Обновляем UI антенны
		if (window.UWApp && UWApp.updateAntennaInfo) {
			UWApp.updateAntennaInfo();
		}

		// Обновляем настройки (галочка выбора режима)
		if (typeof UISettings !== 'undefined' && UISettings.updateFieldsFromSettings) {
			UISettings.updateFieldsFromSettings();
		}

		// Обновляем устройства (карточки)
		if (window.UWApp && UWApp.updateDevicesBar) {
			UWApp.updateDevicesBar();
		}

		// Перерисовываем карту
		if (typeof UIMap !== 'undefined' && UIMap.draw) {
			UIMap.draw();
		}
        
        notifyListeners('applied', binding);
        
        stopCompassUpdates();
        close();
    }
    
    function clearBinding() {
        localStorage.removeItem('uwave_topo_binding');
        
        UWSettingsStorage.set('antenna.latDeg', NaN);
        UWSettingsStorage.set('antenna.lonDeg', NaN);
        UWSettingsStorage.set('antenna.headingDeg', 0);
        UWSettingsStorage.set('antenna.mode', 'cartesian_fixed');
        UWSettingsStorage.save();
        
        if (typeof UWUSBLsolver !== 'undefined') {
            UWUSBLsolver.setAntennaPosition(NaN, NaN, 0);
            UWUSBLsolver.setAntennaMode('cartesian_fixed');
        }
        
        // Очищаем поля
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        const hdgEl = document.getElementById('topo-hdg');
        
        if (latEl) latEl.value = '';
        if (lonEl) lonEl.value = '';
        if (hdgEl) hdgEl.value = '0';
        
        // Обновляем UI
		if (window.UWApp && UWApp.updateAntennaInfo) {
			UWApp.updateAntennaInfo();
		}

		// Обновляем настройки (галочка выбора режима)
		if (typeof UISettings !== 'undefined' && UISettings.updateFieldsFromSettings) {
			UISettings.updateFieldsFromSettings();
		}

		// Обновляем устройства (карточки)
		if (window.UWApp && UWApp.updateDevicesBar) {
			UWApp.updateDevicesBar();
		}

		// Перерисовываем карту
		if (typeof UIMap !== 'undefined' && UIMap.draw) {
			UIMap.draw();
		}
        
        notifyListeners('cleared');
        stopCompassUpdates();
        close();
    }

    // ========== ЗАГРУЗКА ==========
    
    function loadTopoBinding() {
        try {
            const saved = localStorage.getItem('uwave_topo_binding');
            if (saved) {
                const data = JSON.parse(saved);
                
                if (!isNaN(data.lat) && !isNaN(data.lon)) {
                    UWSettingsStorage.set('antenna.latDeg', data.lat);
                    UWSettingsStorage.set('antenna.lonDeg', data.lon);
                    UWSettingsStorage.set('antenna.headingDeg', data.hdg || 0);
                    UWSettingsStorage.set('antenna.mode', 'geographic');
                    
                    if (typeof UWUSBLsolver !== 'undefined') {
                        UWUSBLsolver.setAntennaPosition(data.lat, data.lon, data.hdg || 0);
                        UWUSBLsolver.setAntennaMode('geographic');
                    }
                }
            }
        } catch (e) {
            console.warn('[UITopo] Ошибка загрузки:', e.message);
        }
    }

    // ========== GPS ТЕЛЕФОНА ==========
    
    function getPhoneGPS() {
        if (!navigator.geolocation) {
            alert('Геолокация не поддерживается');
            return;
        }
        
        const statusEl = document.getElementById('topo-gnss-status');
        if (statusEl) {
            statusEl.textContent = 'Поиск GPS...';
            statusEl.className = '';
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                
                const latEl = document.getElementById('topo-lat');
                const lonEl = document.getElementById('topo-lon');
                
                if (latEl) latEl.value = lat.toFixed(8);
                if (lonEl) lonEl.value = lon.toFixed(8);
                
                if (statusEl) {
                    statusEl.innerHTML = `✓ Координаты получены<br><small>Запуск компаса...</small>`;
                    statusEl.className = 'locked';
                }
                
                // Запускаем компас
                startCompassUpdates();
                
                notifyListeners('phoneGPS', { lat, lon });
            },
            (error) => {
                if (statusEl) {
                    statusEl.textContent = 'Ошибка GPS: ' + error.message;
                    statusEl.className = '';
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );
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
                console.warn('[UITopo] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        toggle,
        open,
        close,
        isPanelOpen,
        setGnssConnected,
        updateFieldsFromGNSS,
        applyBinding,
        clearBinding,
        loadTopoBinding,
        getPhoneGPS,
        subscribe
    };
    
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITopo;
}