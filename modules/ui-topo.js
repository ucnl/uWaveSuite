// modules/ui-topo.js — Топопривязка для uWaveSuite
// Адаптировано из AzimuthWebSuite

const UITopo = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    let gnssConnected = false;
    
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
        if (isOpen) {
            close();
        } else {
            open();
        }
    }
    
    function open() {
        if (!panel) return;
        
        panel.classList.add('visible');
        panel.style.display = 'block';
        isOpen = true;
        
        notifyListeners('open');
    }
    
    function close() {
        if (!panel) return;
        
        panel.classList.remove('visible');
        panel.style.display = 'none';
        isOpen = false;
        
        notifyListeners('close');
    }
    
    function isPanelOpen() {
        return isOpen;
    }
    
    // ========== GNSS ==========
    
    function setGnssConnected(connected) {
        gnssConnected = connected;
        
        const statusEl = document.getElementById('topo-gnss-status');
        if (statusEl) {
            statusEl.textContent = connected ? '✓ Внешний GNSS подключен' : 'Внешний GNSS не подключен';
            statusEl.className = connected ? 'locked' : '';
        }
    }
    
    function updateFieldsFromGNSS(lat, lon, heading) {
        const latEl = document.getElementById('topo-lat');
        const lonEl = document.getElementById('topo-lon');
        
        if (latEl && !isNaN(lat)) latEl.value = lat.toFixed(8);
        if (lonEl && !isNaN(lon)) lonEl.value = lon.toFixed(8);
        
        if (heading !== undefined && !isNaN(heading)) {
            const hdgEl = document.getElementById('topo-hdg');
            if (hdgEl) hdgEl.value = heading.toFixed(1);
        }
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
        
        // Обновляем UI
        if (window.UWApp && UWApp.updateAntennaInfo) {
            UWApp.updateAntennaInfo();
        }
        
        notifyListeners('applied', binding);
        
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
        
        notifyListeners('cleared');
        
        close();
    }
    
    // ========== ЗАГРУЗКА ==========
    
    function loadTopoBinding() {
        try {
            const saved = localStorage.getItem('uwave_topo_binding');
            if (saved) {
                const data = JSON.parse(saved);
                
                const latEl = document.getElementById('topo-lat');
                const lonEl = document.getElementById('topo-lon');
                const hdgEl = document.getElementById('topo-hdg');
                
                if (latEl && !isNaN(data.lat)) latEl.value = data.lat.toFixed(8);
                if (lonEl && !isNaN(data.lon)) lonEl.value = data.lon.toFixed(8);
                if (hdgEl && !isNaN(data.hdg)) hdgEl.value = data.hdg.toFixed(1);
                
                // Применяем
                if (!isNaN(data.lat) && !isNaN(data.lon)) {
                    UWSettingsStorage.set('antenna.latDeg', data.lat);
                    UWSettingsStorage.set('antenna.lonDeg', data.lon);
                    UWSettingsStorage.set('antenna.headingDeg', data.hdg || 0);
                    
                    if (typeof UWUSBLsolver !== 'undefined') {
                        UWUSBLsolver.setAntennaPosition(data.lat, data.lon, data.hdg || 0);
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
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                
                updateFieldsFromGNSS(lat, lon, null);
                
                notifyListeners('phoneGPS', { lat, lon });
            },
            (error) => {
                alert('Ошибка GPS: ' + error.message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
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