// modules/ui-vlbl.js — Панель VLBL навигации uWaveSuite
// Автоматический сбор измерений при движении и решение дальномерной задачи

const UIVLBL = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // Базовые точки (неподвижные модемы на дне)
    let bases = [];                 // [{ address, name, lat, lon, depth, isFixed }]
    
    // Измерения дальности (автоматически собираются при движении)
    let rangeMeasurements = [];     // [{ baseAddress, range, antennaLat, antennaLon, antennaDepth, timestamp }]
    
    // Решение
    let solution = {
        baseAddress: null,
        latDeg: NaN,
        lonDeg: NaN,
        radialError: NaN,
        hdop: NaN,
        maxAngularGap: NaN,
        quality: '--',
        measurementsUsed: 0,
        lastUpdateTime: null
    };
    
    // Настройки
    let config = {
        autoCollect: true,          // Автоматический сбор измерений
        minMeasurements: 3,         // Минимум измерений для решения
        minDistanceM: 5,            // Минимальная дистанция между точками сбора
        maxMeasurements: 20,        // Максимум измерений для хранения
        soundSpeedMps: 1480,        // Скорость звука
        solverOptions: {
            maxIterations: 600,
            precisionThreshold: 1E-12,
            simplexSize: 1.0
        }
    };
    
    // Текущая позиция антенны
    let antennaPosition = {
        latDeg: NaN,
        lonDeg: NaN,
        depthM: NaN,
        headingDeg: NaN,
        lastUpdateTime: null
    };
    
    // Последняя точка сбора
    let lastCollectionPoint = {
        latDeg: NaN,
        lonDeg: NaN
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'vlbl-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIVLBL] Panel not found');
            return;
        }
        
        loadConfig();
        loadBases();
        initEventHandlers();
        updateUI();
        
        // Подписка на события
        subscribeToEvents();
    }

    function initEventHandlers() {
        const btnAdd = panel.querySelector('#vlbl-btn-add');
        const btnClear = panel.querySelector('#vlbl-btn-clear');
        const btnSolve = panel.querySelector('#vlbl-btn-solve');
        const btnAutoSolve = panel.querySelector('#vlbl-btn-auto-solve');
        const btnClearMeasurements = panel.querySelector('#vlbl-btn-clear-measurements');
        
        if (btnAdd) btnAdd.addEventListener('click', () => addBase());
        if (btnClear) btnClear.addEventListener('click', () => clearBases());
        if (btnSolve) btnSolve.addEventListener('click', () => solveForSelectedBase());
        if (btnAutoSolve) btnAutoSolve.addEventListener('click', () => toggleAutoCollect());
        if (btnClearMeasurements) btnClearMeasurements.addEventListener('click', () => clearMeasurements());
    }

    function subscribeToEvents() {
        // Подписка на обновление позиции антенны
        if (window.UWApp) {
            // Через USBL solver
            const checkAntennaPosition = () => {
                const st = UWUSBLsolver.getState();
                if (!isNaN(st.antennaLatDeg) && !isNaN(st.antennaLonDeg)) {
                    antennaPosition.latDeg = st.antennaLatDeg;
                    antennaPosition.lonDeg = st.antennaLonDeg;
                    antennaPosition.depthM = st.antennaDepthM;
                    antennaPosition.headingDeg = st.antennaHeadingDeg;
                    antennaPosition.lastUpdateTime = Date.now();
                }
            };
            
            // Запускаем проверку периодически
            setInterval(checkAntennaPosition, 1000);
        }
        
        // Подписка на результаты трекинга (для автосбора измерений)
        const deviceManager = window.UWApp ? UWApp.getDeviceManager() : null;
        if (deviceManager) {
            deviceManager.addEventListener('deviceUpdated', (e) => {
                if (config.autoCollect) {
                    handleDeviceUpdate(e.detail);
                }
            });
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

    // ========== УПРАВЛЕНИЕ БАЗАМИ ==========
    
    function addBase() {
        if (!panel) return;
        
        const address = parseInt(panel.querySelector('#vlbl-base-address')?.value || bases.length);
        const name = panel.querySelector('#vlbl-base-name')?.value || `База #${address}`;
        
        // Проверяем что база с таким адресом не существует
        if (bases.find(b => b.address === address)) {
            showStatus(`База #${address} уже существует`, 'warning');
            return;
        }
        
        const base = {
            address,
            name,
            latDeg: NaN,
            lonDeg: NaN,
            depthM: NaN,
            isFixed: false,         // Координаты неизвестны — будем решать
            measurements: []         // Измерения для этой базы
        };
        
        bases.push(base);
        saveBases();
        updateUI();
        
        showStatus(`База #${address} добавлена`, 'success');
        notifyListeners('baseAdded', base);
    }

    function removeBase(address) {
        const index = bases.findIndex(b => b.address === address);
        if (index >= 0) {
            const removed = bases.splice(index, 1)[0];
            saveBases();
            updateUI();
            showStatus(`База #${address} удалена`, 'info');
            notifyListeners('baseRemoved', removed);
        }
    }

    function clearBases() {
        if (bases.length === 0) {
            showStatus('Нет баз', 'warning');
            return;
        }
        
        if (!confirm(`Удалить все базы (${bases.length})?`)) return;
        
        bases = [];
        rangeMeasurements = [];
        saveBases();
        updateUI();
        showStatus('Все базы удалены', 'info');
    }

    // ========== АВТОМАТИЧЕСКИЙ СБОР ИЗМЕРЕНИЙ ==========
    
    function handleDeviceUpdate(device) {
        // Проверяем что это база
        const base = bases.find(b => b.address === device.address);
        if (!base) return;
        
        // Проверяем что у нас есть позиция антенны
        if (isNaN(antennaPosition.latDeg) || isNaN(antennaPosition.lonDeg)) {
            return;
        }
        
        // Проверяем что у устройства есть дальность
        if (isNaN(device.slantRangeM) && isNaN(device.absoluteDistanceM)) {
            return;
        }
        
        const range = !isNaN(device.slantRangeM) ? device.slantRangeM : device.absoluteDistanceM;
        
        // Проверяем минимальную дистанцию от последней точки сбора
        if (!isNaN(lastCollectionPoint.latDeg) && !isNaN(lastCollectionPoint.lonDeg)) {
            const dist = GeoUtils.haversineDistance(
                lastCollectionPoint.latDeg, lastCollectionPoint.lonDeg,
                antennaPosition.latDeg, antennaPosition.lonDeg
            );
            
            if (dist < config.minDistanceM) {
                return; // Слишком близко к предыдущей точке
            }
        }
        
        // Добавляем измерение
        const measurement = {
            baseAddress: base.address,
            range,
            antennaLatDeg: antennaPosition.latDeg,
            antennaLonDeg: antennaPosition.lonDeg,
            antennaDepthM: antennaPosition.depthM || 0,
            timestamp: Date.now()
        };
        
        base.measurements.push(measurement);
        rangeMeasurements.push(measurement);
        
        // Ограничиваем количество
        if (base.measurements.length > config.maxMeasurements) {
            base.measurements.shift();
        }
        
        // Обновляем точку сбора
        lastCollectionPoint.latDeg = antennaPosition.latDeg;
        lastCollectionPoint.lonDeg = antennaPosition.lonDeg;
        
        // Пытаемся решить автоматически
        if (base.measurements.length >= config.minMeasurements) {
            solveForBase(base.address, false);
        }
        
		if (isOpen) {
			updateUI();
			showStatus(`Измерение для #${base.address}: ${range.toFixed(1)} м`, 'info');
			}
    }

    function toggleAutoCollect() {
        config.autoCollect = !config.autoCollect;
        saveConfig();
        updateUI();
        
        showStatus(config.autoCollect ? 'Автосбор включен' : 'Автосбор выключен', 'info');
    }

    function clearMeasurements() {
        for (const base of bases) {
            base.measurements = [];
        }
        rangeMeasurements = [];
        lastCollectionPoint = { latDeg: NaN, lonDeg: NaN };
        
        updateUI();
        showStatus('Измерения очищены', 'info');
    }

    // ========== РЕШЕНИЕ ==========
    
    function solveForSelectedBase() {
        if (!panel) return;
        
        const select = panel.querySelector('#vlbl-solve-base');
        if (!select || select.value === '') {
            showStatus('Выберите базу', 'warning');
            return;
        }
        
        const address = parseInt(select.value);
        solveForBase(address, true);
    }

    function solveForBase(address, showAlert = true) {
        const base = bases.find(b => b.address === address);
        if (!base) return;
        
        if (base.measurements.length < config.minMeasurements) {
            if (showAlert) {
                showStatus(`Нужно минимум ${config.minMeasurements} измерений (сейчас ${base.measurements.length})`, 'warning');
            }
            return;
        }
        
        // Формируем данные для решателя
        const basePoints = base.measurements.map(m => ({
            lat: m.antennaLatDeg,
            lon: m.antennaLonDeg,
            depth: m.antennaDepthM,
            range: m.range
        }));
        
        // Глубина базы (если известна, иначе 0)
        const beaconDepth = base.depthM || 0;
        
        // Предыдущее решение
        const prevLat = base.latDeg;
        const prevLon = base.lonDeg;
        
        try {
            const result = UWVLBLsolver.locate2D(
                basePoints,
                prevLat,
                prevLon,
                beaconDepth,
                config.solverOptions
            );
            
            // Сохраняем решение
            base.latDeg = result.latDeg;
            base.lonDeg = result.lonDeg;
            base.isFixed = true;
            
            solution = {
                baseAddress: base.address,
                latDeg: result.latDeg,
                lonDeg: result.lonDeg,
                radialError: result.radialError,
                hdop: result.hdop,
                maxAngularGap: result.maxAngularGap,
                quality: result.quality,
                measurementsUsed: base.measurements.length,
                lastUpdateTime: Date.now()
            };
            
            updateUI();
            showStatus(`База #${base.address}: ${result.latDeg.toFixed(6)}, ${result.lonDeg.toFixed(6)} (±${result.radialError.toFixed(2)}м)`, 'success');
            
            notifyListeners('solved', { base, solution });
            
        } catch (error) {
            showStatus('Ошибка решения: ' + error.message, 'error');
        }
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        updateBasesList();
        updateMeasurementsList();
        updateSolutionUI();
        updateStatus();
        updateAutoCollectButton();
    }

    function updateBasesList() {
        if (!panel) return;
        
        const listEl = panel.querySelector('#vlbl-bases-list');
        if (!listEl) return;
        
        if (bases.length === 0) {
            listEl.innerHTML = '<span style="color:var(--text-muted);">Нет баз. Добавьте адреса неподвижных модемов.</span>';
            return;
        }
        
        listEl.innerHTML = bases.map(base => {
            const coords = base.isFixed 
                ? `${base.latDeg.toFixed(6)}, ${base.lonDeg.toFixed(6)}`
                : 'Не определено';
            
            return `
                <div class="vlbl-base-row">
                    <span class="vlbl-base-addr">#${base.address}</span>
                    <span class="vlbl-base-coords">${coords}</span>
                    <span class="vlbl-base-measurements">${base.measurements.length} изм.</span>
                    <button onclick="UIVLBL.removeBase(${base.address})" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;">✕</button>
                </div>
            `;
        }).join('');
        
        // Обновляем селектор для решения
        const solveSelect = panel.querySelector('#vlbl-solve-base');
        if (solveSelect) {
            solveSelect.innerHTML = '<option value="">Выберите базу...</option>' + 
                bases.map(b => `<option value="${b.address}">#${b.address} (${b.measurements.length} изм.)</option>`).join('');
        }
    }

    function updateMeasurementsList() {
        if (!panel) return;
        
        const listEl = panel.querySelector('#vlbl-measurements');
        if (!listEl) return;
        
        if (rangeMeasurements.length === 0) {
            listEl.innerHTML = '<span style="color:var(--text-muted);">Нет измерений. Плавайте вокруг баз — измерения собираются автоматически.</span>';
            return;
        }
        
        listEl.innerHTML = rangeMeasurements.slice(-10).map((m, index) => {
            return `
                <div class="vlbl-measurement-row">
                    <span>#${m.baseAddress}</span>
                    <span>${m.range.toFixed(1)} м</span>
                    <span>${m.antennaLatDeg.toFixed(5)}, ${m.antennaLonDeg.toFixed(5)}</span>
                </div>
            `;
        }).join('');
    }

    function updateSolutionUI() {
        if (!panel) return;
        
        const solutionEl = panel.querySelector('#vlbl-solution');
        if (!solutionEl) return;
        
        if (isNaN(solution.latDeg) || isNaN(solution.lonDeg)) {
            solutionEl.innerHTML = '<span style="color:var(--text-muted);">Решение не найдено</span>';
            return;
        }
        
        const qualityColor = {
            'Good': 'var(--border-success)',
            'Fair': 'var(--border-warning)',
            'Poor': 'var(--text-warning)',
            'Out_of_base': 'var(--border-danger)'
        };
        
        solutionEl.innerHTML = `
            <div class="vlbl-solution-row">
                <span>База:</span>
                <span>#${solution.baseAddress}</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Широта:</span>
                <span>${solution.latDeg.toFixed(8)}</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Долгота:</span>
                <span>${solution.lonDeg.toFixed(8)}</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Точность:</span>
                <span>±${solution.radialError.toFixed(2)} м</span>
            </div>
            <div class="vlbl-solution-row">
                <span>HDOP:</span>
                <span>${!isNaN(solution.hdop) ? solution.hdop.toFixed(2) : '--'}</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Угловой разрыв:</span>
                <span>${solution.maxAngularGap.toFixed(1)}°</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Качество:</span>
                <span style="color:${qualityColor[solution.quality] || 'var(--text-primary)'};">${solution.quality}</span>
            </div>
            <div class="vlbl-solution-row">
                <span>Измерений:</span>
                <span>${solution.measurementsUsed}</span>
            </div>
        `;
    }

    function updateStatus() {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#vlbl-status');
        if (!statusEl) return;
        
        const totalMeasurements = bases.reduce((sum, b) => sum + b.measurements.length, 0);
        
        let status = `Баз: ${bases.length}, Измерений: ${totalMeasurements}`;
        
        if (config.autoCollect) {
            status += ' | Автосбор: ВКЛ';
        }
        
        if (!isNaN(antennaPosition.latDeg) && !isNaN(antennaPosition.lonDeg)) {
            status += ' | GNSS: OK';
        } else {
            status += ' | GNSS: нет';
        }
        
        statusEl.textContent = status;
        statusEl.className = 'vlbl-status info';
    }

    function updateAutoCollectButton() {
        if (!panel) return;
        
        const btn = panel.querySelector('#vlbl-btn-auto-solve');
        if (!btn) return;
        
        btn.textContent = config.autoCollect ? '⏸ Автосбор: ВКЛ' : '▶ Автосбор: ВЫКЛ';
        btn.className = config.autoCollect ? 'btn-reset-topo' : 'btn-apply-topo';
        btn.style.width = '100%';
        btn.style.marginTop = '8px';
    }

    // ========== СТАТУС ==========
    
    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#vlbl-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'vlbl-status ' + type;
    }

    // ========== ЗАГРУЗКА/СОХРАНЕНИЕ ==========
    
    function loadConfig() {
        try {
            const saved = localStorage.getItem('uwave_vlbl_config');
            if (saved) {
                config = { ...config, ...JSON.parse(saved) };
            }
        } catch (e) {}
    }

    function saveConfig() {
        try {
            localStorage.setItem('uwave_vlbl_config', JSON.stringify(config));
        } catch (e) {}
    }

    function loadBases() {
        try {
            const saved = localStorage.getItem('uwave_vlbl_bases');
            if (saved) {
                bases = JSON.parse(saved);
            }
        } catch (e) {}
    }

    function saveBases() {
        try {
            localStorage.setItem('uwave_vlbl_bases', JSON.stringify(bases));
        } catch (e) {}
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        addBase,
        removeBase,
        clearBases,
        clearMeasurements,
        solveForBase,
        solveForSelectedBase,
        toggleAutoCollect,
        getSolution: () => solution,
        getBases: () => bases,
        getMeasurements: () => rangeMeasurements,
        subscribe: (listener) => {
            listeners.push(listener);
            return () => {
                listeners = listeners.filter(l => l !== listener);
            };
        }
    };

    function notifyListeners(event, data = {}) {
        for (const listener of listeners) {
            try {
                listener(event, data);
            } catch (e) {
                console.warn('[UIVLBL] Ошибка слушателя:', e.message);
            }
        }
    }

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIVLBL;
}