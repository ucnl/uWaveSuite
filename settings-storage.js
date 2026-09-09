// settings-storage.js — Хранение и управление настройками uWaveSuite
// Сохраняет конфигурацию в localStorage с возможностью экспорта/импорта

const UWSettingsStorage = (() => {

    const STORAGE_KEY = 'uwave_suite_settings';
    const STORAGE_VERSION = 1;

    // ========== НАСТРОЙКИ ПО УМОЛЧАНИЮ ==========
    
    const defaultSettings = {
        version: STORAGE_VERSION,
        
        // Порт
        port: {
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
        },
        
        // GNSS порт
        gnss: {
            baudRate: 38400,
            enabled: false,
            compassMode: 'auto',        // 'auto' | 'hdt' | 'magnetic'
            hasTrueHeading: false
        },
        
        // Устройство
        device: {
            txChID: 0,
            rxChID: 0,
            salinityPSU: 0,
            gravityAcc: 9.8,
            isCmdMode: true,
            isACKOnTXFinished: false,
            acousticBaudrate: 0,
            totalCodeChannels: 0
        },
        
        // Антенна
        antenna: {
            mode: 'cartesian_fixed',    // 'cartesian_fixed' | 'geographic'
            latDeg: NaN,
            lonDeg: NaN,
            headingDeg: 0,
            depthM: NaN,
            offsetXM: 0,
            offsetYM: 0,
            phiDeg: 0,
            maxBeaconSpeedMps: 1.0,
            maxDistM: 1000.0,
            soundSpeedMps: 1480.0,
            soundSpeedAuto: true
        },
        
        // Трекинг
		tracking: {
			enabled: false,
			intervalMs: 2000,
			devices: [],
			mode: 'cdma',               // 'cdma' | 'logical'
			txChID: 0,
			rxChID: 0,
			commandMode: 'weighted',    // 'weighted' | 'cycle' | 'single'
			commands: [
				{ cmd: 2, weight: 5 },  // DPT
				{ cmd: 3, weight: 1 },  // TMP
				{ cmd: 4, weight: 1 }   // BAT
			],
			currentCommand: 2,
			autoStart: false,
			maxRetries: 1,
			retryDelayMs: 1000
		},
        
        // CDMA
        cdma: {
            addressingMode: 'cdma',     // 'cdma' | 'logical'
            rxChID: 0,
            txChID: 0,
            totalCodeChannels: 0
        },
        
        // Логическая адресация
        logical: {
            localAddress: 0,
            isPTS: false,
            broadcastAddress: 255
        },
        
        // Треки
        tracks: {
            maxPointsPerTrack: 500,
            minPointDistanceM: 0.5,
            showTracks: true,
            showStationTrack: true
        },
        
        // Отображение
        display: {
            theme: 'dark',
            showGrid: true,
            showScale: true,
            showRuler: false,
            autoScale: true,
            scale: 100,
            followTarget: null,         // { type: 'antenna' | 'beacon', address? }
            mapCenter: { x: 0, y: 0 },
            showBeaconsBar: true,
            showConsole: false,
            language: 'ru'              // 'ru' | 'en'
        },
        
        // Логирование
        logging: {
            enabled: true,
            maxEntries: 1000,
            logIncoming: true,
            logOutgoing: true,
            logGnss: true
        },
        
        // Экспорт
        export: {
            format: 'csv',              // 'csv' | 'kml' | 'dxf' | 'gga'
            includeDepth: true,
            includeAzimuth: true,
            includeMSR: true
        },
        
        // POI
        poi: {
            points: [],
            visible: true
        },
        
        // VLBL
        vlbl: {
            bases: [],                  // [{ lat, lon, depth, address }]
            enabled: false
        }
    };

    // ========== СОСТОЯНИЕ ==========
    
    let settings = loadSettings();
    let listeners = [];

    // ========== ЗАГРУЗКА/СОХРАНЕНИЕ ==========
    
    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Объединяем с defaults для новых полей
                return deepMerge(defaultSettings, parsed);
            }
        } catch (e) {
            console.warn('[Settings] Ошибка загрузки:', e.message);
        }
        return deepClone(defaultSettings);
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            notifyListeners('save', settings);
            return true;
        } catch (e) {
            console.warn('[Settings] Ошибка сохранения:', e.message);
            return false;
        }
    }

    function resetSettings() {
        settings = deepClone(defaultSettings);
        saveSettings();
        notifyListeners('reset', settings);
        return settings;
    }

    // ========== ГЕТТЕРЫ ==========
    
    function getSettings() {
        return settings;
    }

    function get(path, defaultValue = null) {
        const keys = path.split('.');
        let value = settings;
        
        for (const key of keys) {
            if (value === null || value === undefined || typeof value !== 'object') {
                return defaultValue;
            }
            value = value[key];
        }
        
        return value !== undefined ? value : defaultValue;
    }

    function getPortSettings() {
        return settings.port;
    }

    function getGNSettings() {
        return settings.gnss;
    }

    function getDeviceSettings() {
        return settings.device;
    }

    function getAntennaSettings() {
        return settings.antenna;
    }

    function getTrackingSettings() {
        return settings.tracking;
    }

    function getCDMASettings() {
        return settings.cdma;
    }

    function getLogicalSettings() {
        return settings.logical;
    }

    function getTracksSettings() {
        return settings.tracks;
    }

    function getDisplaySettings() {
        return settings.display;
    }

    function getLoggingSettings() {
        return settings.logging;
    }

    function getExportSettings() {
        return settings.export;
    }

    function getVLBSettings() {
        return settings.vlbl;
    }

    // ========== СЕТТЕРЫ ==========
    
    function set(path, value) {
        const keys = path.split('.');
        let obj = settings;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (obj[keys[i]] === undefined || obj[keys[i]] === null) {
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        
        obj[keys[keys.length - 1]] = value;
        notifyListeners('change', { path, value });
    }

    function update(changes) {
        settings = deepMerge(settings, changes);
        notifyListeners('update', changes);
    }

    function setPortSettings(portSettings) {
        settings.port = { ...settings.port, ...portSettings };
        notifyListeners('change', { path: 'port', value: settings.port });
    }

    function setGNSettings(gnssSettings) {
        settings.gnss = { ...settings.gnss, ...gnssSettings };
        notifyListeners('change', { path: 'gnss', value: settings.gnss });
    }

    function setDeviceSettings(deviceSettings) {
        settings.device = { ...settings.device, ...deviceSettings };
        notifyListeners('change', { path: 'device', value: settings.device });
    }

    function setAntennaSettings(antennaSettings) {
        settings.antenna = { ...settings.antenna, ...antennaSettings };
        notifyListeners('change', { path: 'antenna', value: settings.antenna });
    }

    function setTrackingSettings(trackingSettings) {
        settings.tracking = { ...settings.tracking, ...trackingSettings };
        notifyListeners('change', { path: 'tracking', value: settings.tracking });
    }

    function setDisplaySettings(displaySettings) {
        settings.display = { ...settings.display, ...displaySettings };
        notifyListeners('change', { path: 'display', value: settings.display });
    }

    // ========== СПЕЦИАЛЬНЫЕ МЕТОДЫ ==========
    
    /**
     * Добавить устройство в трекинг
     */
	function addTrackingDevice(address, type = 'cdma', rxChID = null) {
		const rx = rxChID !== null ? rxChID : address;
		
		const exists = settings.tracking.devices.find(d => 
			d.address === address && d.type === type && 
			(d.rxChID !== undefined ? d.rxChID === rx : true)
		);
		
		if (!exists) {
			settings.tracking.devices.push({ 
				address, 
				type,
				rxChID: rx
			});
			notifyListeners('trackingDeviceAdded', { address, type, rxChID: rx });
			return true;
		}
		return false;
	}

    /**
     * Удалить устройство из трекинга
     */
	function removeTrackingDevice(address, type = 'cdma', rxChID = null) {
		const before = settings.tracking.devices.length;
		
		settings.tracking.devices = settings.tracking.devices.filter(d => {
			if (d.address !== address || d.type !== type) return true;
			if (rxChID !== null && d.rxChID !== undefined && d.rxChID !== rxChID) return true;
			return false;
		});
		
		if (settings.tracking.devices.length !== before) {
			notifyListeners('trackingDeviceRemoved', { address, type, rxChID });
			return true;
		}
		return false;
	}

    /**
     * Добавить базовую точку VLBL
     */
    function addVLBLBase(base) {
        settings.vlbl.bases.push(base);
        notifyListeners('vlblBaseAdded', base);
    }

    /**
     * Удалить базовую точку VLBL
     */
    function removeVLBLBase(index) {
        if (index >= 0 && index < settings.vlbl.bases.length) {
            const removed = settings.vlbl.bases.splice(index, 1)[0];
            notifyListeners('vlblBaseRemoved', removed);
            return true;
        }
        return false;
    }

    /**
     * Очистить базовые точки VLBL
     */
    function clearVLBLBases() {
        settings.vlbl.bases = [];
        notifyListeners('vlblBasesCleared');
    }

    // ========== ЭКСПОРТ/ИМПОРТ ==========
    
    /**
     * Экспорт настроек в JSON
     */
    function exportToJSON() {
        return JSON.stringify(settings, null, 2);
    }

    /**
     * Импорт настроек из JSON
     */
    function importFromJSON(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            settings = deepMerge(defaultSettings, imported);
            saveSettings();
            notifyListeners('import', settings);
            return true;
        } catch (e) {
            console.warn('[Settings] Ошибка импорта:', e.message);
            return false;
        }
    }

    /**
     * Скачать настройки как файл
     */
    function downloadSettings() {
        const json = exportToJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `uwave_settings_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Загрузить настройки из файла
     */
    function loadSettingsFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    settings = deepMerge(defaultSettings, imported);
                    saveSettings();
                    notifyListeners('import', settings);
                    resolve(settings);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // ========== ПОДПИСКА НА ИЗМЕНЕНИЯ ==========
    
    function subscribe(listener) {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }

    function notifyListeners(event, data) {
        for (const listener of listeners) {
            try {
                listener(event, data, settings);
            } catch (e) {
                console.warn('[Settings] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== УТИЛИТЫ ==========
    
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            return obj.map(item => deepClone(item));
        }
        const clone = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clone[key] = deepClone(obj[key]);
            }
        }
        return clone;
    }

    function deepMerge(target, source) {
        if (source === null || typeof source !== 'object') {
            return source !== undefined ? source : target;
        }
        
        if (Array.isArray(source)) {
            return deepClone(source);
        }
        
        const result = deepClone(target);
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] !== undefined) {
                    result[key] = deepMerge(result[key], source[key]);
                }
            }
        }
        
        return result;
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        // Геттеры
        getSettings,
        get,
        getPortSettings,
        getGNSettings,
        getDeviceSettings,
        getAntennaSettings,
        getTrackingSettings,
        getCDMASettings,
        getLogicalSettings,
        getTracksSettings,
        getDisplaySettings,
        getLoggingSettings,
        getExportSettings,
        getVLBSettings,
        
        // Сеттеры
        set,
        update,
        setPortSettings,
        setGNSettings,
        setDeviceSettings,
        setAntennaSettings,
        setTrackingSettings,
        setDisplaySettings,
        
        // Специальные
        addTrackingDevice,
        removeTrackingDevice,
        addVLBLBase,
        removeVLBLBase,
        clearVLBLBases,
        
        // Сохранение
        save: saveSettings,
        reset: resetSettings,
        
        // Экспорт/импорт
        exportToJSON,
        importFromJSON,
        downloadSettings,
        loadSettingsFromFile,
        
        // Подписка
        subscribe,
        
        // Утилиты
        deepClone,
        deepMerge,
        
        // Константы
        STORAGE_KEY,
        defaultSettings
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWSettingsStorage;
}