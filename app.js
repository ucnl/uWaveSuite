// app.js — Главный модуль приложения uWaveSuite
// Полная интеграция всех компонентов

const UWApp = (() => {

    const APP_VERSION = '0.4.0';
    const APP_NAME = 'uWaveSuite';

    // ========== DOM ЭЛЕМЕНТЫ ==========
    let connectionIndicator, statusText, deviceLabel;
    let btnConnection, btnTracking, btnSettings, btnGnss;
    let btnDevicesClear;
    let devicesBar;

    // ========== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ==========
    let uwPort = null;
    let queueManager = null;
    let deviceManager = null;
    let trackingEngine = null;
    
    let isConnected = false;
    let isGnssConnected = false;
    let ageTimer = null;
    
    let gnssBridge = null;
    let compassMode = 'auto';
    let hasTrueHeading = false;
    
    let activeDropdown = null;
    
    // ========== ВОСПРОИЗВЕДЕНИЕ ЛОГА ==========
    let isPlaying = false;
    let playbackSpeed = 1;
    let playbackTimer = null;
    let playbackEntries = [];
    let playbackIndex = 0;

    const PLAYBACK_SPEEDS = [1, 2, 4, 8];

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init() {
		window.UWApp = UWApp;
		
        // DOM элементы
        connectionIndicator = document.getElementById('connection-indicator');
        statusText = document.getElementById('status-text');
        deviceLabel = document.getElementById('device-label');
        btnConnection = document.getElementById('btn-connection');
        btnTracking = document.getElementById('btn-tracking');
        btnSettings = document.getElementById('btn-settings');
        btnGnss = document.getElementById('btn-gnss');
        btnDevicesClear = document.getElementById('devices-btn-clear');
        devicesBar = document.getElementById('devices-bar');
        
        // Версия
        document.getElementById('app-version').textContent = APP_VERSION;
        
        // Инициализация менеджеров
        initManagers();
        
        // Инициализация UI модулей
        initUIModules();
		
		// Загрузка VLBL решений из storage
		if (typeof UWVLBStore !== 'undefined') {
			UWVLBStore.loadSolutionsFromStorage();
		}
        
        // Инициализация обработчиков
        initEventHandlers();
        
        // Загрузка настроек
        loadSettings();
        
        // Таймер возраста данных
        ageTimer = setInterval(tickAge, 1000);
        
        // Обновление UI
        updateAllButtons();
        updateDeviceInfo();
        updateAntennaInfo();
        initPlaybackControls();
    }

    function initManagers() {
        uwPort = new UWPort(UWSettingsStorage.get('port.baudRate', 9600));
        
        deviceManager = new UWDeviceManager();
        queueManager = new UWQueueManager(uwPort);
        trackingEngine = new UWTrackingEngine(uwPort, queueManager, deviceManager);
        
        wirePortEvents();
        wireQueueEvents();
        wireDeviceEvents();
        wireTrackingEvents();
		
		// Отладочные устройства
		// addDebugDevices();
    }
	
	function addDebugDevices() {
    console.log('[App] Adding debug devices...');
    
    // CDMA устройство Tx=0 Rx=0
    const device1 = deviceManager.getOrCreateDevice(0, 'cdma', 0);
    device1.slantRangeM = 50;
    device1.azimuthDeg = 45;
    device1.depthM = 10;
    device1.msrDB = 80;
    device1.temperatureC = 15;
    device1.voltageV = 12;
    device1.xM = 35;
    device1.yM = 35;
    device1.zM = 10;
    device1.isUSBL = false;
    device1.dataAge = 2;
    
    // CDMA устройство Tx=0 Rx=1
    const device2 = deviceManager.getOrCreateDevice(0, 'cdma', 1);
    device2.slantRangeM = 100;
    device2.azimuthDeg = 135;
    device2.depthM = 20;
    device2.msrDB = 75;
    device2.temperatureC = 14;
    device2.voltageV = 11.5;
    device2.xM = -70;
    device2.yM = -70;
    device2.zM = 20;
    device2.isUSBL = true;
    device2.dataAge = 5;
    
    // Logical устройство #10
    const device3 = deviceManager.getOrCreateDevice(10, 'logical');
    device3.slantRangeM = 75;
    device3.azimuthDeg = 200;
    device3.depthM = 15;
    device3.msrDB = 70;
    device3.temperatureC = 16;
    device3.voltageV = 12.5;
    device3.xM = -50;
    device3.yM = 50;
    device3.zM = 15;
    device3.isUSBL = false;
    device3.dataAge = 8;
    
    // Обновляем карточки
    updateDevicesBar();
    
    console.log('[App] Debug devices added:', deviceManager.getAllDevices().length);
}

    function initUIModules() {
        UISettings.init('settings-overlay');
        UIChat.init('chat-panel'); 
        UITracking.init('tracking-panel');
        UIAddressing.init('addressing-panel');
        UIVLBL.init('vlbl-panel');
        UIDevices.init('devices-panel');
        UIConsole.init('console-panel', 'console-content');
        UIExport.init('export-panel');
        UIMap.init('map-canvas', 'map-container');
        UITopo.init('topo-panel');
		UIRuler.init('map-canvas');
    }

    function wirePortEvents() {
        uwPort.addEventListener('log', (e) => {
            addConsoleMessage(e.detail.message, 'info', 'PORT');
        });
        
        uwPort.addEventListener('error', (e) => {
            addConsoleMessage(e.detail.message, 'error', 'PORT');
            setStatus('Ошибка: ' + e.detail.message);
        });
        
        uwPort.addEventListener('stateChanged', () => {
            updateAllButtons();
        });
        
        uwPort.addEventListener('deviceInfo', (e) => {
            handleDeviceInfo(e.detail);
        });
        
        uwPort.addEventListener('rcResponse', (e) => {
            handleRCResponse(e.detail);
			if (!trackingEngine || !trackingEngine.isActive) {
				UIChat.addIncoming('response', e.detail);
			}
        });
        
        uwPort.addEventListener('rcTimeout', (e) => {
            handleRCTimeout(e.detail);
			if (!trackingEngine || !trackingEngine.isActive) {
				UIChat.addOutgoing('timeout', e.detail);
			}
        });
        
        uwPort.addEventListener('rcAsyncIn', (e) => {
            handleRCAsyncIn(e.detail);
			UIChat.addIncoming('async', e.detail);
        });
        
        uwPort.addEventListener('ambData', (e) => {
            handleSensorData(e.detail);
        });
        
        uwPort.addEventListener('packetReceived', (e) => {
            handlePacketReceived(e.detail);
			UIChat.addIncoming('packet', e.detail);
        });
		
		uwPort.addEventListener('packetTransferred', (e) => {
			handlePacketTransferred(e.detail);
			UIChat.addOutgoing('packet-delivered', e.detail);
		});

		uwPort.addEventListener('packetTransferFailed', (e) => {
			handlePacketTransferFailed(e.detail);
			UIChat.addOutgoing('packet-failed', e.detail);
		});
		
		
		
		
		uwPort.addEventListener('ackReceived', (e) => {
			console.log('[App] ACK received:', e.detail.sentenceID, 'error:', e.detail.errorID);
					
			if (e.detail.sentenceID === UWProtocol.ICs.IC_H2D_SETTINGS_WRITE && 
				e.detail.errorID === UWProtocol.LOC_ERR.LOC_ERR_NO_ERROR) {
				setTimeout(() => {
					configureAmbientData();
				}, 300);
			}
		});
    }

	function wireQueueEvents() {
		queueManager.addEventListener('queued', (e) => {
			addConsoleMessage(`Запрос в очереди: ${e.detail.request?.type || 'unknown'}`, 'debug', 'QUEUE');
		});
		
		queueManager.addEventListener('processing', (e) => {
			addConsoleMessage(`Выполняется: ${e.detail.request?.type || 'unknown'}`, 'debug', 'QUEUE');
		});
		
		queueManager.addEventListener('completed', (e) => {
			addConsoleMessage(`Завершено: ${e.detail.request?.type || 'unknown'}`, 'success', 'QUEUE');
		});
		
		queueManager.addEventListener('failed', (e) => {
			const errorMsg = e.detail?.error?.message || 'Unknown error';
			addConsoleMessage(`Ошибка: ${errorMsg}`, 'error', 'QUEUE');
		});
	}

	function wireDeviceEvents() {
		deviceManager.addEventListener('deviceAdded', (e) => {
			addConsoleMessage(`Устройство обнаружено: #${e.detail.userAddress}`, 'info', 'DEVICE');
			updateDevicesBar();
		});
		
		deviceManager.addEventListener('deviceUpdated', (e) => {
			updateDevicesBar();
			
			// VLBL — записываем измерение если режим включен
			if (typeof UIVLBL !== 'undefined' && UIVLBL.isVLBLActive()) {
				UIVLBL.onDeviceUpdated(e.detail);
			}
		});
		
		deviceManager.addEventListener('deviceTimeout', (e) => {
			addConsoleMessage(`Таймаут устройства #${e.detail.userAddress}`, 'warning', 'DEVICE');
			updateDevicesBar();
		});
	}

    function wireTrackingEvents() {
        trackingEngine.addEventListener('started', (e) => {
            setStatus(`Трекинг запущен (${e.detail.devices.length} устройств)`);
            updateAllButtons();
        });
        
        trackingEngine.addEventListener('stopped', (e) => {
            setStatus('Трекинг остановлен: ' + e.detail.reason);
            updateAllButtons();
        });
        
        trackingEngine.addEventListener('requesting', (e) => {
            addConsoleMessage(`Опрос #${e.detail.device.userAddress}`, 'debug', 'TRACK');
        });
        
        trackingEngine.addEventListener('result', (e) => {
            handleTrackingResult(e.detail);
        });
        
        trackingEngine.addEventListener('error', (e) => {
            addConsoleMessage(`Ошибка трекинга: ${e.detail.error.message}`, 'error', 'TRACK');
        });
    }

    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
    function handleDeviceInfo(info) {
        isConnected = true;
        connectionIndicator.className = 'connected';
        
        deviceManager.updateLocalDevice(info);
        updateAllButtons();
        
		UWSettingsStorage.setDeviceSettings({
			txChID: info.txChID,
			rxChID: info.rxChID,
			salinityPSU: info.salinityPSU,
			acousticBaudrate: info.acousticBaudrate,
			totalCodeChannels: info.totalCodeChannels,
			isCmdMode: info.isCommandModeByDefault
		});
		
		if (typeof UISettings !== 'undefined' && UISettings.updateFieldsFromSettings) {
			UISettings.updateFieldsFromSettings();
		}
        
        updateDeviceInfo();
        
        const sensorInfo = info.isPTS ? ' + PTS' : '';
		deviceLabel.textContent = `uWave${sensorInfo} [${info.serialNumber}]`;
        
        setStatus('Устройство обнаружено');
        
		applyDeviceSettings();		
		
        if (UWSettingsStorage.get('tracking.autoStart', false)) {
            startTracking();
        }
    }
	
	function applyDeviceSettings() {
		if (!uwPort || !uwPort.isOpen || !uwPort.detected) return;
		
		const txCh = UWSettingsStorage.get('device.txChID', 0);
		const rxCh = UWSettingsStorage.get('device.rxChID', 0);
		const salinity = UWSettingsStorage.get('device.salinityPSU', 0);
		const gravityAcc = UWSettingsStorage.get('device.gravityAcc', 9.8);
		const isCmdMode = UWSettingsStorage.get('device.isCmdMode', true);
		const isACK = UWSettingsStorage.get('device.isACKOnTXFinished', false);
		
		uwPort.querySettingsWrite(txCh, rxCh, salinity, isCmdMode, isACK, gravityAcc);
		
		addConsoleMessage(`Настройки: Tx=${txCh}, Rx=${rxCh}, Sal=${salinity}`, 'info', 'CFG');
	}
	
	function configureAmbientData() {
		if (!uwPort || !uwPort.isOpen || !uwPort.detected) return;
		
		if (uwPort.isWaitingLocal || uwPort.isWaitingRemote) {
			setTimeout(configureAmbientData, 500);
			return;
		}
		
		// Тандемный режим: periodMs = 1 — телеметрия с каждым сообщением
		uwPort.queryAmbCfgWrite(
			false,   // isSaveToFlash — не сохраняем
			1,       // periodMs = 1 — тандемный режим
			true,    // давление
			true,    // температура
			true,    // глубина
			false    // напряжение
		);
		
		addConsoleMessage('Локальная телеметрия: тандемный режим', 'info', 'CFG');
	}

	function handleRCResponse(response) {
		const rxChID = response.rxChID !== undefined ? response.rxChID : response.txChID;
		const device = deviceManager.processResponse({
			...response,
			address: response.txChID,
			rxChID: rxChID,
			type: 'cdma'
		});
		
		if (device) {
			const solved = UWUSBLsolver.solveUSBL(device);
			
			if (solved) {
				addTrackPoint(solved);
				updateDevicesBar();
			}
			
			let msg = `#${device.userAddress} >> ${response.rcCmdID}`;
			if (!isNaN(response.value)) msg += ` value=${response.value.toFixed(2)}`;
			if (!isNaN(response.azimuthDeg)) msg += ` az=${response.azimuthDeg.toFixed(1)}°`;
			msg += ` msr=${response.msrDb.toFixed(1)}dB`;
			addConsoleMessage(msg, 'success', 'RC');
		}
		
		// Уведомляем trackingEngine
		if (trackingEngine && trackingEngine.isActive) {
			trackingEngine._handleTrackingResult({
				address: response.txChID,
				result: response
			});
		}
	}

	function handleRCTimeout(response) {
		const rxChID = response.rxChID !== undefined ? response.rxChID : response.txChID;
		const device = deviceManager.processTimeout(response.txChID, 'cdma', rxChID);
		
		if (device) {
			addConsoleMessage(`Tx=${response.txChID} Rx=${rxChID} >> timeout`, 'warning', 'RC');
			updateDevicesBar();
		}
		
		// Уведомляем trackingEngine
		if (trackingEngine && trackingEngine.isActive) {
			trackingEngine._handleTrackingError({
				address: response.txChID,
				rxChID: rxChID,
				error: new Error('timeout')
			});
		}
	}

    function handleRCAsyncIn(data) {
        addConsoleMessage(`ASYNC: cmd=${data.rcCmdID} az=${data.azimuthDeg.toFixed(1)}°`, 'info', 'RC');
        
        if (!isNaN(data.azimuthDeg)) {
            const device = deviceManager.getDevice(0, 'cdma');
            if (device) {
                device.azimuthDeg = data.azimuthDeg;
                device.isUSBL = true;
                updateDevicesBar();
            }
        }
    }

    function handleSensorData(sensors) {
        UWUSBLsolver.processStationData({
            temperatureC: sensors.temperatureC,
            pressureMbar: sensors.pressureMbar,
            pitchDeg: sensors.pitchDeg,
            rollDeg: sensors.rollDeg,
            headingDeg: UWSettingsStorage.get('antenna.headingDeg', 0)
        });
        
        updateAntennaInfo();
    }

    function handlePacketReceived(data) {
        const text = new TextDecoder().decode(data.dataPacket);
        let msg = `PT #${data.targetPtAddress} >> "${text}"`;
        if (!isNaN(data.azimuthDeg)) msg += ` az=${data.azimuthDeg.toFixed(1)}°`;
        addConsoleMessage(msg, 'info', 'PT');
        
        const device = deviceManager.getOrCreateDevice(data.targetPtAddress, 'logical');
        if (!isNaN(data.azimuthDeg)) {
            device.azimuthDeg = data.azimuthDeg;
            device.isUSBL = true;
        }
        updateDevicesBar();
    }

	function handlePacketTransferred(data) {
		const text = data.dataPacket 
			? new TextDecoder().decode(
				data.dataPacket instanceof Uint8Array 
					? data.dataPacket 
					: new Uint8Array(data.dataPacket)
			)
			: '';
		
		let msg = `Пакет доставлен #${data.targetPtAddress}`;
		if (data.triesTaken !== undefined) msg += ` (попыток: ${data.triesTaken})`;
		if (!isNaN(data.azimuthDeg)) msg += `, az=${data.azimuthDeg.toFixed(1)}°`;
		if (text) msg += ` "${text}"`;
		
		addConsoleMessage(msg, 'success', 'PT');
	}

	function handlePacketTransferFailed(data) {
		let msg = `Пакет НЕ доставлен #${data.targetPtAddress}`;
		if (data.triesTaken !== undefined) msg += ` (попыток: ${data.triesTaken})`;
		
		addConsoleMessage(msg, 'error', 'PT');
	}




	function handleTrackingResult(data) {
		const device = data.device;
		const solved = UWUSBLsolver.solveUSBL(device);
		
		if (solved) {
			addTrackPoint(solved);
		}
		
		updateDevicesBar();
		
		// VLBL — записываем измерение если режим включен
		if (typeof UIVLBL !== 'undefined' && UIVLBL.isVLBLActive() && device) {
			UIVLBL.onDeviceUpdated(device);
		}
	}

    // ========== ПОДКЛЮЧЕНИЕ ==========
    
    async function connectSerial() {
        if (uwPort && (uwPort.isOpen || uwPort.connecting)) {
            return;
        }
        
        try {
            setStatus('Подключение...');
            await uwPort.open();
        } catch (err) {
            console.error('[App] Ошибка подключения:', err);
            setStatus('Ошибка: ' + err.message);
        }
    }

    async function disconnectSerial() {
        setStatus('Отключение...');
        
        if (trackingEngine.isActive) {
            trackingEngine.stop('Отключение');
        }
        
        queueManager.clear();
        
        if (uwPort) {
            await uwPort.close();
        }
        
        isConnected = false;
        connectionIndicator.className = '';
        deviceLabel.textContent = 'uWave';
        
        updateAllButtons();
        setStatus('Отключено');
    }

    async function connectGNSS() {
        if (gnssBridge) {
            await gnssBridge.close();
            gnssBridge = null;
        }
        
        try {
            setStatus('Подключение GNSS...');
            
            gnssBridge = new SerialBridge();
            gnssBridge.onMessage = onGnssMessage;
            gnssBridge.onError = (e) => {
                console.error('[GNSS] Ошибка:', e.message);
            };
            gnssBridge.onClose = () => {
                isGnssConnected = false;
                updateAllButtons();
            };
            
            const gnssBaud = UWSettingsStorage.get('gnss.baudRate', 38400);
            await gnssBridge.open(gnssBaud);
            
            isGnssConnected = true;
            updateAllButtons();
            setStatus('GNSS подключен');
            
        } catch (e) {
            setStatus('Ошибка GNSS: ' + e.message);
            updateAllButtons();
        }
    }

    async function disconnectGNSS() {
        if (gnssBridge) {
            await gnssBridge.close();
            gnssBridge = null;
        }
        isGnssConnected = false;
        updateAllButtons();
    }

	function onGnssMessage(rawLine) {
		const line = rawLine.trim();
		
		const data = GNSSParser.parse(line);
		if (!data) return;
		
		// ВСЕГДА обновляем топопривязку, если панель открыта
		if (typeof UITopo !== 'undefined' && UITopo.isPanelOpen()) {
			if (data.type === 'rmc' && !isNaN(data.latitude) && !isNaN(data.longitude)) {
				UITopo.updateFieldsFromGNSS(data.latitude, data.longitude, NaN);
			} else if ((data.type === 'hdt' || data.type === 'hdm') && !isNaN(data.heading)) {
				UITopo.updateFieldsFromGNSS(NaN, NaN, data.heading);
			}
		}
		
		// Если режим cartesian_fixed — не обновляем solver (там позиция = 0,0)
		if (UWSettingsStorage.get('antenna.mode') === 'cartesian_fixed') {
			return;
		}
		
		// Дальше — обновление solver и UI антенны в географическом режиме
		if (data.type === 'rmc' && !isNaN(data.latitude) && !isNaN(data.longitude)) {
			UWSettingsStorage.set('antenna.latDeg', data.latitude);
			UWSettingsStorage.set('antenna.lonDeg', data.longitude);
			
			UWUSBLsolver.setAntennaPosition(
				data.latitude,
				data.longitude,
				UWSettingsStorage.get('antenna.headingDeg', 0)
			);
			
			if (!isNaN(data.speedMps)) {
				UWUSBLsolver.setSpeedCourse(data.speedMps, data.course);
			}
			
			updateAntennaInfo();
			
		} else if (data.type === 'hdt' && !isNaN(data.heading)) {
			hasTrueHeading = true;
			UWSettingsStorage.set('antenna.headingDeg', data.heading);
			
			const lat = UWSettingsStorage.get('antenna.latDeg', NaN);
			const lon = UWSettingsStorage.get('antenna.lonDeg', NaN);
			
			if (!isNaN(lat) && !isNaN(lon)) {
				UWUSBLsolver.setAntennaPosition(lat, lon, data.heading);
			}
			
			updateAntennaInfo();
			
		} else if (data.type === 'hdm' && !isNaN(data.heading)) {
			if (shouldUseHeading('hdm')) {
				UWSettingsStorage.set('antenna.headingDeg', data.heading);
				
				const lat = UWSettingsStorage.get('antenna.latDeg', NaN);
				const lon = UWSettingsStorage.get('antenna.lonDeg', NaN);
				
				if (!isNaN(lat) && !isNaN(lon)) {
					UWUSBLsolver.setAntennaPosition(lat, lon, data.heading);
				}
				
				updateAntennaInfo();
			}
		}
	}

    function shouldUseHeading(type) {
        switch (compassMode) {
            case 'hdt': return type === 'hdt';
            case 'magnetic': return type === 'hdm';
            case 'auto':
            default:
                if (type === 'hdt') {
                    hasTrueHeading = true;
                    return true;
                }
                if (type === 'hdm') return !hasTrueHeading;
                return false;
        }
    }

    // ========== ТРЕКИНГ ==========
    
	function startTracking() {
		
		if (!isConnected) {
			setStatus('Нет подключения');
			return;
		}
		
		const trackingDevices = UWSettingsStorage.get('tracking.devices', []);
		
		if (trackingDevices.length === 0) {
			setStatus('Нет устройств для трекинга');
			return;
		}
		
		const savedCommands = UWSettingsStorage.get('tracking.commands', [
			{ cmd: UWProtocol.RC_CODES.RC_DPT_GET, weight: 5 },
			{ cmd: UWProtocol.RC_CODES.RC_TMP_GET, weight: 1 },
			{ cmd: UWProtocol.RC_CODES.RC_BAT_V_GET, weight: 1 }
		]);
		
		// Нормализуем команды
		let commands = savedCommands;
		if (commands.length > 0 && typeof commands[0] === 'number') {
			commands = commands.map(cmd => ({ cmd, weight: 1 }));
		}
		
		trackingEngine.setConfig({
			devices: trackingDevices,
			intervalMs: UWSettingsStorage.get('tracking.intervalMs', 2000),
			commands: commands,
			commandMode: UWSettingsStorage.get('tracking.commandMode', 'weighted'),
			currentCommand: UWSettingsStorage.get('tracking.currentCommand', UWProtocol.RC_CODES.RC_DPT_GET),
			mode: UWSettingsStorage.get('tracking.mode', 'cdma'),
			txChID: UWSettingsStorage.get('tracking.txChID', 
				UWSettingsStorage.get('device.txChID', 0)),
			rxChID: UWSettingsStorage.get('tracking.rxChID',
				UWSettingsStorage.get('device.rxChID', 0))
		});
		
		trackingEngine.start();
		
		// Обновляем панель
		if (typeof UITracking !== 'undefined') {
			if (UITracking.updateButtons) UITracking.updateButtons();
			if (UITracking.updateStats) UITracking.updateStats();
		}
		
		updateAllButtons();
	}

    function stopTracking() {
        trackingEngine.stop('Вручную');
		
		updateAllButtons();
    }

	function toggleTracking() {
		console.log('[App] toggleTracking called');
		console.log('[App] isConnected:', isConnected);
		console.log('[App] isActive before:', trackingEngine?.isActive);
		
		if (trackingEngine && trackingEngine.isActive) {
			console.log('[App] Stopping...');
			stopTracking();
		} else {
			const devices = UWSettingsStorage.get('tracking.devices', []);
			console.log('[App] devices:', devices);
			
			if (devices.length === 0) {
				setStatus('Нет устройств для трекинга');
				openTrackingPanel();
				return;
			}
			
			console.log('[App] Starting...');
			startTracking();
		}
		console.log('[App] isActive after:', trackingEngine?.isActive);
		updateAllButtons();
	}

    // ========== ТРЕКИ ==========
    
    function addTrackPoint(beacon) {
        if (!beacon) return;
        
        const st = UWUSBLsolver.getState();
        
        if (st.antennaMode === 'cartesian_fixed') {
            if (!isNaN(beacon.xM) && !isNaN(beacon.yM)) {
                Tracks.addPoint(
                    beacon.address,
                    beacon.absoluteDistanceM,
                    beacon.absoluteAzimuthDeg,
                    NaN, NaN,
                    beacon.zM,
                    beacon.isTimeout,
                    beacon.xM, beacon.yM, beacon.zM
                );
            }
        } else {
            if (!isNaN(beacon.latitudeDeg) && !isNaN(beacon.longitudeDeg)) {
                Tracks.addPoint(
                    beacon.address,
                    beacon.absoluteDistanceM,
                    beacon.absoluteAzimuthDeg,
                    beacon.latitudeDeg, beacon.longitudeDeg,
                    beacon.depthM,
                    beacon.isTimeout,
                    beacon.xM, beacon.yM, beacon.zM
                );
            }
        }
    }

    // ========== UI ОБНОВЛЕНИЯ ==========
    
    function updateAllButtons() {
        if (btnConnection) {
            if (isConnected) {
                btnConnection.textContent = '⏏ uWave';
                btnConnection.className = 'top-btn btn-disconnect';
            } else {
                btnConnection.textContent = '🔌 uWave';
                btnConnection.className = 'top-btn btn-connect';
            }
        }
        
        if (btnGnss) {
            if (isGnssConnected) {
                btnGnss.textContent = '⏏ GNSS';
                btnGnss.className = 'top-btn btn-disconnect';
            } else {
                btnGnss.textContent = '📡 GNSS';
                btnGnss.className = 'top-btn btn-gnss';
            }
        }
        
        if (btnTracking) {
			if (isConnected) {
				btnTracking.disabled = false;
				if (trackingEngine && trackingEngine.isActive) {
					btnTracking.textContent = '⏸ Стоп';
					btnTracking.className = 'top-btn btn-stop';
				} else {
					btnTracking.textContent = '▶ Трекинг';
					btnTracking.className = 'top-btn btn-start';
				}
			} else {
				btnTracking.disabled = true;
				btnTracking.textContent = '▶ Трекинг';
				btnTracking.className = 'top-btn btn-start';
			}
		}
        
        if (btnDevicesClear) {
            btnDevicesClear.disabled = deviceManager.getAllDevices().length === 0;
        }
    }

    function updateDeviceInfo() {
        const info = deviceManager.localDevice;
        
        if (info.isValid) {
            const sysEl = document.getElementById('dev-system');
            const coreEl = document.getElementById('dev-core');
            const serialEl = document.getElementById('dev-serial');
            const baudEl = document.getElementById('dev-baudrate');
            const chEl = document.getElementById('dev-channels');
            const ptsEl = document.getElementById('dev-pts');
            
            if (sysEl) sysEl.textContent = `${info.systemMoniker} v${info.systemVersion}`;
            if (coreEl) coreEl.textContent = `${info.coreMoniker} v${info.coreVersion}`;
            if (serialEl) serialEl.textContent = info.serialNumber;
            if (baudEl) baudEl.textContent = `${info.acousticBaudrate.toFixed(2)} bps`;
            if (chEl) chEl.textContent = info.totalCodeChannels;
            if (ptsEl) ptsEl.textContent = info.isPTS ? 'yes' : 'no';
        }
    }

	function updateAntennaInfo() {
		const st = UWUSBLsolver.getState();
		
		const latEl = document.getElementById('ai-lat');
		const lonEl = document.getElementById('ai-lon');
		const hdgEl = document.getElementById('ai-hdg');
		const dptEl = document.getElementById('ai-dpt');
		const tmpEl = document.getElementById('ai-tmp');
		
		if (!latEl || !lonEl || !hdgEl) return;
		
		if (st.antennaMode === 'cartesian_fixed') {
			latEl.textContent = 'Y=0.00';
			lonEl.textContent = 'X=0.00';
			hdgEl.textContent = '0.0';
		} else {
			latEl.textContent = isNaN(st.antennaLatDeg) ? '--' : st.antennaLatDeg.toFixed(6);
			lonEl.textContent = isNaN(st.antennaLonDeg) ? '--' : st.antennaLonDeg.toFixed(6);
			hdgEl.textContent = isNaN(st.antennaHeadingDeg) ? '--' : st.antennaHeadingDeg.toFixed(1);
		}
		
		if (dptEl) dptEl.textContent = isNaN(st.antennaDepthM) ? '--' : st.antennaDepthM.toFixed(1);
		if (tmpEl) tmpEl.textContent = isNaN(st.waterTempC) ? '--' : st.waterTempC.toFixed(1);
	}

    function updateDevicesBar() {
        const devices = deviceManager.getAllDevices();
        
        if (!devices || devices.length === 0) {
            devicesBar.classList.add('empty');
            devicesBar.innerHTML = '';
            return;
        }
        
        devicesBar.classList.remove('empty');
        
        let html = '';
        devices.forEach(device => {
            const age = device.dataAge || 0;
            const ageClass = age > 20 ? 'stale' : age > 10 ? 'old' : 'fresh';
            const cardClass = device.isTimeout ? 'timeout' : '';
            
            const range = !isNaN(device.slantRangeProjectionM) && device.slantRangeProjectionM > 0
                ? device.slantRangeProjectionM.toFixed(1) + ' м'
                : !isNaN(device.absoluteDistanceM)
                    ? device.absoluteDistanceM.toFixed(1) + ' м'
                    : '--';
            
            const azm = !isNaN(device.azimuthDeg)
                ? device.azimuthDeg.toFixed(1) + '°'
                : '--';
            
            html += `
            <div class="device-card ${cardClass}" onclick="UWApp.focusDeviceByAddress(${device.address}, '${device.type}')">
                <div class="dc-addr">#${device.userAddress}${device.isUSBL ? ' 📡' : ''}</div>
				<div class="bc-actions">
					${!isNaN(device.latitudeDeg) && !isNaN(device.longitudeDeg) ? 
						`<span class="bc-mark" onclick="event.stopPropagation(); UWApp.markBeaconPoint(${device.address}, '${device.type}')" title="Отметить в POI">📌</span>` 
						: ''}
				</div>
                <div class="dc-range">📏 ${range}</div>
                <div class="dc-azimuth">🧭 ${azm}</div>
                <div class="dc-depth">🌊 ${!isNaN(device.depthM) ? device.depthM.toFixed(1) + 'м' : '--'}</div>
                <div class="dc-msr">📶 ${!isNaN(device.msrDB) ? device.msrDB.toFixed(1) + ' dB' : '--'}</div>
                <div class="dc-temp">🌡 ${!isNaN(device.temperatureC) ? device.temperatureC.toFixed(1) + ' °C' : '--'}</div>
                <div class="dc-vcc">🔋 ${!isNaN(device.voltageV) ? device.voltageV.toFixed(1) + ' V' : '--'}</div>
                ${device.vlbl && !isNaN(device.vlbl.latDeg) ? `
				<div class="dc-vlbl" style="color:#ffaa00; font-size:10px; margin-top:2px;">
					📡 VLBL: ${device.vlbl.latDeg.toFixed(5)}, ${device.vlbl.lonDeg.toFixed(5)}
					${!isNaN(device.vlbl.radialError) ? ` (±${device.vlbl.radialError.toFixed(1)}м)` : ''}
				</div>
				` : ''}
				<div class="dc-age ${ageClass}">⏱ ${age.toFixed(0)}с${device.isTimeout ? ' ⌛' : ''}</div>
							</div>`;
        });
        
        devicesBar.innerHTML = html;
    }

    function addConsoleMessage(message, type = 'info', source = '') {
        if (typeof UIConsole !== 'undefined') {
            switch (type) {
                case 'info': UIConsole.addInfo(message, source); break;
                case 'success': UIConsole.addSuccess(message, source); break;
                case 'warning': UIConsole.addWarning(message, source); break;
                case 'error': UIConsole.addError(message, source); break;
                case 'debug': UIConsole.addDebug(message, source); break;
                default: UIConsole.addInfo(message, source); break;
            }
        }
    }

    // ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
    
	function initEventHandlers() {
		// Верхняя панель
		if (btnConnection) btnConnection.addEventListener('click', toggleConnection);
		if (btnTracking) btnTracking.addEventListener('click', toggleTracking);
		if (btnGnss) btnGnss.addEventListener('click', toggleGNSS);
		if (btnSettings) btnSettings.addEventListener('click', openSettings);
		if (btnDevicesClear) btnDevicesClear.addEventListener('click', clearDevices);
		
		// Кнопка темы
		const btnTheme = document.getElementById('btn-theme');
		if (btnTheme) btnTheme.addEventListener('click', cycleTheme);
		
		// Кнопки треков
		const btnTracksShow = document.getElementById('btn-tracks-show');
		const btnTracksClear = document.getElementById('btn-tracks-clear');
		const btnRuler = document.getElementById('btn-ruler');
		
		if (btnTracksShow) btnTracksShow.addEventListener('click', toggleTracks);
		if (btnTracksClear) btnTracksClear.addEventListener('click', clearTracks);
		if (btnRuler) btnRuler.addEventListener('click', toggleRuler);
		
		// Закрытие dropdown при клике вне
		document.addEventListener('click', function(e) {
			if (!e.target.closest('.dropdown')) {
				closeAllDropdowns();
			}
		});
		
		// Закрытие страницы
		window.addEventListener('beforeunload', async (e) => {
			if (trackingEngine && trackingEngine.isActive) {
				trackingEngine.stop('Закрытие');
			}
			
			if (gnssBridge) {
				await gnssBridge.close();
			}
			
			if (uwPort && uwPort.isOpen) {
				await uwPort.close();
			}
			
			if (ageTimer) {
				clearInterval(ageTimer);
			}
		});
	}

    function toggleConnection() {
        if (isConnected) disconnectSerial();
        else connectSerial();
    }

    function toggleGNSS() {
        if (isGnssConnected) disconnectGNSS();
        else connectGNSS();
    }

    function openSettings() {
        if (typeof UISettings !== 'undefined') UISettings.open();
    }

    function closeSettings() {
        if (typeof UISettings !== 'undefined') UISettings.close();
    }

    function applySettings() {
        if (typeof UISettings !== 'undefined') UISettings.applySettings();
		
		updateAntennaInfo();
    }

    function clearDevices() {
        if (confirm('Очистить все устройства?')) {
            deviceManager.clearAll();
            updateDevicesBar();
        }
    }

    function tickAge() {
        deviceManager.tickAge();
        updateDevicesBar();
    }

    // ========== ПАНЕЛИ ==========
    
    function toggleTopoPanel() {
        if (typeof UITopo !== 'undefined') UITopo.toggle();
    }

    function applyTopoBinding() {
        if (typeof UITopo !== 'undefined') UITopo.applyBinding();
    }

    function clearTopoBinding() {
        if (typeof UITopo !== 'undefined') UITopo.clearBinding();
    }

    function getPhoneGPS() {
        if (typeof UITopo !== 'undefined') UITopo.getPhoneGPS();
    }
    
	function toggleChatPanel() {
		if (typeof UIChat !== 'undefined') UIChat.toggle();
	}

    function openAddressingPanel() {
        if (typeof UIAddressing !== 'undefined') UIAddressing.toggle();
    }

    function openVLBLPanel() {
        if (typeof UIVLBL !== 'undefined') UIVLBL.toggle();
    }

    function openDevicesPanel() {
        if (typeof UIDevices !== 'undefined') UIDevices.toggle();
    }

    function openExportPanel() {
        if (typeof UIExport !== 'undefined') UIExport.toggle();
    }

    function openTrackingPanel() {
        if (typeof UITracking !== 'undefined') {
			UITracking.toggle();
        
        updateAllButtons();
		}
    }

    // ========== РУЧНЫЕ ЗАПРОСЫ ==========
    
    async function sendRCRequest() {
        if (typeof UIManual !== 'undefined') UIManual.sendRCRequest();
    }

    async function sendPTRequest() {
        if (typeof UIManual !== 'undefined') UIManual.sendPTRequest();
    }

    // ========== КОНСОЛЬ ==========
    
    function toggleConsole() {
        if (typeof UIConsole !== 'undefined') UIConsole.toggle();
    }

    function clearConsole() {
        if (typeof UIConsole !== 'undefined') UIConsole.clearConsole();
    }

    // ========== ЭКСПОРТ ==========
    
    function exportCSV() {
        if (typeof UIExport !== 'undefined') UIExport.exportCSV();
    }

    function exportKML() {
        if (typeof UIExport !== 'undefined') UIExport.exportKML();
    }

    function exportJSON() {
        if (typeof UIExport !== 'undefined') UIExport.exportJSON();
    }

    // ========== ТРЕКИ ==========
    
    function toggleTracks() {
        const btn = document.getElementById('btn-tracks-show');
        if (btn) {
            btn.classList.toggle('active');
            UWSettingsStorage.set('tracks.showTracks', btn.classList.contains('active'));
        }
    }

    function clearTracks() {
        if (confirm('Очистить все треки?')) {
            if (typeof Tracks !== 'undefined') {
                Tracks.clearAll();
                Tracks.clearStationTrack();
            }
            setStatus('Треки очищены');
        }
    }

    // ========== ЛИНЕЙКА ==========
    
	function toggleRuler() {
		if (typeof UIRuler !== 'undefined') {
			UIRuler.toggle();
			
			const btn = document.getElementById('btn-ruler');
			if (btn) {
				if (UIRuler.isRulerActive()) {
					btn.classList.add('active');
				} else {
					btn.classList.remove('active');
				}
			}
		}
	}

	// ========== POI ==========

	function loadPOI() {
		closeAllDropdowns();
		
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,.txt';
		input.onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			
			const reader = new FileReader();
			reader.onload = (ev) => {
				const count = POIManager.loadFromCSV(ev.target.result);
				if (count > 0) {
					addConsoleMessage(`Загружено ${count} POI`, 'success', 'POI');
					setStatus(`Загружено ${count} POI`);
					UIMap.draw();
				} else {
					alert('Не удалось загрузить POI. Проверьте формат файла.');
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	function exportPOI_CSV() {
		closeAllDropdowns();
		
		const points = POIManager.getAll();
		if (points.length === 0) {
			alert('Нет POI для экспорта');
			return;
		}
		
		const lines = ['# uWaveSuite POI Export'];
		lines.push('# Name,Latitude,Longitude,Depth,Type,Timestamp');
		lines.push('Name,Latitude,Longitude,Depth,Type,Timestamp');
		
		for (const poi of points) {
			lines.push([
				poi.name || '',
				poi.lat.toFixed(8),
				poi.lon.toFixed(8),
				poi.depth != null ? poi.depth.toFixed(1) : '',
				poi.type || 'manual',
				new Date(poi.timestamp || Date.now()).toISOString()
			].join(','));
		}
		
		const text = lines.join('\n');
		const blob = new Blob([text], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `uwave_poi_${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		
		addConsoleMessage(`Экспортировано ${points.length} POI`, 'success', 'POI');
		setStatus(`Экспортировано ${points.length} POI`);
	}

	function clearPOI() {
		closeAllDropdowns();
		
		const count = POIManager.getCount();
		if (count === 0) {
			alert('Нет POI для очистки');
			return;
		}
		
		if (confirm(`Очистить все POI (${count} шт.)?`)) {
			POIManager.clear();
			addConsoleMessage(`Удалено ${count} POI`, 'info', 'POI');
			setStatus('POI очищены');
			UIMap.draw();
		}
	}

	function markBeaconPoint(address, type = 'cdma') {
		const device = deviceManager.getDevice(address, type);
		if (!device) return;
		
		const lat = device.latitudeDeg;
		const lon = device.longitudeDeg;
		const depth = device.depthM;
		
		if (isNaN(lat) || isNaN(lon)) {
			alert('У устройства ещё нет координат');
			return;
		}
		
		const now = new Date();
		const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
		const name = `Маяк #${device.userAddress} — ${timeStr}`;
		
		POIManager.addMarkedPoint(name, lat, lon, !isNaN(depth) ? depth : null);
		
		addConsoleMessage(`POI добавлен: ${name}`, 'success', 'POI');
		setStatus(`Отмечено: ${name}`);
		
		UIMap.draw();
	}


    // ========== ТЕМА ==========
    
    function cycleTheme() {
        if (typeof Themes !== 'undefined') {
            const themeName = Themes.cycleTheme();
            setStatus('Тема: ' + themeName);
        }
    }

    // ========== ВЫПАДАЮЩИЕ МЕНЮ ==========
    
    function toggleDropdown(id) {
        const menu = document.getElementById(id);
        if (!menu) return;
        
        if (activeDropdown && activeDropdown !== menu) {
            activeDropdown.style.display = 'none';
        }
        
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            activeDropdown = null;
        } else {
            menu.style.display = 'block';
            activeDropdown = menu;
        }
    }

    function closeAllDropdowns() {
        if (activeDropdown) {
            activeDropdown.style.display = 'none';
            activeDropdown = null;
        }
    }

    // ========== ФОКУС НА УСТРОЙСТВО ==========
    
    function focusDevice(device) {
        if (typeof UIMap !== 'undefined') UIMap.followDevice(device.address, device.type);
    }

    function focusDeviceByAddress(address, type) {
        const device = deviceManager.getDevice(address, type);
        if (device) focusDevice(device);
    }

    // ========== НАСТРОЙКИ ==========
    
    function loadSettings() {
        const antennaMode = UWSettingsStorage.get('antenna.mode', 'cartesian_fixed');
        UWUSBLsolver.setAntennaMode(antennaMode);
        
        const heading = UWSettingsStorage.get('antenna.headingDeg', 0);
        const lat = UWSettingsStorage.get('antenna.latDeg', NaN);
        const lon = UWSettingsStorage.get('antenna.lonDeg', NaN);
        
        if (!isNaN(lat) && !isNaN(lon)) {
            UWUSBLsolver.setAntennaPosition(lat, lon, heading);
        }
        
        UWUSBLsolver.setSalinity(UWSettingsStorage.get('device.salinityPSU', 0));
        UWUSBLsolver.setSoundSpeed(UWSettingsStorage.get('antenna.soundSpeedMps', 1480));
        UWUSBLsolver.setAntennaOffsets(
            UWSettingsStorage.get('antenna.offsetXM', 0),
            UWSettingsStorage.get('antenna.offsetYM', 0),
            UWSettingsStorage.get('antenna.phiDeg', 0)
        );
        
        compassMode = UWSettingsStorage.get('gnss.compassMode', 'auto');
    }

    function saveSettings() {
        UWSettingsStorage.save();
    }

    // ========== ЛОГ ==========
    
    function initPlaybackControls() {
        const btnSpeedDown = document.getElementById('btn-speed-down');
        const btnSpeedUp = document.getElementById('btn-speed-up');
        
        if (btnSpeedDown) btnSpeedDown.addEventListener('click', decreasePlaybackSpeed);
        if (btnSpeedUp) btnSpeedUp.addEventListener('click', increasePlaybackSpeed);
    }

    function getCurrentSpeedIndex() {
        return PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    }

    function increasePlaybackSpeed() {
        let idx = getCurrentSpeedIndex();
        if (idx === -1) idx = 0;
        const newIdx = (idx + 1) % PLAYBACK_SPEEDS.length;
        playbackSpeed = PLAYBACK_SPEEDS[newIdx];
        updatePlaybackSpeedUI();
        setStatus(`Скорость: ${playbackSpeed}x`);
    }

    function decreasePlaybackSpeed() {
        let idx = getCurrentSpeedIndex();
        if (idx === -1) idx = 0;
        const newIdx = (idx - 1 + PLAYBACK_SPEEDS.length) % PLAYBACK_SPEEDS.length;
        playbackSpeed = PLAYBACK_SPEEDS[newIdx];
        updatePlaybackSpeedUI();
        setStatus(`Скорость: ${playbackSpeed}x`);
    }

    function updatePlaybackSpeedUI() {
        const spanSpeed = document.getElementById('playback-speed-current');
        if (spanSpeed) spanSpeed.textContent = playbackSpeed + 'x';
    }

    function togglePlayback() {
        if (isPlaying) stopPlayback();
        else startPlayback();
    }

    async function startPlayback() {
        const entries = Logger.getEntries();
        
        if (!entries || entries.length === 0) {
            alert('Нет загруженного лога.');
            return;
        }
        
        isPlaying = true;
        playbackEntries = entries;
        playbackIndex = 0;
        playbackSpeed = 1;
        
        showPlaybackControls();
        
        btnConnection.disabled = true;
        btnGnss.disabled = true;
        btnTracking.disabled = true;
        
        if (trackingEngine && trackingEngine.isActive) {
            trackingEngine.stop('Воспроизведение');
        }
        
        if (uwPort && uwPort.isOpen) {
            uwPort.serial.onMessage = null;
        }
        if (gnssBridge) {
            gnssBridge.onMessage = null;
        }
        
        setStatus('▶ Воспроизведение...');
        processNextPlaybackEntry();
    }

    function processNextPlaybackEntry() {
        if (!isPlaying) return;
        
        if (playbackIndex >= playbackEntries.length) {
            stopPlayback();
            return;
        }
        
        const entry = playbackEntries[playbackIndex];
        playbackIndex++;
        
        processPlaybackEntry(entry);
        updatePlaybackProgress();
        
        let delay = 100;
        
        if (playbackIndex < playbackEntries.length) {
            const nextEntry = playbackEntries[playbackIndex];
            const timeDiff = nextEntry.timestamp - entry.timestamp;
            
            if (timeDiff > 0 && timeDiff < 60000) {
                delay = timeDiff / playbackSpeed;
            }
        }
        
        delay = Math.min(delay, 5000);
        delay = Math.max(delay, 10);
        
        playbackTimer = setTimeout(processNextPlaybackEntry, delay);
    }

    function processPlaybackEntry(entry) {
        if (!entry || !entry.data) return;
        
        const gnssData = GNSSParser.parse(entry.data);
        if (gnssData) {
            processGNSSData(gnssData);
            return;
        }
        
        const parsed = UWProtocol.parse(entry.data);
        if (parsed && parsed.valid) {
            processUWData(parsed);
        }
    }

    function processGNSSData(data) {
        if (UWSettingsStorage.get('antenna.mode') === 'cartesian_fixed') return;
        
        if (data.type === 'rmc' && !isNaN(data.latitude) && !isNaN(data.longitude)) {
            UWUSBLsolver.setAntennaPosition(
                data.latitude,
                data.longitude,
                UWSettingsStorage.get('antenna.headingDeg', 0)
            );
            
            if (!isNaN(data.speedMps)) {
                UWUSBLsolver.setSpeedCourse(data.speedMps, data.course);
            }
            
            updateAntennaInfo();
            
        } else if (data.type === 'hdt' && !isNaN(data.heading)) {
            hasTrueHeading = true;
            UWSettingsStorage.set('antenna.headingDeg', data.heading);
            
            const lat = UWSettingsStorage.get('antenna.latDeg', NaN);
            const lon = UWSettingsStorage.get('antenna.lonDeg', NaN);
            
            if (!isNaN(lat) && !isNaN(lon)) {
                UWUSBLsolver.setAntennaPosition(lat, lon, data.heading);
            }
            
            updateAntennaInfo();
            
        } else if (data.type === 'hdm' && !isNaN(data.heading)) {
            if (shouldUseHeading('hdm')) {
                UWSettingsStorage.set('antenna.headingDeg', data.heading);
                
                const lat = UWSettingsStorage.get('antenna.latDeg', NaN);
                const lon = UWSettingsStorage.get('antenna.lonDeg', NaN);
                
                if (!isNaN(lat) && !isNaN(lon)) {
                    UWUSBLsolver.setAntennaPosition(lat, lon, data.heading);
                }
                
                updateAntennaInfo();
            }
        }
    }

    function processUWData(parsed) {
        switch (parsed.ic) {
            case UWProtocol.ICs.IC_D2H_RC_RESPONSE:
                handleRCResponse(parsed);
                break;
            case UWProtocol.ICs.IC_D2H_RC_TIMEOUT:
                handleRCTimeout(parsed);
                break;
            case UWProtocol.ICs.IC_D2H_RC_ASYNC_IN:
                handleRCAsyncIn(parsed);
                break;
            case UWProtocol.ICs.IC_D2H_AMB_DTA:
                handleSensorData(parsed);
                break;
            case UWProtocol.ICs.IC_D2H_DINFO:
                handleDeviceInfo(parsed);
                break;
            case UWProtocol.ICs.IC_D2H_PT_RCVD:
                handlePacketReceived(parsed);
                break;
        }
    }

    function stopPlayback() {
        isPlaying = false;
        
        if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        
        hidePlaybackControls();
        
        btnConnection.disabled = false;
        btnGnss.disabled = false;
        updateAllButtons();
        
        if (uwPort && uwPort.isOpen) {
            uwPort.serial.onMessage = (line) => uwPort._onNMEAMessage(line);
        }
        if (gnssBridge) {
            gnssBridge.onMessage = onGnssMessage;
        }
        
        setStatus('Воспроизведение завершено');
    }

    function showPlaybackControls() {
        const progress = document.getElementById('playback-progress');
        const speedControl = document.getElementById('playback-speed-control');
        
        if (progress) progress.style.display = 'block';
        if (speedControl) speedControl.style.display = 'flex';
        
        updatePlaybackSpeedUI();
    }

    function hidePlaybackControls() {
        const progress = document.getElementById('playback-progress');
        const speedControl = document.getElementById('playback-speed-control');
        
        if (progress) progress.style.display = 'none';
        if (speedControl) speedControl.style.display = 'none';
    }

    function updatePlaybackProgress() {
        const progressFill = document.getElementById('playback-progress-fill');
        if (!progressFill) return;
        
        const total = playbackEntries.length;
        const current = playbackIndex;
        const percent = total > 0 ? (current / total * 100) : 0;
        
        progressFill.style.width = percent + '%';
    }

    async function loadLog() {
        closeAllDropdowns();
        
        if (isPlaying) stopPlayback();
        
        try {
            const count = await Logger.loadLogFromFile();
            if (count > 0) setStatus(`Загружено ${count} записей`);
        } catch (e) {
            console.error('[App] Ошибка загрузки лога:', e);
            setStatus('Ошибка загрузки лога');
        }
    }

    function saveLog() {
        if (Logger.getEntryCount() === 0) {
            alert('Нет данных для сохранения');
            return;
        }
        
        Logger.downloadLog();
        setStatus('Лог сохранён');
    }

    // ========== УТИЛИТЫ ==========
    
    function setStatus(msg) {
        if (statusText) statusText.textContent = msg;
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        connectSerial,
        disconnectSerial,
        connectGNSS,
        disconnectGNSS,
        startTracking,
        stopTracking,
        toggleTracking,
        toggleConnection,
        toggleGNSS,
        openSettings,
        closeSettings,
        applySettings,
        clearDevices,
        toggleTopoPanel,
        applyTopoBinding,
        clearTopoBinding,
        getPhoneGPS,
        toggleChatPanel,
        openAddressingPanel,
        openVLBLPanel,
        openDevicesPanel,
        openExportPanel,
        openTrackingPanel,
        sendRCRequest,
        sendPTRequest,
        toggleConsole,
        clearConsole,
        exportCSV,
        exportKML,
        exportJSON,
        toggleTracks,
        clearTracks,
        toggleRuler,
        cycleTheme,
        toggleDropdown,
        closeAllDropdowns,
        focusDevice,
        focusDeviceByAddress,
        togglePlayback,
        startPlayback,
        stopPlayback,
        increasePlaybackSpeed,
        decreasePlaybackSpeed,
		loadPOI,
		exportPOI_CSV,
		clearPOI,
		markBeaconPoint,
		updateAntennaInfo,
		updateDevicesBar,
		updateAllButtons,
        loadLog,
        saveLog,
        getState: () => ({
            isConnected,
            isGnssConnected,
            version: APP_VERSION,
            trackingActive: trackingEngine ? trackingEngine.isActive : false,
            deviceCount: deviceManager ? deviceManager.getAllDevices().length : 0
        }),
        getPort: () => uwPort,
        getQueueManager: () => queueManager,
        getDeviceManager: () => deviceManager,
        getTrackingEngine: () => trackingEngine,
        getMap: () => UIMap,
        APP_VERSION,
        APP_NAME
    };

})();

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    try {
        UWApp.init();        
    } catch (err) {
        console.error('[uWaveSuite] Ошибка инициализации:', err);
        console.error(err.stack);
    }
});