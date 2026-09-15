// modules/ui-settings.js — Управление панелью настроек uWaveSuite
// Адаптировано из AzimuthWebSuite ui-settings.js

const UISettings = (() => {

    // ========== DOM ЭЛЕМЕНТЫ ==========
    let overlay, modal;
    let listeners = [];
    
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(overlayId = 'settings-overlay') {
        overlay = document.getElementById(overlayId);
        modal = overlay ? overlay.querySelector('#settings-modal') : null;
        
        if (!overlay || !modal) {
            console.warn('[UISettings] Overlay or modal not found');
            return;
        }
        
        // Закрытие по клику на фон
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close();
            }
        });
        
        // Закрытие по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) {
                close();
            }
        });
        
        // Инициализация списка устройств трекинга
        initTrackingDevicesList();
    }

    function initTrackingDevicesList() {
        const list = document.getElementById('tracking-devices-list');
        if (list) {
            updateTrackingDevicesList();
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!overlay) return;
        
        // Обновляем поля из настроек
        updateFieldsFromSettings();
        
        // Обновляем список устройств
        updateTrackingDevicesList();
        
        overlay.classList.add('visible');
        overlay.style.display = 'flex';
        
        notifyListeners('open');
    }

    function close() {
        if (!overlay) return;
        
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
        
        notifyListeners('close');
    }

    function isOpen() {
        return overlay && overlay.classList.contains('visible');
    }

    function toggle() {
        if (isOpen()) {
            close();
        } else {
            open();
        }
    }

    // ========== ОБНОВЛЕНИЕ ПОЛЕЙ ==========
    
    function updateFieldsFromSettings() {
        // Устройство
        setValue('cfg-tx-ch', UWSettingsStorage.get('device.txChID', 0));
        setValue('cfg-rx-ch', UWSettingsStorage.get('device.rxChID', 0));
        setValue('cfg-salinity', UWSettingsStorage.get('device.salinityPSU', 0));
		setValue('cfg-gravity', UWSettingsStorage.get('device.gravityAcc', 9.8));
		
		const cmdModeEl = document.getElementById('cfg-cmd-mode-default');
		if (cmdModeEl) {
			cmdModeEl.checked = UWSettingsStorage.get('device.isCmdMode', true);
		}
        
        const soundSpeed = UWSettingsStorage.get('antenna.soundSpeedMps', NaN);
        const soundSpeedAuto = UWSettingsStorage.get('antenna.soundSpeedAuto', true);
        setValue('cfg-soundspeed', soundSpeedAuto ? '' : soundSpeed);
        
        // GNSS
        setValue('cfg-compass-mode', UWSettingsStorage.get('gnss.compassMode', 'auto'));
        setValue('cfg-gnss-baud', UWSettingsStorage.get('gnss.baudRate', 38400));
        
        // Антенна
        setValue('cfg-antenna-mode', UWSettingsStorage.get('antenna.mode', 'cartesian_fixed'));
        setValue('cfg-offsetx', UWSettingsStorage.get('antenna.offsetXM', 0));
        setValue('cfg-offsety', UWSettingsStorage.get('antenna.offsetYM', 0));
        setValue('cfg-phi', UWSettingsStorage.get('antenna.phiDeg', 0));
        setValue('cfg-max-speed', UWSettingsStorage.get('antenna.maxBeaconSpeedMps', 2));
        
        // Треки
        setValue('cfg-maxpoints', UWSettingsStorage.get('tracks.maxPointsPerTrack', 500));
        setValue('cfg-minpointdist', UWSettingsStorage.get('tracks.minPointDistanceM', 0.5));
    }

    function updateTrackingDevicesList() {
        const list = document.getElementById('tracking-devices-list');
        if (!list) return;
        
        const devices = UWSettingsStorage.get('tracking.devices', []);
        
        if (devices.length === 0) {
            list.innerHTML = '<span style="color:var(--text-muted);">Нет устройств</span>';
            return;
        }
        
        list.innerHTML = devices.map((device, index) => {
            const label = device.type === 'logical' 
                ? `Addr ${device.address}` 
                : `Ch ${device.address}`;
            
            return `
                <div class="tracking-device-tag">
                    ${label}
                    <button onclick="UISettings.removeTrackingDeviceByIndex(${index})" title="Удалить">✕</button>
                </div>
            `;
        }).join('');
    }

    function removeTrackingDeviceByIndex(index) {
        const devices = UWSettingsStorage.get('tracking.devices', []);
        if (index >= 0 && index < devices.length) {
            const device = devices[index];
            UWSettingsStorage.removeTrackingDevice(device.address, device.type);
            updateTrackingDevicesList();
            
            // Обновляем трекинг если активен
            if (window.UWApp && window.UWApp.getTrackingEngine) {
                const engine = window.UWApp.getTrackingEngine();
                if (engine && engine.isActive) {
                    engine.removeDevice(device.address, device.type);
                }
            }
        }
    }

    // ========== ПОЛУЧЕНИЕ ЗНАЧЕНИЙ ==========
    
    function getValue(id, defaultValue = '') {
        const el = document.getElementById(id);
        return el ? el.value : defaultValue;
    }

    function getInt(id, defaultValue = 0) {
        const val = parseInt(getValue(id, defaultValue));
        return isNaN(val) ? defaultValue : val;
    }

    function getFloat(id, defaultValue = 0) {
        const val = parseFloat(getValue(id, defaultValue));
        return isNaN(val) ? defaultValue : val;
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
        }
    }

    // ========== ПРИМЕНЕНИЕ НАСТРОЕК ==========
    
	function applySettings() {
		const txCh = getInt('cfg-tx-ch', 0);
		const rxCh = getInt('cfg-rx-ch', 0);
		const salinity = getFloat('cfg-salinity', 0);
		
		const soundSpeedVal = getValue('cfg-soundspeed', '');
		const soundSpeed = soundSpeedVal ? parseFloat(soundSpeedVal) : NaN;
		
		const compassMode = getValue('cfg-compass-mode', 'auto');
		const gnssBaud = getInt('cfg-gnss-baud', 38400);
		
		const antennaMode = getValue('cfg-antenna-mode', 'cartesian_fixed');
		const offsetX = getFloat('cfg-offsetx', 0);
		const offsetY = getFloat('cfg-offsety', 0);
		const phi = getFloat('cfg-phi', 0);
		const maxSpeed = getFloat('cfg-max-speed', 2);
		
		const maxPoints = getInt('cfg-maxpoints', 500);
		const minPointDist = getFloat('cfg-minpointdist', 0.5);
		
		const cmdModeEl = document.getElementById('cfg-cmd-mode-default');
		const isCmdMode = cmdModeEl ? cmdModeEl.checked : true;

		const gravityAcc = getFloat('cfg-gravity', 9.8);

		UWSettingsStorage.setDeviceSettings({
			txChID: txCh,
			rxChID: rxCh,
			salinityPSU: salinity,
			gravityAcc: gravityAcc,
			isCmdMode: isCmdMode
		});
		
		UWSettingsStorage.setAntennaSettings({
			soundSpeedMps: isNaN(soundSpeed) ? 1480 : soundSpeed,
			soundSpeedAuto: isNaN(soundSpeed),
			mode: antennaMode,
			offsetXM: offsetX,
			offsetYM: offsetY,
			phiDeg: phi,
			maxBeaconSpeedMps: maxSpeed
		});
		
		UWSettingsStorage.setGNSettings({
			compassMode: compassMode,
			baudRate: gnssBaud
		});
		
		UWSettingsStorage.set('tracks.maxPointsPerTrack', maxPoints);
		UWSettingsStorage.set('tracks.minPointDistanceM', minPointDist);
		UWSettingsStorage.save();
		
		if (window.UWUSBLsolver) {
			UWUSBLsolver.setAntennaMode(antennaMode);
			UWUSBLsolver.setSalinity(salinity);
			UWUSBLsolver.setSoundSpeed(isNaN(soundSpeed) ? 1480 : soundSpeed);
			UWUSBLsolver.setSoundSpeedAuto(isNaN(soundSpeed));
			UWUSBLsolver.setAntennaOffsets(offsetX, offsetY, phi);
			UWUSBLsolver.setMaxBeaconSpeed(maxSpeed);
		}
		
		if (window.Tracks) {
			Tracks.setMaxPoints(maxPoints);
			Tracks.setMinDistance(minPointDist);
		}
		
		// Отправляем настройки устройству
		if (window.UWApp && window.UWApp.getPort) {
			const port = window.UWApp.getPort();
			if (port && port.isOpen && port.detected) {
				const sent = port.querySettingsWrite(
					txCh, rxCh, salinity,
					isCmdMode,
					UWSettingsStorage.get('device.isACKOnTXFinished', false),
					gravityAcc
				);
				
				if (!sent) {
					console.warn('[UISettings] Не удалось отправить настройки');
				}
			}
		}
		
		notifyListeners('applied');
		close();
	}

    function resetToDefaults() {
        UWSettingsStorage.reset();
        updateFieldsFromSettings();
        updateTrackingDevicesList();
        notifyListeners('reset');
    }

    // ========== УПРАВЛЕНИЕ ТРЕКИНГ-УСТРОЙСТВАМИ ==========
    
    function addTrackingDevice() {
        const input = document.getElementById('cfg-add-tracking-device');
        if (!input) return;
        
        const address = parseInt(input.value);
        if (isNaN(address) || address < 0) {
            alert('Введите корректный адрес (0-255)');
            return;
        }
        
        // Определяем тип адресации
        const addressingMode = UWSettingsStorage.get('cdma.addressingMode', 'cdma');
        const type = addressingMode === 'logical' ? 'logical' : 'cdma';
        
        UWSettingsStorage.addTrackingDevice(address, type);
        UWSettingsStorage.save();
        
        // Обновляем список
        updateTrackingDevicesList();
        
        // Обновляем трекинг если активен
        if (window.UWApp && window.UWApp.getTrackingEngine) {
            const engine = window.UWApp.getTrackingEngine();
            if (engine && engine.isActive) {
                engine.addDevice(address, type);
            }
        }
        
        input.value = '';
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
                console.warn('[UISettings] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        isOpen,
        applySettings,
        resetToDefaults,
        updateFieldsFromSettings,
        updateTrackingDevicesList,
        addTrackingDevice,
        removeTrackingDeviceByIndex,
        getValue,
        getInt,
        getFloat,
        setValue,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UISettings;
}