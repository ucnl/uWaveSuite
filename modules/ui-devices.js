// modules/ui-devices.js — Панель устройств uWaveSuite
// Отображение дерева устройств, статусов, данных

const UIDevices = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // Фильтры
    let filters = {
        showUSBL: true,
        showNonUSBL: true,
        showTimeout: true,
        showActive: true,
        searchQuery: ''
    };
    
    // Сортировка
    let sortBy = 'address';     // 'address' | 'range' | 'azimuth' | 'age'
    let sortOrder = 'asc';      // 'asc' | 'desc'

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'devices-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIDevices] Panel not found');
            return;
        }
        
        initEventHandlers();
        
        // Подписка на обновления устройств
        const deviceManager = getDeviceManager();
        if (deviceManager) {
            deviceManager.addEventListener('deviceAdded', () => updateDeviceList());
            deviceManager.addEventListener('deviceUpdated', () => updateDeviceList());
            deviceManager.addEventListener('deviceRemoved', () => updateDeviceList());
            deviceManager.addEventListener('deviceTimeout', () => updateDeviceList());
        }
    }

    function initEventHandlers() {
        // Кнопки
        const btnRefresh = panel.querySelector('#devices-btn-refresh');
        const btnClear = panel.querySelector('#devices-btn-clear');
        const btnExport = panel.querySelector('#devices-btn-export');
        
        if (btnRefresh) btnRefresh.addEventListener('click', () => updateDeviceList());
        if (btnClear) btnClear.addEventListener('click', () => clearAllDevices());
        if (btnExport) btnExport.addEventListener('click', () => exportDevices());
        
        // Поиск
        const searchInput = panel.querySelector('#devices-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                filters.searchQuery = searchInput.value.toLowerCase();
                updateDeviceList();
            });
        }
        
        // Фильтры
        const filterCheckboxes = panel.querySelectorAll('.devices-filter-checkbox');
        filterCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateFiltersFromUI();
                updateDeviceList();
            });
        });
        
        // Сортировка
        const sortSelect = panel.querySelector('#devices-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                sortBy = sortSelect.value;
                updateDeviceList();
            });
        }
        
        const sortOrderBtn = panel.querySelector('#devices-sort-order');
        if (sortOrderBtn) {
            sortOrderBtn.addEventListener('click', () => {
                sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
                sortOrderBtn.textContent = sortOrder === 'asc' ? '↑' : '↓';
                updateDeviceList();
            });
        }
    }

    function updateFiltersFromUI() {
        if (!panel) return;
        
        filters.showUSBL = panel.querySelector('#devices-filter-usbl')?.checked ?? true;
        filters.showNonUSBL = panel.querySelector('#devices-filter-nonusbl')?.checked ?? true;
        filters.showTimeout = panel.querySelector('#devices-filter-timeout')?.checked ?? true;
        filters.showActive = panel.querySelector('#devices-filter-active')?.checked ?? true;
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'block';
        isOpen = true;
        
        updateDeviceList();
        
        notifyListeners('open');
    }

    function close() {
        if (!panel) return;
        
        panel.style.display = 'none';
        isOpen = false;
        
        notifyListeners('close');
    }

    function toggle() {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }

    // ========== ОБНОВЛЕНИЕ СПИСКА ==========
    
    function updateDeviceList() {
        if (!panel) return;
        
        const listEl = panel.querySelector('#devices-list');
        if (!listEl) return;
        
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        let devices = deviceManager.getAllDevices();
        
        // Применяем фильтры
        devices = devices.filter(device => {
            // Поиск
            if (filters.searchQuery) {
                const searchable = `${device.address} ${device.userAddress} ${device.name || ''}`.toLowerCase();
                if (!searchable.includes(filters.searchQuery)) return false;
            }
            
            // USBL/Non-USBL
            if (device.isUSBL && !filters.showUSBL) return false;
            if (!device.isUSBL && !filters.showNonUSBL) return false;
            
            // Timeout/Active
            if (device.isTimeout && !filters.showTimeout) return false;
            if (!device.isTimeout && !filters.showActive) return false;
            
            return true;
        });
        
        // Сортировка
        devices.sort((a, b) => {
            let comparison = 0;
            
            switch (sortBy) {
                case 'address':
                    comparison = a.address - b.address;
                    break;
                case 'range':
                    const rangeA = !isNaN(a.absoluteDistanceM) ? a.absoluteDistanceM : Infinity;
                    const rangeB = !isNaN(b.absoluteDistanceM) ? b.absoluteDistanceM : Infinity;
                    comparison = rangeA - rangeB;
                    break;
                case 'azimuth':
                    const azmA = !isNaN(a.azimuthDeg) ? a.azimuthDeg : Infinity;
                    const azmB = !isNaN(b.azimuthDeg) ? b.azimuthDeg : Infinity;
                    comparison = azmA - azmB;
                    break;
                case 'age':
                    comparison = a.dataAge - b.dataAge;
                    break;
            }
            
            return sortOrder === 'asc' ? comparison : -comparison;
        });
        
        // Обновляем статистику
        updateStats(devices, deviceManager);
        
        // Рендерим список
        if (devices.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Нет устройств</div>';
            return;
        }
        
        listEl.innerHTML = devices.map(device => {
            return createDeviceCard(device);
        }).join('');
        
        // Добавляем обработчики кликов
        listEl.querySelectorAll('.device-item').forEach(item => {
            item.addEventListener('click', () => {
                const address = parseInt(item.dataset.address);
                const type = item.dataset.type;
                onDeviceClick(address, type);
            });
        });
    }

    function createDeviceCard(device) {
        const ageClass = device.dataAge > 20 ? 'stale' : device.dataAge > 10 ? 'old' : 'fresh';
        const statusClass = device.isTimeout ? 'timeout' : 'active';
        
        const range = !isNaN(device.absoluteDistanceM) 
            ? device.absoluteDistanceM.toFixed(1) + ' м'
            : !isNaN(device.slantRangeM) 
                ? device.slantRangeM.toFixed(1) + ' м'
                : '--';
        
        const azimuth = !isNaN(device.azimuthDeg) 
            ? device.azimuthDeg.toFixed(1) + '°'
            : '--';
        
        const depth = !isNaN(device.depthM) 
            ? device.depthM.toFixed(1) + ' м'
            : '--';
        
        const msr = !isNaN(device.msrDB) 
            ? device.msrDB.toFixed(1) + ' dB'
            : '--';
        
        const temperature = !isNaN(device.temperatureC) 
            ? device.temperatureC.toFixed(1) + ' °C'
            : '--';
        
        const voltage = !isNaN(device.voltageV) 
            ? device.voltageV.toFixed(1) + ' V'
            : '--';
        
        const coords = !isNaN(device.latitudeDeg) && !isNaN(device.longitudeDeg)
            ? `${device.latitudeDeg.toFixed(6)}, ${device.longitudeDeg.toFixed(6)}`
            : '--';
        
        return `
            <div class="device-item ${statusClass}" data-address="${device.address}" data-type="${device.type}">
                <div class="device-item-header">
                    <span class="device-item-addr">#${device.userAddress}</span>
                    ${device.isUSBL ? '<span class="device-item-usbl">📡 USBL</span>' : '<span class="device-item-type">📻 Обычный</span>'}
                    <span class="device-item-age ${ageClass}">${device.dataAge}с</span>
                </div>
                <div class="device-item-body">
                    <div class="device-item-row">
                        <span>Дальность:</span>
                        <span>${range}</span>
                    </div>
                    <div class="device-item-row">
                        <span>Азимут:</span>
                        <span>${azimuth}</span>
                    </div>
                    <div class="device-item-row">
                        <span>Глубина:</span>
                        <span>${depth}</span>
                    </div>
                    <div class="device-item-row">
                        <span>MSR:</span>
                        <span>${msr}</span>
                    </div>
                    <div class="device-item-row">
                        <span>Температура:</span>
                        <span>${temperature}</span>
                    </div>
                    <div class="device-item-row">
                        <span>Напряжение:</span>
                        <span>${voltage}</span>
                    </div>
                    <div class="device-item-row">
                        <span>Координаты:</span>
                        <span class="device-item-coords">${coords}</span>
                    </div>
                </div>
                <div class="device-item-footer">
                    <span>Запросов: ${device.succeededRequests}/${device.succeededRequests + device.failedRequests}</span>
                    <span>Таймаутов: ${device.timeouts}</span>
                </div>
            </div>
        `;
    }

    function updateStats(devices, deviceManager) {
        if (!panel) return;
        
        const statsEl = panel.querySelector('#devices-stats');
        if (!statsEl) return;
        
        const total = deviceManager.getAllDevices().length;
        const usbl = deviceManager.getUSBLDevices().length;
        const nonUSBL = deviceManager.getNonUSBLDevices().length;
        
        statsEl.innerHTML = `
            <span>Всего: ${total}</span>
            <span>USBL: ${usbl}</span>
            <span>Обычных: ${nonUSBL}</span>
            <span>Показано: ${devices.length}</span>
        `;
    }

    // ========== ДЕЙСТВИЯ ==========
    
    function onDeviceClick(address, type) {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        const device = deviceManager.getDevice(address, type);
        if (!device) return;
        
        // Центрируем карту на устройстве
        if (window.UWApp && window.UWApp.focusDevice) {
            window.UWApp.focusDevice(device);
        }
        
        notifyListeners('deviceSelected', device);
    }

    function clearAllDevices() {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        const count = deviceManager.getAllDevices().length;
        
        if (count === 0) return;
        
        if (!confirm(`Удалить все устройства (${count})?`)) return;
        
        deviceManager.clearAll();
        updateDeviceList();
        
        notifyListeners('devicesCleared');
    }

    function exportDevices() {
        const deviceManager = getDeviceManager();
        if (!deviceManager) return;
        
        const devices = deviceManager.getAllDevices();
        
        if (devices.length === 0) return;
        
        const data = {
            type: 'uwave_devices',
            timestamp: new Date().toISOString(),
            devices: devices.map(d => ({
                address: d.address,
                type: d.type,
                userAddress: d.userAddress,
                isUSBL: d.isUSBL,
                slantRangeM: d.slantRangeM,
                azimuthDeg: d.azimuthDeg,
                depthM: d.depthM,
                latitudeDeg: d.latitudeDeg,
                longitudeDeg: d.longitudeDeg,
                temperatureC: d.temperatureC,
                voltageV: d.voltageV,
                msrDB: d.msrDB,
                succeededRequests: d.succeededRequests,
                failedRequests: d.failedRequests,
                timeouts: d.timeouts
            }))
        };
        
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `uwave_devices_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                console.warn('[UIDevices] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        updateDeviceList,
        clearAllDevices,
        exportDevices,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIDevices;
}