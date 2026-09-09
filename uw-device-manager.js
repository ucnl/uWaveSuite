// uw-device-manager.js — Реестр устройств uWave
// Управление маяками, определение типа (USBL/обычный), хранение параметров
// Поддерживает CDMA каналы и логическую адресацию

class UWDeviceManager extends EventTarget {

    constructor() {
        super();
        
        // Реестр устройств
        this.devices = new Map();           // key: адрес устройства, value: device object
        
        // Типы адресации
        this.addressingMode = 'cdma';       // 'cdma' | 'logical'
        
        // Параметры CDMA
        this.cdma = {
            rxChID: 0,                      // Канал приема (наш)
            txChID: 0,                      // Канал передачи (наш)
            totalCodeChannels: 0            // Всего каналов (из DINFO)
        };
        
        // Параметры логической адресации
        this.logical = {
            localAddress: 0,                // Наш адрес (0-255)
            isPTS: false,                   // Packet Transport Service
            broadcastAddress: 255           // Широковещательный адрес
        };
        
        // Информация о локальном устройстве
        this.localDevice = {
            serialNumber: '',
            systemMoniker: '',
            systemVersion: '',
            coreMoniker: '',
            coreVersion: '',
            acousticBaudrate: 0,
            salinityPSU: 0,
            isUSBL: false,                  // Определяется по наличию azimuth
            isValid: false
        };
        
        // Настройки трекинга
        this.trackingConfig = {
            enabled: false,
            intervalMs: 2000,               // Интервал опроса
            devices: [],                    // Список адресов для трекинга
            mode: 'cdma',                   // Режим трекинга: 'cdma' | 'logical'
            shortCommands: [                // Команды для опроса
                UWProtocol.RC_CODES.RC_DPT_GET,
                UWProtocol.RC_CODES.RC_TMP_GET,
                UWProtocol.RC_CODES.RC_BAT_V_GET
            ]
        };
        
        // Статистика
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            timeouts: 0
        };
    }

    // ======================== ИНИЦИАЛИЗАЦИЯ ========================
    
    /**
     * Обновить информацию о локальном устройстве
     */
    updateLocalDevice(dinfo) {
        this.localDevice = {
            serialNumber: dinfo.serialNumber,
            systemMoniker: dinfo.systemMoniker,
            systemVersion: dinfo.systemVersion,
            coreMoniker: dinfo.coreMoniker,
            coreVersion: dinfo.coreVersion,
            acousticBaudrate: dinfo.acousticBaudrate,
            salinityPSU: dinfo.salinityPSU,
            isUSBL: this._detectUSBL(dinfo),
            isValid: true
        };
        
        this.cdma.rxChID = dinfo.rxChID;
        this.cdma.txChID = dinfo.txChID;
        this.cdma.totalCodeChannels = dinfo.totalCodeChannels;
        
        this.logical.isPTS = dinfo.isPTS;
        
        this._emit('localDeviceUpdated', this.localDevice);
        this._emit('stateChanged');
        
        return this.localDevice;
    }

    /**
     * Определение USBL по возможностям устройства
     */
    _detectUSBL(dinfo) {
        // uWave USBL определяется по наличию azimuth в ответах
        // Пока возвращаем false — определится при первом ответе
        return false;
    }

    // ======================== УПРАВЛЕНИЕ УСТРОЙСТВАМИ ========================
    
    /**
     * Получить или создать устройство
     */
	getOrCreateDevice(address, type = 'cdma', rxChID = null) {
		const rx = rxChID !== null ? rxChID : address;
		const key = this._makeKey(address, type, rx);
		
		if (!this.devices.has(key)) {
			this.devices.set(key, {
				address,
				type,
				rxChID: rx,
				userAddress: type === 'logical' ? address : `Tx${address}/Rx${rx}`,
				
				slantRangeM: NaN,
				azimuthDeg: NaN,
				elevationDeg: NaN,
				depthM: NaN,
				propTimeS: NaN,
				msrDB: NaN,
				
				temperatureC: NaN,
				voltageV: NaN,
				pressureMbar: NaN,
				
				latitudeDeg: NaN,
				longitudeDeg: NaN,
				xM: NaN,
				yM: NaN,
				zM: NaN,
				
				isUSBL: false,
				isTimeout: false,
				dataAge: 0,
				lastUpdateTime: 0,
				succeededRequests: 0,
				failedRequests: 0,
				timeouts: 0,
				
				track: [],
				
				dhFilter: null,
				dhFilterXYZ: null,
				smoother: null,
				smootherXYZ: null,
				
				lastResponse: null,
				
				name: '',
				notes: '',
				color: this._generateColor(address)
			});
			
			this._emit('deviceAdded', this.devices.get(key));
		}
		
		return this.devices.get(key);
	}

    /**
     * Удалить устройство
     */
    removeDevice(address, type = 'cdma') {
        const key = this._makeKey(address, type);
        
        if (this.devices.has(key)) {
            const device = this.devices.get(key);
            this.devices.delete(key);
            this._emit('deviceRemoved', device);
            return true;
        }
        
        return false;
    }

    /**
     * Получить устройство
     */
	getDevice(address, type = 'cdma', rxChID = null) {
		const rx = rxChID !== null ? rxChID : address;
		const key = this._makeKey(address, type, rx);
		return this.devices.get(key) || null;
	}

    /**
     * Получить все устройства
     */
    getAllDevices() {
        return Array.from(this.devices.values());
    }

    /**
     * Получить устройства по типу
     */
    getDevicesByType(type) {
        return this.getAllDevices().filter(d => d.type === type);
    }

    /**
     * Получить USBL устройства
     */
    getUSBLDevices() {
        return this.getAllDevices().filter(d => d.isUSBL);
    }

    /**
     * Получить обычные устройства (без USBL)
     */
    getNonUSBLDevices() {
        return this.getAllDevices().filter(d => !d.isUSBL);
    }

    // ======================== ОБРАБОТКА ДАННЫХ ========================
    
    /**
     * Обработать ответ от удаленного устройства
     */
    processResponse(response) {
		const address = response.address || response.targetPtAddress || 0;
		const type = response.type || 'cdma';
		const rx = response.rxChID !== undefined ? response.rxChID : address;
		
		const device = this.getOrCreateDevice(address, type, rx);
        
        // Обновляем данные
        if (!isNaN(response.azimuthDeg)) {
            device.azimuthDeg = response.azimuthDeg;
            device.isUSBL = true;           // Есть azimuth — это USBL
        }
        
        if (!isNaN(response.propTimeSec)) {
            device.propTimeSec = response.propTimeSec;
        }
        
        if (!isNaN(response.msrDb)) {
            device.msrDB = response.msrDb;
        }
        
        if (!isNaN(response.value)) {
            // Определяем тип значения по команде
            if (response.rcCmdID === UWProtocol.RC_CODES.RC_DPT_GET) {
                device.depthM = response.value;
            } else if (response.rcCmdID === UWProtocol.RC_CODES.RC_TMP_GET) {
                device.temperatureC = response.value;
            } else if (response.rcCmdID === UWProtocol.RC_CODES.RC_BAT_V_GET) {
                device.voltageV = response.value;
            }
        }
        
        if (!isNaN(response.dataValue)) {
            // Для пакетного режима
            if (response.dataId === UWProtocol.DataID.DID_DPT) {
                device.depthM = response.dataValue;
            } else if (response.dataId === UWProtocol.DataID.DID_TMP) {
                device.temperatureC = response.dataValue;
            } else if (response.dataId === UWProtocol.DataID.DID_BAT) {
                device.voltageV = response.dataValue;
            }
        }
        
        // Обновляем статус
        device.isTimeout = false;
        device.dataAge = 0;
        device.lastUpdateTime = Date.now();
        device.succeededRequests++;
        device.lastResponse = response;
        
        this.stats.successfulRequests++;
        
        this._emit('deviceUpdated', device);
        this._emit('stateChanged');
        
        return device;
    }

    /**
     * Обработать таймаут устройства
     */
	processTimeout(address, type = 'cdma', rxChID = null) {
		const rx = rxChID !== null ? rxChID : address;
		const device = this.getOrCreateDevice(address, type, rx);
		
		device.isTimeout = true;
		device.timeouts++;
		device.failedRequests++;
		
		this.stats.timeouts++;
		
		this._emit('deviceTimeout', device);
		this._emit('stateChanged');
		
		return device;
	}

    /**
     * Обработать асинхронное сообщение
     */
    processAsyncMessage(data) {
        const device = this.getOrCreateDevice(0, 'cdma'); // Временный адрес
        
        if (!isNaN(data.azimuthDeg)) {
            device.azimuthDeg = data.azimuthDeg;
            device.isUSBL = true;
        }
        
        if (!isNaN(data.msrDb)) {
            device.msrDB = data.msrDb;
        }
        
        device.lastUpdateTime = Date.now();
        device.dataAge = 0;
        
        this._emit('asyncMessage', { device, data });
        
        return device;
    }

    // ======================== ТРЕКИНГ ========================
    
    /**
     * Установить конфигурацию трекинга
     */
    setTrackingConfig(config) {
        this.trackingConfig = {
            ...this.trackingConfig,
            ...config
        };
        
        this._emit('trackingConfigChanged', this.trackingConfig);
        return this.trackingConfig;
    }

    /**
     * Добавить устройство в трекинг
     */
    addTrackingDevice(address, type = 'cdma') {
        const device = this.getOrCreateDevice(address, type);
        
        if (!this.trackingConfig.devices.find(d => d.address === address && d.type === type)) {
            this.trackingConfig.devices.push({ address, type });
            this._emit('trackingDeviceAdded', { address, type });
        }
        
        return device;
    }

    /**
     * Удалить устройство из трекинга
     */
    removeTrackingDevice(address, type = 'cdma') {
        this.trackingConfig.devices = this.trackingConfig.devices.filter(
            d => !(d.address === address && d.type === type)
        );
        
        this._emit('trackingDeviceRemoved', { address, type });
    }

    /**
     * Получить список устройств для трекинга
     */
    getTrackingDevices() {
        return this.trackingConfig.devices.map(d => {
            return this.getDevice(d.address, d.type);
        }).filter(d => d !== null);
    }

    // ======================== ВОЗРАСТ ДАННЫХ ========================
    
    /**
     * Обновить возраст данных всех устройств
     */
    tickAge() {
        for (const device of this.devices.values()) {
            device.dataAge++;
            
            if (device.dataAge > 30) {
                device.isTimeout = true;
            }
        }
        
        this._emit('ageUpdated');
    }

    // ======================== НАСТРОЙКИ ========================
    
    /**
     * Установить режим адресации
     */
    setAddressingMode(mode) {
        if (mode === 'cdma' || mode === 'logical') {
            this.addressingMode = mode;
            this._emit('addressingModeChanged', mode);
        }
    }

    /**
     * Установить CDMA каналы
     */
    setCDMAChannels(rxChID, txChID) {
        this.cdma.rxChID = rxChID;
        this.cdma.txChID = txChID;
        this._emit('cdmaChannelsChanged', this.cdma);
    }

    /**
     * Установить локальный адрес (для logical mode)
     */
    setLocalAddress(address) {
        if (address >= 0 && address <= 255) {
            this.logical.localAddress = address;
            this._emit('localAddressChanged', address);
        }
    }

    // ======================== СТАТИСТИКА ========================
    
    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            deviceCount: this.devices.size,
            usblCount: this.getUSBLDevices().length,
            nonUSBLCount: this.getNonUSBLDevices().length
        };
    }

    /**
     * Сбросить статистику
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            timeouts: 0
        };
        
        for (const device of this.devices.values()) {
            device.succeededRequests = 0;
            device.failedRequests = 0;
            device.timeouts = 0;
        }
        
        this._emit('statsReset');
    }

    // ======================== УТИЛИТЫ ========================
    
    /**
     * Создать ключ для Map
     */
	_makeKey(address, type, rxChID = null) {
		if (type === 'logical') {
			return `logical:${address}`;
		}
		return `cdma:${address}:${rxChID !== null ? rxChID : address}`;
	}

    /**
     * Генерация цвета для устройства
     */
    _generateColor(address) {
        const colors = [
            '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
            '#ffeead', '#ffcc5c', '#ff6f69', '#88d8b0',
            '#c7ceea', '#f7dc6f', '#a3e4d7', '#f1948a',
            '#82e0aa', '#f8c471', '#85c1e9', '#d2b4de'
        ];
        return colors[address % colors.length];
    }

    /**
     * Установить имя устройства
     */
    setName(address, name, type = 'cdma') {
        const device = this.getOrCreateDevice(address, type);
        device.name = name;
        this._emit('deviceUpdated', device);
    }

    /**
     * Установить заметки устройства
     */
    setNotes(address, notes, type = 'cdma') {
        const device = this.getOrCreateDevice(address, type);
        device.notes = notes;
        this._emit('deviceUpdated', device);
    }

    /**
     * Очистить все устройства
     */
    clearAll() {
        this.devices.clear();
        this._emit('devicesCleared');
    }

    /**
     * Экспорт состояния
     */
    exportState() {
        return {
            devices: Array.from(this.devices.values()),
            cdma: this.cdma,
            logical: this.logical,
            trackingConfig: this.trackingConfig,
            localDevice: this.localDevice,
            addressingMode: this.addressingMode,
            stats: this.stats
        };
    }

    /**
     * Импорт состояния
     */
    importState(state) {
        if (!state) return;
        
        if (state.devices) {
            this.devices.clear();
            for (const device of state.devices) {
                this.devices.set(this._makeKey(device.address, device.type), device);
            }
        }
        
        if (state.cdma) this.cdma = state.cdma;
        if (state.logical) this.logical = state.logical;
        if (state.trackingConfig) this.trackingConfig = state.trackingConfig;
        if (state.localDevice) this.localDevice = state.localDevice;
        if (state.addressingMode) this.addressingMode = state.addressingMode;
        if (state.stats) this.stats = state.stats;
        
        this._emit('stateImported');
    }

    // ======================== СОБЫТИЯ ========================
    
    _emit(eventType, detail = {}) {
        this.dispatchEvent(new CustomEvent(eventType, { detail }));
    }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWDeviceManager;
}