// modules/ui-addressing.js — Настройка логического адреса uWaveSuite

const UIAddressing = (() => {

    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    let addressing = {
        localAddress: 0
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
        const btnApply = panel.querySelector('#addr-btn-apply');
        const btnRead = panel.querySelector('#addr-btn-read');
        
        if (btnApply) btnApply.addEventListener('click', () => applySettings());
        if (btnRead) btnRead.addEventListener('click', () => readSettings());
    }

    function loadAddressingData() {
        addressing.localAddress = UWSettingsStorage.get('logical.localAddress', 0);
        
        // Данные из порта если доступны
        const port = getPort();
        if (port && port.isOpen && port.deviceInfo) {
            if (port.deviceInfo.ptAddress !== undefined) {
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
        if (isOpen) close();
        else open();
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        const addrInput = panel.querySelector('#addr-local-address');
        if (addrInput) {
            addrInput.value = addressing.localAddress;
        }
        
        updateStatus();
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
        
        statusEl.textContent = `Текущий адрес: #${addressing.localAddress}`;
        statusEl.className = 'addr-status info';
    }

    // ========== ДЕЙСТВИЯ ==========
    
    function applySettings() {
        if (!panel) return;
        
        const localAddr = parseInt(panel.querySelector('#addr-local-address')?.value || 0);
        const saveFlash = panel.querySelector('#addr-save-flash')?.checked || false;
        
        if (localAddr < 0 || localAddr > 255) {
            showStatus('Адрес должен быть 0-255', 'error');
            return;
        }
        
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        // Отправляем в модем (isPTMode всегда true — бесшовный режим)
        const sent = port.queryPTSettingsWrite(saveFlash, true, localAddr);
        
        if (sent) {
            addressing.localAddress = localAddr;
            UWSettingsStorage.set('logical.localAddress', localAddr);
            UWSettingsStorage.save();
            
            showStatus(`Адрес #${localAddr} применён`, 'success');
            
            // Обновляем через секунду после ACK
            setTimeout(() => {
                if (typeof updateStatus === 'function') updateStatus();
            }, 500);
        } else {
            showStatus('Не удалось отправить (занято)', 'warning');
        }
    }

    function readSettings() {
        if (!panel) return;
        
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        const sent = port.queryPTSettings();
        
        if (sent) {
            showStatus('Чтение...', 'info');
            
            // Слушаем ответ
            const handler = (e) => {
                const settings = e.detail;
                
                addressing.localAddress = settings.ptAddress;
                UWSettingsStorage.set('logical.localAddress', settings.ptAddress);
                UWSettingsStorage.save();
                
                updateUI();
                showStatus(`Прочитано: адрес #${settings.ptAddress}`, 'success');
                
                port.removeEventListener('ptSettings', handler);
            };
            
            port.addEventListener('ptSettings', handler);
            
            // Таймаут
            setTimeout(() => {
                port.removeEventListener('ptSettings', handler);
            }, 3000);
        } else {
            showStatus('Не удалось отправить (занято)', 'warning');
        }
    }

    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#addr-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'addr-status ' + type;
    }

    // ========== ЗАВИСИМОСТИ ==========
    
    function getPort() {
        if (window.UWApp && window.UWApp.getPort) {
            return window.UWApp.getPort();
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
        subscribe
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIAddressing;
}