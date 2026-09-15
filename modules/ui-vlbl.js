// modules/ui-vlbl.js — Панель VLBL навигации uWaveSuite
// Автоматический сбор измерений и решение дальномерной задачи
// Работает через Worker в фоне

const UIVLBL = (() => {

    let panel = null;
    let listeners = [];
    let isOpen = false;
    let isActive = false;           // VLBL режим включен
    
    // Worker
    let worker = null;
    let solveRequestCounter = 0;
    const pendingSolveRequests = new Map();
    
    // Авторешение
    let lastAutoSolveTime = {};
    let lastAutoSolveCount = {};
    
    // Настройки
    let config = {
        autoSolveCount: 10,
        autoSolveMinIntervalMs: 3000,
        baseSize: 4,
        maxMeasurements: 200,
        minDistanceM: 5,
        enabled: false
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'vlbl-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIVLBL] Panel not found');
            return;
        }
        
        loadConfig();
        initEventHandlers();
        initWorker();
        updateUI();
    }

    function initEventHandlers() {
        const btnToggle = panel.querySelector('#vlbl-btn-toggle');
        const btnClear = panel.querySelector('#vlbl-btn-clear');
        
        if (btnToggle) btnToggle.addEventListener('click', toggleVLBL);
        if (btnClear) btnClear.addEventListener('click', clearAll);
        
        // Настройки
        const autoCountInput = panel.querySelector('#vlbl-auto-count');
        const minIntervalInput = panel.querySelector('#vlbl-min-interval');
        const baseSizeInput = panel.querySelector('#vlbl-base-size');
        const maxMeasInput = panel.querySelector('#vlbl-max-meas');
        const minDistInput = panel.querySelector('#vlbl-min-dist');
        
        if (autoCountInput) {
            autoCountInput.value = config.autoSolveCount;
            autoCountInput.addEventListener('change', () => {
                config.autoSolveCount = parseInt(autoCountInput.value) || 10;
                saveConfig();
            });
        }
        
        if (minIntervalInput) {
            minIntervalInput.value = config.autoSolveMinIntervalMs;
            minIntervalInput.addEventListener('change', () => {
                config.autoSolveMinIntervalMs = parseInt(minIntervalInput.value) || 3000;
                saveConfig();
            });
        }
        
        if (baseSizeInput) {
            baseSizeInput.value = config.baseSize;
            baseSizeInput.addEventListener('change', () => {
                config.baseSize = parseInt(baseSizeInput.value) || 4;
                UWVLBStore.setBaseSize(config.baseSize);
                saveConfig();
            });
        }
        
        if (maxMeasInput) {
            maxMeasInput.value = config.maxMeasurements;
            maxMeasInput.addEventListener('change', () => {
                config.maxMeasurements = parseInt(maxMeasInput.value) || 200;
                UWVLBStore.setMaxMeasurementsPerBeacon(config.maxMeasurements);
                saveConfig();
            });
        }
        
        if (minDistInput) {
            minDistInput.value = config.minDistanceM;
            minDistInput.addEventListener('change', () => {
                config.minDistanceM = parseFloat(minDistInput.value) || 5;
                UWVLBStore.setMinStationPointDistance(config.minDistanceM);
                saveConfig();
            });
        }
    }

    function initWorker() {
        if (!window.Worker) {
            console.warn('[UIVLBL] Web Worker не поддерживается');
            return;
        }
        
        try {
            worker = new Worker('uw-vlbl-worker.js');
            worker.onmessage = onWorkerMessage;
            worker.onerror = (e) => {
                console.error('[UIVLBL Worker] Ошибка:', e.message);
                pendingSolveRequests.clear();
            };
        } catch (e) {
            console.warn('[UIVLBL] Worker недоступен:', e.message);
            worker = null;
        }
    }

    function onWorkerMessage(e) {
        const { action, requestId, result, error, results, errors } = e.data;

        if (action === 'solve_result') {
            const pending = pendingSolveRequests.get(requestId);
            if (pending) {
                const { addr } = pending;
                pendingSolveRequests.delete(requestId);
                handleSolution(addr, result);
            }
        } else if (action === 'solve_error') {
            console.warn('[UIVLBL Worker] Ошибка решения:', error);
            pendingSolveRequests.delete(requestId);
        } else if (action === 'solve_all_result') {
            for (const addr in results) {
                handleSolution(addr, results[addr]);
            }
            for (const addr in errors) {
                console.warn(`[UIVLBL] Маяк #${addr}: ${errors[addr]}`);
            }
            pendingSolveRequests.delete(requestId);
            updateDevicesList();
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        panel.style.display = 'block';
        isOpen = true;
        updateUI();
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

    // ========== ТУМБЛЕР ==========
    
    function toggleVLBL() {
        isActive = !isActive;
        config.enabled = isActive;
        saveConfig();
        
        if (isActive) {
            addConsoleMessage('VLBL режим включен', 'info', 'VLBL');
        } else {
            addConsoleMessage('VLBL режим выключен', 'info', 'VLBL');
        }
        
        updateUI();
        notifyListeners('toggled', { isActive });
    }

    function isVLBLActive() {
        return isActive;
    }

    // ========== ОБРАБОТКА ИЗМЕРЕНИЙ (вызывается из app.js) ==========
    
    function onDeviceUpdated(device) {
        if (!isActive) return;
        
        // Проверяем GNSS
        if (typeof UWUSBLsolver === 'undefined') return;
        
        const st = UWUSBLsolver.getState();
        if (isNaN(st.antennaLatDeg) || isNaN(st.antennaLonDeg)) return;
        
        // Определяем дальность
        const range = !isNaN(device.slantRangeProjectionM) && device.slantRangeProjectionM > 0
            ? device.slantRangeProjectionM
            : device.absoluteDistanceM;
        
        if (isNaN(range) || range <= 0) return;
        
        // Добавляем измерение
        UWVLBStore.addMeasurement(
            device.address,
            st.antennaLatDeg,
            st.antennaLonDeg,
            st.antennaDepthM || 0,
            device.depthM || 0,
            range,
            Date.now()
        );
        
        // Авторешение
        checkAutoSolve(device.address);
        
        // Обновляем UI если панель открыта
        if (isOpen) {
            updateDevicesList();
        }
    }

    function checkAutoSolve(addr) {
        if (config.autoSolveCount === 0) return;
        
        const count = UWVLBStore.getMeasurementCount(addr);
        const lastCount = lastAutoSolveCount[addr] || 0;
        const now = Date.now();
        const lastTime = lastAutoSolveTime[addr] || 0;
        
        if ((count - lastCount >= config.autoSolveCount) &&
            (now - lastTime >= config.autoSolveMinIntervalMs)) {
            
            const measurements = UWVLBStore.getMeasurements(addr);
            if (!measurements || !measurements.isBaseExists) return;
            
            lastAutoSolveCount[addr] = count;
            lastAutoSolveTime[addr] = now;
            
            solveBeaconAsync(addr);
        }
    }

    function solveBeaconAsync(addr) {
        const measurements = UWVLBStore.getMeasurements(addr);
        if (!measurements || !measurements.isBaseExists) return;
        
        try {
            const base = measurements.getBase();
            if (base.length < 3) return;
            
            const deviceManager = getDeviceManager();
            const device = deviceManager ? deviceManager.getDevice(addr, 'cdma') : null;
            const beaconDepth = device && !isNaN(device.depthM) ? device.depthM : 0;
            
            const prevSolution = UWVLBStore.getSolution(addr);
            
            const bases = base.map(m => ({ 
                lat: m.lat, 
                lon: m.lon, 
                depth: m.depth, 
                range: m.range 
            }));
            
            if (worker) {
                const requestId = `solve_${++solveRequestCounter}_${addr}`;
                pendingSolveRequests.set(requestId, { addr });
                
                worker.postMessage({
                    action: 'solve',
                    data: {
                        requestId,
                        bases,
                        prevLat: prevSolution ? prevSolution.latDeg : NaN,
                        prevLon: prevSolution ? prevSolution.lonDeg : NaN,
                        beaconDepth,
                        options: {}
                    }
                });
            } else {
                // Fallback — синхронно
                const result = UWVLBLsolver.locate2D(
                    bases,
                    prevSolution ? prevSolution.latDeg : NaN,
                    prevSolution ? prevSolution.lonDeg : NaN,
                    beaconDepth,
                    {}
                );
                handleSolution(addr, result);
            }
        } catch (e) {
            console.warn(`[UIVLBL] Маяк #${addr}: ${e.message}`);
        }
    }

    function handleSolution(addr, result) {
        result.depthM = result.depthM || 0;
        UWVLBStore.setSolution(addr, result);
        UWVLBStore.saveSolutionsToStorage();
        
        // Пишем в device
        const deviceManager = getDeviceManager();
        if (deviceManager) {
            const device = deviceManager.getDevice(addr, 'cdma');
            if (device) {
                device.vlbl = {
                    latDeg: result.latDeg,
                    lonDeg: result.lonDeg,
                    depthM: result.depthM,
                    radialError: result.radialError,
                    hdop: result.hdop,
                    quality: result.quality,
                    maxAngularGap: result.maxAngularGap,
                    timestamp: Date.now()
                };
                
                deviceManager._emit('deviceUpdated', device);
            }
        }
        
        // Лог
        addConsoleMessage(
            `VLBL #${addr}: ${result.latDeg.toFixed(6)}, ${result.lonDeg.toFixed(6)} ` +
            `(±${result.radialError.toFixed(1)}м, ${result.quality}, HDOP=${result.hdop?.toFixed(2) || '--'})`,
            'success', 'VLBL'
        );
        
        // Обновляем UI
        if (isOpen) updateDevicesList();
        
        notifyListeners('solved', { addr, result });
    }

    // ========== ОЧИСТКА ==========
    
    function clearAll() {
        if (!confirm('Очистить все измерения и решения VLBL?')) return;
        
        UWVLBStore.clearAll();
        UWVLBStore.clearStationTrack();
        
        lastAutoSolveTime = {};
        lastAutoSolveCount = {};
        
        updateDevicesList();
        addConsoleMessage('VLBL данные очищены', 'info', 'VLBL');
    }

    // ========== UI ==========
    
	function updateUI() {
		if (!panel) return;
		
		updateToggleButton();
		updateStatus();
		updateDevicesList();
		updateTopBarIndicator();
	}

	function updateTopBarIndicator() {
		const indicator = document.getElementById('vlbl-indicator');
		if (indicator) {
			indicator.style.display = isActive ? 'inline-block' : 'none';
		}
	}

    function updateToggleButton() {
        const btn = panel.querySelector('#vlbl-btn-toggle');
        if (!btn) return;
        
        if (isActive) {
            btn.textContent = '⏸ Выключить VLBL';
            btn.className = 'btn-reset-topo';
        } else {
            btn.textContent = '▶ Включить VLBL';
            btn.className = 'btn-get-gnss';
        }
        btn.style.width = '100%';
        btn.style.marginBottom = '16px';
    }

	function updateStatus() {
		const statusEl = panel.querySelector('#vlbl-status');
		if (!statusEl) return;
		
		// Проверяем реальное подключение GNSS
		let gnssOk = false;
		
		if (window.UWApp && window.UWApp.getState) {
			const appState = window.UWApp.getState();
			gnssOk = appState.isGnssConnected === true;
		}
		
		// Или если GNSS встроенный (телефон) — проверим свежесть данных
		if (!gnssOk && typeof UWUSBLsolver !== 'undefined') {
			const st = UWUSBLsolver.getState();
			// Свежие данные — обновлялись за последние 5 секунд
			const lastUpdate = st.lastUpdateTime || 0;
			const isFresh = (Date.now() - lastUpdate) < 5000;
			gnssOk = !isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg) && isFresh;
		}
		
		let text = '';
		let className = 'vlbl-status info';
		
		if (isActive) {
			text = 'VLBL: ВКЛ';
			if (gnssOk) {
				text += ' | GNSS: OK';
				className = 'vlbl-status success';
			} else {
				text += ' | GNSS: нет';
				className = 'vlbl-status warning';
			}
		} else {
			text = 'VLBL: ВЫКЛ';
		}
		
		statusEl.textContent = text;
		statusEl.className = className;
	}

    function updateDevicesList() {
        const listEl = panel.querySelector('#vlbl-devices-list');
        if (!listEl) return;
        
        const deviceManager = getDeviceManager();
        if (!deviceManager) {
            listEl.innerHTML = '<span style="color:var(--text-muted);">Нет устройства</span>';
            return;
        }
        
        const devices = deviceManager.getAllDevices();
        
        if (devices.length === 0) {
            listEl.innerHTML = '<span style="color:var(--text-muted);">Нет устройств в трекинге</span>';
            return;
        }
        
        listEl.innerHTML = devices.map(device => {
            const count = UWVLBStore.getMeasurementCount(device.address);
            const solution = UWVLBStore.getSolution(device.address);
            const measurements = UWVLBStore.getMeasurements(device.address);
            
            let solutionText = 'Сбор...';
            let qualityClass = '';
            
            if (solution) {
                solutionText = `${solution.latDeg.toFixed(5)}, ${solution.lonDeg.toFixed(5)}`;
                if (solution.radialError) {
                    solutionText += ` (±${solution.radialError.toFixed(1)}м)`;
                }
                qualityClass = solution.quality === 'Good' ? 'success' :
                              solution.quality === 'Fair' ? 'warning' : 'error';
            } else if (measurements && measurements.isBaseExists) {
                solutionText = 'Готово к решению';
            } else if (count > 0) {
                solutionText = `Сбор (${count})`;
            }
            
            return `
                <div style="padding:6px 4px; border-bottom:1px solid var(--border-primary);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:600; color:var(--text-accent);">#${device.userAddress || device.address}</span>
                        <span style="color:var(--text-secondary); font-size:10px;">${count} изм.</span>
                    </div>
                    <div style="font-size:10px; color:var(--text-secondary); margin-top:2px; font-family:'Consolas',monospace;">
                        ${solutionText}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========== НАСТРОЙКИ ==========
    
    function loadConfig() {
        try {
            const saved = localStorage.getItem('uwave_vlbl_config');
            if (saved) {
                config = { ...config, ...JSON.parse(saved) };
            }
        } catch (e) {}
        
        // Применяем к Store
        UWVLBStore.setBaseSize(config.baseSize);
        UWVLBStore.setMaxMeasurementsPerBeacon(config.maxMeasurements);
        UWVLBStore.setMinStationPointDistance(config.minDistanceM);
    }

    function saveConfig() {
        try {
            localStorage.setItem('uwave_vlbl_config', JSON.stringify(config));
        } catch (e) {}
    }

    // ========== ЗАВИСИМОСТИ ==========
    
    function getDeviceManager() {
        if (window.UWApp && window.UWApp.getDeviceManager) {
            return window.UWApp.getDeviceManager();
        }
        return null;
    }

    function addConsoleMessage(message, type = 'info', source = '') {
        if (typeof UIConsole !== 'undefined') {
            switch (type) {
                case 'info': UIConsole.addInfo(message, source); break;
                case 'success': UIConsole.addSuccess(message, source); break;
                case 'warning': UIConsole.addWarning(message, source); break;
                case 'error': UIConsole.addError(message, source); break;
                default: UIConsole.addInfo(message, source); break;
            }
        }
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
                console.warn('[UIVLBL] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        toggleVLBL,
        isVLBLActive,
        onDeviceUpdated,
        clearAll,
        getConfig: () => ({ ...config }),
        subscribe
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIVLBL;
}