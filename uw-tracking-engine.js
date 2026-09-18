// uw-tracking-engine.js — Движок трекинга uWave
// Циклический опрос устройств с интервалами
// Поддерживает CDMA и логическую адресацию

class UWTrackingEngine extends EventTarget {

    constructor(port, queueManager, deviceManager) {
        super();
        
        this.port = port;                   // UWPort instance
        this.queueManager = queueManager;   // UWQueueManager instance
        this.deviceManager = deviceManager; // UWDeviceManager instance
        
        // Состояние трекинга
        this.isActive = false;
        this.isPaused = false;
        
        // Таймеры
        this.trackingTimer = null;
        this.currentDeviceIndex = 0;
        
        // Настройки
        this.config = {
            intervalMs: 2000,               // Интервал между опросами
            devices: [],                    // [{ address, type }]
            commands: [                     // Команды для опроса
                UWProtocol.RC_CODES.RC_DPT_GET,
                UWProtocol.RC_CODES.RC_TMP_GET,
                UWProtocol.RC_CODES.RC_BAT_V_GET
            ],
            commandMode: 'cycle',           // 'cycle' | 'single'
            currentCommand: UWProtocol.RC_CODES.RC_DPT_GET,
            autoStart: false,               // Автостарт после обнаружения
            maxRetries: 1,                  // Повторы при ошибке
            retryDelayMs: 1000              // Задержка перед повтором
        };
        
        // Статистика трекинга
        this.stats = {
            cycles: 0,                      // Всего циклов
            requests: 0,                    // Всего запросов
            successful: 0,                  // Успешных
            failed: 0,                      // Ошибок
            timeouts: 0,                    // Таймаутов
            lastCycleTime: 0,               // Время последнего цикла
            averageCycleTime: 0             // Среднее время цикла
        };
        
        // Подписка на события
        this._wireEvents();
    }

    _wireEvents() {
        // Результаты трекинга
        this.queueManager.addEventListener('trackingResult', (e) => {
            this._handleTrackingResult(e.detail);
        });
        
        this.queueManager.addEventListener('trackingError', (e) => {
            this._handleTrackingError(e.detail);
        });
        
        // Изменение состояния порта
        this.port.addEventListener('stateChanged', () => {
            if (!this.port.isOpen && this.isActive) {
                this.stop('Порт закрыт');
            }
        });
        
        // Изменение конфигурации устройств
        this.deviceManager.addEventListener('trackingConfigChanged', (e) => {
            this.config.devices = e.detail.devices;
            this.config.intervalMs = e.detail.intervalMs || this.config.intervalMs;
        });
    }

    // ======================== УПРАВЛЕНИЕ ТРЕКИНГОМ ========================
    
    /**
     * Запустить трекинг
     */
    start() {
        if (this.isActive) {
            this._emit('warning', { message: 'Трекинг уже запущен' });
            return false;
        }
        
        if (!this.port.isOpen || !this.port.detected) {
            this._emit('error', { message: 'Порт не готов' });
            return false;
        }
        
        if (this.config.devices.length === 0) {
            this._emit('error', { message: 'Нет устройств для трекинга' });
            return false;
        }
        
        this.isActive = true;
        this.isPaused = false;
        this.currentDeviceIndex = 0;
        
        this._emit('started', {
            devices: this.config.devices,
            intervalMs: this.config.intervalMs
        });
        
        // Запускаем первый опрос
        this._scheduleNextRequest(0);
        
        return true;
    }

    /**
     * Остановить трекинг
     */
    stop(reason = 'Вручную') {
        if (!this.isActive) {
            return false;
        }
        
        this.isActive = false;
        this.isPaused = false;
        
        if (this.trackingTimer) {
            clearTimeout(this.trackingTimer);
            this.trackingTimer = null;
        }
        
        this._emit('stopped', { reason });
        
        return true;
    }

    /**
     * Пауза трекинга
     */
    pause() {
        if (!this.isActive || this.isPaused) {
            return false;
        }
        
        this.isPaused = true;
        
        if (this.trackingTimer) {
            clearTimeout(this.trackingTimer);
            this.trackingTimer = null;
        }
        
        this._emit('paused');
        
        return true;
    }

    /**
     * Возобновить трекинг
     */
    resume() {
        if (!this.isActive || !this.isPaused) {
            return false;
        }
        
        this.isPaused = false;
        this._scheduleNextRequest(0);
        
        this._emit('resumed');
        
        return true;
    }

    // ======================== ЦИКЛ ОПРОСА ========================
    
    /**
     * Запланировать следующий запрос
     */
    _scheduleNextRequest(delayMs = null) {
        if (!this.isActive || this.isPaused) {
            return;
        }
        
        const delay = delayMs !== null ? delayMs : this.config.intervalMs;
        
        if (this.trackingTimer) {
            clearTimeout(this.trackingTimer);
        }
        
        this.trackingTimer = setTimeout(() => {
            this._sendNextRequest();
        }, delay);
    }

    /**
     * Отправить следующий запрос
     */
	_sendNextRequest() {
		if (!this.isActive || this.isPaused) return;
		
		if (this.config.devices.length === 0) {
			this.stop('Нет устройств');
			return;
		}
		
		const deviceConfig = this.config.devices[this.currentDeviceIndex];
		
		const device = this.deviceManager.getOrCreateDevice(
			deviceConfig.address, 
			deviceConfig.type,
			deviceConfig.rxChID
		);
		
		const command = this._getNextCommand();
		this._sendRequest(device, command);
	}

    /**
     * Отправить запрос устройству
     */
	_sendRequest(device, command) {
		const startTime = Date.now();
		
		this.stats.requests++;
		
		this._emit('requesting', {
			device: {
				address: device.address,
				type: device.type,
				rxChID: device.rxChID,
				userAddress: device.userAddress
			},
			command,
			timestamp: startTime
		});
		
		let sent = false;
		
		if (device.type === 'logical') {
			// Логическая адресация — PT ITG
			const dataID = this._commandToDataID(command);
			sent = this.port.queryPTITG(device.address, dataID);
		} else {
			// CDMA — каналы из устройства
			sent = this.port.queryRC(device.address, device.rxChID, command);
		}
		
		if (!sent) {
			this._handleTrackingError({
				address: device.address,
				error: new Error('Failed to send request')
			});
		}
	}
	
	
	_commandToDataID(command) {
		switch (command) {
			case UWProtocol.RC_CODES.RC_DPT_GET: return UWProtocol.DataID.DID_DPT;
			case UWProtocol.RC_CODES.RC_TMP_GET: return UWProtocol.DataID.DID_TMP;
			case UWProtocol.RC_CODES.RC_BAT_V_GET: return UWProtocol.DataID.DID_BAT;
			default: return UWProtocol.DataID.DID_DPT;
		}
	}

    /**
     * Перейти к следующему устройству
     */
	_advanceToNextDevice() {
		this.currentDeviceIndex++;
		
		if (this.currentDeviceIndex >= this.config.devices.length) {
			this.currentDeviceIndex = 0;
			this.stats.cycles++;
			this.stats.lastCycleTime = Date.now();
			
			this._emit('cycleCompleted', {
				cycle: this.stats.cycles,
				devices: this.config.devices.length
			});
		}
		
		// Планируем следующий запрос через интервал
		this._scheduleNextRequest(this.config.intervalMs);
	}

    /**
     * Получить следующую команду для опроса
     */
	_getNextCommand() {
		if (this.config.commandMode === 'single') {
			return this.config.currentCommand;
		}
		
		if (this.config.commandMode === 'weighted') {
			const commands = this.config.commands;
			if (commands.length === 0) return UWProtocol.RC_CODES.RC_DPT_GET;
			
			const totalWeight = commands.reduce((sum, c) => sum + (c.weight || 1), 0);
			let random = Math.random() * totalWeight;
			
			for (const item of commands) {
				random -= (item.weight || 1);
				if (random <= 0) {
					this.config.currentCommand = item.cmd;
					return item.cmd;
				}
			}
			
			this.config.currentCommand = commands[0].cmd;
			return commands[0].cmd;
		}
		
		// cycle mode
		const commands = this.config.commands;
		if (commands.length === 0) return UWProtocol.RC_CODES.RC_DPT_GET;
		
		const currentCmd = this.config.currentCommand;
		const currentIndex = commands.findIndex(c => (c.cmd || c) === currentCmd);
		const nextIndex = (currentIndex + 1) % commands.length;
		const nextCmd = commands[nextIndex].cmd || commands[nextIndex];
		this.config.currentCommand = nextCmd;
		return nextCmd;
	}
	
	
    // ======================== ОБРАБОТКА РЕЗУЛЬТАТОВ ========================
    
    /**
     * Обработать результат трекинга
     */
	_handleTrackingResult(data) {
		this.stats.successful++;
		
		const type = data.type || 'cdma';
		const response = data.result || data;  
		const address = data.address || response.txChID || response.targetPtAddress;
		
		const device = this.deviceManager.processResponse({
			...response,       
			address: address,
			type: type
		});
		
		this._emit('result', { device, result: response, timestamp: Date.now() });
		this._advanceToNextDevice();
	}

	_handleTrackingError(data) {
		this.stats.failed++;
		
		if (data.error && data.error.message.includes('timeout')) {
			this.stats.timeouts++;
		}
		
		const type = data.type || 'cdma';
		
		if (data.address !== undefined) {
			this.deviceManager.processTimeout(data.address, type);
		}
		
		this._emit('error', {
			address: data.address,
			error: data.error,
			timestamp: Date.now()
		});
		
		// Переходим к следующему устройству
		this._advanceToNextDevice();
	}

    // ======================== КОНФИГУРАЦИЯ ========================
    
    /**
     * Установить конфигурацию трекинга
     */
	setConfig(config) {
		this.config = {
			...this.config,
			...config,
			mode: config.mode || this.config.mode || 'cdma',
			commandMode: config.commandMode || this.config.commandMode || 'weighted'
		};
		
		// Нормализуем команды если пришли простым массивом чисел
		if (this.config.commands.length > 0 && typeof this.config.commands[0] === 'number') {
			this.config.commands = this.config.commands.map(cmd => ({ cmd, weight: 1 }));
		}
		
		this._emit('configChanged', this.config);
		return this.config;
	}

    /**
     * Добавить устройство в трекинг
     */
    addDevice(address, type = 'cdma') {
        if (!this.config.devices.find(d => d.address === address && d.type === type)) {
            this.config.devices.push({ address, type });
            this.deviceManager.addTrackingDevice(address, type);
            this._emit('deviceAdded', { address, type });
            return true;
        }
        return false;
    }

    /**
     * Удалить устройство из трекинга
     */
    removeDevice(address, type = 'cdma') {
        const before = this.config.devices.length;
        this.config.devices = this.config.devices.filter(
            d => !(d.address === address && d.type === type)
        );
        
        if (this.config.devices.length !== before) {
            this.deviceManager.removeTrackingDevice(address, type);
            this._emit('deviceRemoved', { address, type });
            return true;
        }
        return false;
    }

    /**
     * Установить интервал опроса
     */
    setInterval(intervalMs) {
        if (intervalMs >= 100) { // Минимальный интервал 100мс
            this.config.intervalMs = intervalMs;
            this._emit('intervalChanged', intervalMs);
        }
    }

    /**
     * Установить команды для опроса
     */
    setCommands(commands) {
        this.config.commands = commands;
        this.config.currentCommand = commands[0];
        this._emit('commandsChanged', commands);
    }

    /**
     * Установить режим команд
     */
    setCommandMode(mode, singleCommand = null) {
        if (mode === 'cycle' || mode === 'single') {
            this.config.commandMode = mode;
            if (mode === 'single' && singleCommand !== null) {
                this.config.currentCommand = singleCommand;
            }
            this._emit('commandModeChanged', mode);
        }
    }

    // ======================== СТАТИСТИКА ========================
    
    /**
     * Получить статистику трекинга
     */
    getStats() {
        const now = Date.now();
        const uptime = this.isActive ? now - this.stats.lastCycleTime : 0;
        
        return {
            ...this.stats,
            isActive: this.isActive,
            isPaused: this.isPaused,
            devicesCount: this.config.devices.length,
            currentDeviceIndex: this.currentDeviceIndex,
            uptime
        };
    }

    /**
     * Сбросить статистику
     */
    resetStats() {
        this.stats = {
            cycles: 0,
            requests: 0,
            successful: 0,
            failed: 0,
            timeouts: 0,
            lastCycleTime: 0,
            averageCycleTime: 0
        };
        
        this._emit('statsReset');
    }

    // ======================== УТИЛИТЫ ========================
    
    /**
     * Получить состояние
     */
    getState() {
        return {
            isActive: this.isActive,
            isPaused: this.isPaused,
            config: this.config,
            stats: this.getStats()
        };
    }

    /**
     * Экспорт конфигурации
     */
    exportConfig() {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * Импорт конфигурации
     */
    importConfig(jsonString) {
        try {
            const config = JSON.parse(jsonString);
            this.setConfig(config);
            return true;
        } catch (e) {
            this._emit('error', { message: 'Ошибка импорта: ' + e.message });
            return false;
        }
    }

    // ======================== СОБЫТИЯ ========================
    
    _emit(eventType, detail = {}) {
        this.dispatchEvent(new CustomEvent(eventType, { detail }));
    }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWTrackingEngine;
}