// modules/ui-addressing.js — Панель логической адресации uWaveSuite
// Управление режимом PTS и логическими адресами (0-255)

const UIAddressing = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // Данные адресации
    let addressing = {
        mode: 'cdma',           // 'cdma' | 'logical'
        localAddress: 0,        // Локальный адрес (0-255)
        isPTS: false,           // Packet Transport Service
        broadcastAddress: 255,  // Широковещательный адрес
        ptSettings: {
            isPTMode: false,
            ptAddress: 0,
            isSaveInFlash: false
        }
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'addressing-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIAddressing] Panel not found');
            return;
        }
        
        initEventHandlers();
        loadAddressingData();
        updateUI();
    }

    function initEventHandlers() {
        // Кнопки
        const btnApply = panel.querySelector('#addr-btn-apply');
        const btnRead = panel.querySelector('#addr-btn-read');
        const btnModeToggle = panel.querySelector('#addr-btn-mode-toggle');
        
        if (btnApply) btnApply.addEventListener('click', () => applySettings());
        if (btnRead) btnRead.addEventListener('click', () => readSettings());
        if (btnModeToggle) btnModeToggle.addEventListener('click', () => toggleMode());
        
        // Изменение адреса
        const addrInput = panel.querySelector('#addr-local-address');
        if (addrInput) {
            addrInput.addEventListener('change', () => {
                const addr = parseInt(addrInput.value);
                if (addr >= 0 && addr <= 255) {
                    addressing.localAddress = addr;
                    updateAddressInfo();
                }
            });
        }
    }

    function loadAddressingData() {
        addressing.mode = UWSettingsStorage.get('cdma.addressingMode', 'cdma');
        addressing.localAddress = UWSettingsStorage.get('logical.localAddress', 0);
        addressing.isPTS = UWSettingsStorage.get('logical.isPTS', false);
        addressing.broadcastAddress = UWSettingsStorage.get('logical.broadcastAddress', 255);
        
        // Данные из порта если доступны
        const port = getPort();
        if (port && port.isOpen && port.deviceInfo) {
            addressing.isPTS = port.deviceInfo.isPTS || false;
            if (port.deviceInfo.ptAddress !== undefined) {
                addressing.ptSettings.ptAddress = port.deviceInfo.ptAddress;
                addressing.localAddress = port.deviceInfo.ptAddress;
            }
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'block';
        isOpen = true;
        
        loadAddressingData();
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
        if (isOpen) {
            close();
        } else {
            open();
        }
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        // Режим адресации
        const modeSelect = panel.querySelector('#addr-mode');
        if (modeSelect) {
            modeSelect.value = addressing.mode;
        }
        
        // Локальный адрес
        const addrInput = panel.querySelector('#addr-local-address');
        if (addrInput) {
            addrInput.value = addressing.localAddress;
        }
        
        // PTS статус
        const ptsStatus = panel.querySelector('#addr-pts-status');
        if (ptsStatus) {
            ptsStatus.textContent = addressing.isPTS ? '✓ Поддерживается' : '✗ Не поддерживается';
            ptsStatus.className = addressing.isPTS ? 'addr-status success' : 'addr-status warning';
        }
        
        // Обновляем информацию
        updateAddressInfo();
        updateModeInfo();
        updateStatus();
    }

    function updateAddressInfo() {
        if (!panel) return;
        
        const infoEl = panel.querySelector('#addr-info');
        if (!infoEl) return;
        
        const addr = addressing.localAddress;
        const broadcast = addressing.broadcastAddress;
        
        let addrType = 'Обычный';
        let addrDesc = 'Индивидуальный адрес';
        
        if (addr === broadcast) {
            addrType = 'Широковещательный';
            addrDesc = 'Сообщения всем (без ACK)';
        } else if (addr === 0) {
            addrType = 'Базовый';
            addrDesc = 'Основной адрес';
        }
        
        infoEl.innerHTML = `
            <div class="addr-info-row">
                <span>Локальный адрес:</span>
                <span>#${addr}</span>
            </div>
            <div class="addr-info-row">
                <span>Тип:</span>
                <span>${addrType}</span>
            </div>
            <div class="addr-info-row">
                <span>Описание:</span>
                <span>${addrDesc}</span>
            </div>
            <div class="addr-info-row">
                <span>Широковещательный:</span>
                <span>#${broadcast}</span>
            </div>
            <div class="addr-info-row">
                <span>Диапазон:</span>
                <span>0 - 255</span>
            </div>
        `;
    }

    function updateModeInfo() {
        if (!panel) return;
        
        const modeInfoEl = panel.querySelector('#addr-mode-info');
        if (!modeInfoEl) return;
        
        if (addressing.mode === 'cdma') {
            modeInfoEl.innerHTML = `
                <div class="addr-mode-cdma">
                    <strong>CDMA режим</strong>
                    <p>Используются кодовые каналы (0-N)</p>
                    <p>Малое количество абонентов</p>
                    <p>Высокая скорость ответа</p>
                </div>
            `;
        } else {
            modeInfoEl.innerHTML = `
                <div class="addr-mode-logical">
                    <strong>Логический режим</strong>
                    <p>Используются адреса (0-255)</p>
                    <p>До 255 абонентов</p>
                    <p>Поддержка пакетной передачи</p>
                </div>
            `;
        }
    }

    function updateStatus() {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#addr-status');
        if (!statusEl) return;
        
        const port = getPort();
        
        if (!port || !port.isOpen) {
            statusEl.textContent = 'Нет подключения';
            statusEl.className = 'addr-status error';
            return;
        }
        
        statusEl.textContent = 'Готово';
        statusEl.className = 'addr-status success';
    }

    // ========== ДЕЙСТВИЯ ==========
    
    async function applySettings() {
        if (!panel) return;
        
        const mode = panel.querySelector('#addr-mode')?.value || 'cdma';
        const localAddr = parseInt(panel.querySelector('#addr-local-address')?.value || 0);
        
        if (localAddr < 0 || localAddr > 255) {
            showStatus('Адрес должен быть 0-255', 'error');
            return;
        }
        
        // Сохраняем в настройки
        UWSettingsStorage.set('cdma.addressingMode', mode);
        UWSettingsStorage.set('logical.localAddress', localAddr);
        
        // Применяем к менеджеру устройств
        const deviceManager = getDeviceManager();
        if (deviceManager) {
            deviceManager.setAddressingMode(mode);
            deviceManager.setLocalAddress(localAddr);
        }
        
        // Если порт открыт и режим логический — отправляем настройки PTS
        const port = getPort();
        if (port && port.isOpen && mode === 'logical') {
            showStatus('Применение настроек PTS...', 'info');
            
            try {
                const isSaveInFlash = panel.querySelector('#addr-save-flash')?.checked || false;
                
                await port.queryPTSettingsWrite(isSaveInFlash, true, localAddr);
                
                addressing.ptSettings.isPTMode = true;
                addressing.ptSettings.ptAddress = localAddr;
                addressing.ptSettings.isSaveInFlash = isSaveInFlash;
                
                showStatus('Настройки применены', 'success');
                
            } catch (error) {
                showStatus('Ошибка: ' + error.message, 'error');
                return;
            }
        }
        
        UWSettingsStorage.save();
        
        updateUI();
        showStatus('Настройки сохранены', 'success');
        
        notifyListeners('applied', { mode, localAddr });
    }

    async function readSettings() {
        if (!panel) return;
        
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        showStatus('Чтение настроек...', 'info');
        
        try {
            const settings = await port.queryPTSettings();
            
            if (settings) {
                addressing.ptSettings.isPTMode = settings.isPTMode;
                addressing.ptSettings.ptAddress = settings.ptAddress;
                addressing.localAddress = settings.ptAddress;
                addressing.isPTS = settings.isPTMode;
                addressing.mode = settings.isPTMode ? 'logical' : 'cdma';
                
                // Сохраняем в настройки
                UWSettingsStorage.set('logical.localAddress', settings.ptAddress);
                UWSettingsStorage.set('logical.isPTS', settings.isPTMode);
                UWSettingsStorage.set('cdma.addressingMode', settings.isPTMode ? 'logical' : 'cdma');
                UWSettingsStorage.save();
                
                updateUI();
                showStatus('Настройки прочитаны', 'success');
            }
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }

    function toggleMode() {
        if (addressing.mode === 'cdma') {
            addressing.mode = 'logical';
        } else {
            addressing.mode = 'cdma';
        }
        
        updateUI();
        showStatus(`Режим переключен на ${addressing.mode === 'cdma' ? 'CDMA' : 'логический'}`, 'info');
    }

    // ========== СТАТУС ==========
    
    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#addr-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'addr-status ' + type;
    }

    // ========== ПОЛУЧЕНИЕ ЗАВИСИМОСТЕЙ ==========
    
    function getPort() {
        if (window.UWApp && window.UWApp.getPort) {
            return window.UWApp.getPort();
        }
        return null;
    }

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
                console.warn('[UIAddressing] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        applySettings,
        readSettings,
        toggleMode,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIAddressing;
}