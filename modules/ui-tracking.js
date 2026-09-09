// modules/ui-tracking.js — Панель управления трекингом uWaveSuite

const UITracking = (() => {

    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    let stats = {
        cycles: 0,
        requests: 0,
        successful: 0,
        failed: 0,
        timeouts: 0,
        startTime: null,
        lastCycleTime: null
    };

    function init(panelId = 'tracking-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UITracking] Panel not found');
            return;
        }
        
        initEventHandlers();
        updateDeviceList();
        updateStats();
        subscribeToTrackingEvents();
    }

    function initEventHandlers() {
        const btnStart = panel.querySelector('#tracking-btn-start');
        const btnStop = panel.querySelector('#tracking-btn-stop');
        const btnPause = panel.querySelector('#tracking-btn-pause');
        const btnAdd = panel.querySelector('#tracking-btn-add');
        const btnClear = panel.querySelector('#tracking-btn-clear');
        
        if (btnStart) btnStart.addEventListener('click', () => startTracking());
        if (btnStop) btnStop.addEventListener('click', () => stopTracking());
        if (btnPause) btnPause.addEventListener('click', () => togglePause());
        if (btnAdd) btnAdd.addEventListener('click', () => addDevice());
        if (btnClear) btnClear.addEventListener('click', () => clearDevices());
        
        // Режим адресации
        const modeSelect = panel.querySelector('#tracking-mode');
        const cdmaAdd = panel.querySelector('#tracking-add-cdma');
        const logicalAdd = panel.querySelector('#tracking-add-logical');
        
        if (modeSelect) {
            modeSelect.value = UWSettingsStorage.get('tracking.mode', 'cdma');
            
            modeSelect.addEventListener('change', () => {
                const mode = modeSelect.value;
                UWSettingsStorage.set('tracking.mode', mode);
                UWSettingsStorage.save();
                
                if (cdmaAdd) cdmaAdd.style.display = mode === 'cdma' ? 'block' : 'none';
                if (logicalAdd) logicalAdd.style.display = mode === 'logical' ? 'block' : 'none';
                
                const engine = getTrackingEngine();
                if (engine) engine.setConfig({ mode });
            });
            
            if (cdmaAdd) cdmaAdd.style.display = modeSelect.value === 'cdma' ? 'block' : 'none';
            if (logicalAdd) logicalAdd.style.display = modeSelect.value === 'logical' ? 'block' : 'none';
        }
        
        // Интервал
        const intervalInput = panel.querySelector('#tracking-interval');
        if (intervalInput) {
            intervalInput.value = UWSettingsStorage.get('tracking.intervalMs', 2000);
            intervalInput.addEventListener('change', () => {
                const interval = parseInt(intervalInput.value);
                if (interval >= 100) {
                    UWSettingsStorage.set('tracking.intervalMs', interval);
                    UWSettingsStorage.save();
                    
                    const engine = getTrackingEngine();
                    if (engine && engine.isActive) engine.setInterval(interval);
                }
            });
        }
        
        // Режим команд
        const commandModeSelect = panel.querySelector('#tracking-command-mode');
        if (commandModeSelect) {
            commandModeSelect.value = UWSettingsStorage.get('tracking.commandMode', 'weighted');
            commandModeSelect.addEventListener('change', () => {
                UWSettingsStorage.set('tracking.commandMode', commandModeSelect.value);
                UWSettingsStorage.save();
                
                const engine = getTrackingEngine();
                if (engine) engine.setConfig({ commandMode: commandModeSelect.value });
            });
        }
        
        // Enter в поле адреса
        const addInput = panel.querySelector('#tracking-add-address');
        if (addInput) {
            addInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addDevice();
            });
        }
    }

    function subscribeToTrackingEvents() {
        const engine = getTrackingEngine();
        if (!engine) return;
        
        engine.addEventListener('started', () => {
            stats.startTime = Date.now();
            updateButtons();
            updateStats();
        });
        
        engine.addEventListener('stopped', () => {
            stats.startTime = null;
            updateButtons();
            updateStats();
        });
        
        engine.addEventListener('paused', () => updateButtons());
        engine.addEventListener('resumed', () => updateButtons());
        
        engine.addEventListener('cycleCompleted', (e) => {
            stats.cycles = e.detail.cycle;
            stats.lastCycleTime = Date.now();
            updateStats();
        });
        
        engine.addEventListener('result', () => {
            stats.successful++;
            updateStats();
        });
        
        engine.addEventListener('error', () => {
            stats.failed++;
            updateStats();
        });
        
        engine.addEventListener('requesting', () => {
            stats.requests++;
            updateStats();
        });
    }

    function open() {
        if (!panel) return;
        panel.style.display = 'block';
        isOpen = true;
        updateDeviceList();
        updateStats();
        updateButtons();
        notifyListeners('open');
    }

    function close() {
        if (!panel) return;
        panel.style.display = 'none';
        isOpen = false;
        notifyListeners('close');
    }

    function toggle() {
        if (isOpen) close();
        else open();
    }

    function startTracking() {
        const engine = getTrackingEngine();
        if (!engine) return;
        
        engine.setConfig({
            devices: UWSettingsStorage.get('tracking.devices', []),
            intervalMs: UWSettingsStorage.get('tracking.intervalMs', 2000),
            commands: UWSettingsStorage.get('tracking.commands', []),
            commandMode: UWSettingsStorage.get('tracking.commandMode', 'weighted'),
            mode: UWSettingsStorage.get('tracking.mode', 'cdma')
        });
        
        engine.start();
        updateButtons();
    }

    function stopTracking() {
        const engine = getTrackingEngine();
        if (!engine) return;
        engine.stop('Остановлено пользователем');
        updateButtons();
    }

    function togglePause() {
        const engine = getTrackingEngine();
        if (!engine) return;
        
        if (engine.isPaused) engine.resume();
        else engine.pause();
        
        updateButtons();
    }

    function addDevice() {
        if (!panel) return;
        
        const mode = UWSettingsStorage.get('tracking.mode', 'cdma');
        
        if (mode === 'cdma') {
            const txInput = panel.querySelector('#tracking-add-tx-ch');
			const rxInput = panel.querySelector('#tracking-add-rx-ch');
			
			const txCh = parseInt(txInput.value);
			const rxCh = parseInt(rxInput.value);
			
			UWSettingsStorage.addTrackingDevice(txCh, 'cdma', rxCh);
			UWSettingsStorage.save();
			
			const engine = getTrackingEngine();
			if (engine && engine.isActive) {
				engine.addDevice(txCh, 'cdma', rxCh);
			}
			
			showStatus(`Tx=${txCh} Rx=${rxCh} добавлены`, 'success');
        } else {
            const addrInput = panel.querySelector('#tracking-add-address');
            if (!addrInput) return;
            
            const address = parseInt(addrInput.value);
            
            if (isNaN(address) || address < 0 || address > 254) {
                showStatus('Адрес должен быть 0-254', 'error');
                return;
            }
            
            UWSettingsStorage.addTrackingDevice(address, 'logical');
            UWSettingsStorage.save();
            
            const engine = getTrackingEngine();
            if (engine && engine.isActive) engine.addDevice(address, 'logical');
            
            showStatus(`Адрес #${address} добавлен`, 'success');
        }
        
        updateDeviceList();
    }

	function removeDevice(address, type, rxChID) {
		UWSettingsStorage.removeTrackingDevice(address, type, rxChID);
		UWSettingsStorage.save();
		
		const engine = getTrackingEngine();
		if (engine && engine.isActive) {
			engine.removeDevice(address, type, rxChID);
		}
		
		updateDeviceList();
		showStatus(`Устройство удалено`, 'info');
	}

    function clearDevices() {
        if (!confirm('Удалить все устройства из трекинга?')) return;
        
        const devices = UWSettingsStorage.get('tracking.devices', []);
        
        for (const device of devices) {
            UWSettingsStorage.removeTrackingDevice(device.address, device.type);
        }
        
        UWSettingsStorage.save();
        
        const engine = getTrackingEngine();
        if (engine && engine.isActive) engine.setConfig({ devices: [] });
        
        updateDeviceList();
        showStatus('Все устройства удалены', 'info');
    }

    function updateDeviceList() {
        if (!panel) return;
        
        const list = panel.querySelector('#tracking-devices-list');
        if (!list) return;
        
        const devices = UWSettingsStorage.get('tracking.devices', []);
        
        if (devices.length === 0) {
            list.innerHTML = '<span style="color:var(--text-muted);">Нет устройств</span>';
            return;
        }
        
		 list.innerHTML = devices.map((device) => {
			const label = device.type === 'logical' 
				? `#${device.address}` 
				: `Tx=${device.address} Rx=${device.rxChID !== undefined ? device.rxChID : device.address}`;
			
			const rxParam = device.rxChID !== undefined ? device.rxChID : device.address;
			
			return `
				<div class="tracking-device-tag">
					${label}
					<button onclick="UITracking.removeDevice(${device.address}, '${device.type}', ${rxParam})" title="Удалить">✕</button>
				</div>
			`;
		}).join('');
    }

    function updateStats() {
        if (!panel) return;
        
        const statsEl = panel.querySelector('#tracking-stats');
        if (!statsEl) return;
        
        const engine = getTrackingEngine();
        let engineStats = engine ? engine.getStats() : null;
        
        const uptime = stats.startTime 
            ? Math.floor((Date.now() - stats.startTime) / 1000) 
            : 0;
        
        statsEl.innerHTML = `
            <div class="tracking-stat-row"><span>Циклов:</span><span>${engineStats ? engineStats.cycles : stats.cycles}</span></div>
            <div class="tracking-stat-row"><span>Запросов:</span><span>${engineStats ? engineStats.requests : stats.requests}</span></div>
            <div class="tracking-stat-row"><span>Успешно:</span><span style="color:var(--border-success);">${engineStats ? engineStats.successful : stats.successful}</span></div>
            <div class="tracking-stat-row"><span>Ошибок:</span><span style="color:var(--border-danger);">${engineStats ? engineStats.failed : stats.failed}</span></div>
            <div class="tracking-stat-row"><span>Таймаутов:</span><span style="color:var(--border-warning);">${engineStats ? engineStats.timeouts : stats.timeouts}</span></div>
            <div class="tracking-stat-row"><span>Устройств:</span><span>${UWSettingsStorage.get('tracking.devices', []).length}</span></div>
            <div class="tracking-stat-row"><span>Время:</span><span>${formatUptime(uptime)}</span></div>
        `;
    }

    function updateButtons() {
        if (!panel) return;
        
        const engine = getTrackingEngine();
        const btnStart = panel.querySelector('#tracking-btn-start');
        const btnStop = panel.querySelector('#tracking-btn-stop');
        const btnPause = panel.querySelector('#tracking-btn-pause');
        
        if (!engine) return;
        
        if (engine.isActive) {
            if (btnStart) btnStart.disabled = true;
            if (btnStop) btnStop.disabled = false;
            if (btnPause) {
                btnPause.disabled = false;
                btnPause.textContent = engine.isPaused ? '▶ Возобновить' : '⏸ Пауза';
            }
        } else {
            if (btnStart) btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
            if (btnPause) {
                btnPause.disabled = true;
                btnPause.textContent = '⏸ Пауза';
            }
        }
    }

    function formatUptime(seconds) {
        if (seconds < 60) return `${seconds}с`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}м ${seconds % 60}с`;
        const hours = Math.floor(minutes / 60);
        return `${hours}ч ${minutes % 60}м`;
    }

    function showStatus(message, type = 'info') {
        if (!panel) return;
        const statusEl = panel.querySelector('#tracking-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = 'tracking-status ' + type;
    }

    function getTrackingEngine() {
        if (window.UWApp && window.UWApp.getTrackingEngine) {
            return window.UWApp.getTrackingEngine();
        }
        return null;
    }

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
                console.warn('[UITracking] Ошибка слушателя:', e.message);
            }
        }
    }

    return {
        init,
        open,
        close,
        toggle,
        startTracking,
        stopTracking,
        togglePause,
        addDevice,
        removeDevice,
        clearDevices,
        updateDeviceList,
        updateStats,
        updateButtons,
        subscribe
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITracking;
}