// modules/ui-cdma.js — Панель настройки CDMA каналов uWaveSuite
// Управление кодовыми каналами приема и передачи

const UICDMA = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // Данные каналов
    let channels = {
        txChID: 0,             // Текущий канал передачи
        rxChID: 0,             // Текущий канал приема
        totalCodeChannels: 0,  // Всего каналов
        channelStatus: {}      // Статус каждого канала
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'cdma-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UICDMA] Panel not found');
            return;
        }
        
        initEventHandlers();
        loadChannelData();
        updateUI();
    }

    function initEventHandlers() {
        // Кнопки
        const btnApply = panel.querySelector('#cdma-btn-apply');
        const btnRead = panel.querySelector('#cdma-btn-read');
        const btnScan = panel.querySelector('#cdma-btn-scan');
        
        if (btnApply) btnApply.addEventListener('click', () => applySettings());
        if (btnRead) btnRead.addEventListener('click', () => readSettings());        
        
        // Изменение каналов
        const txSelect = panel.querySelector('#cdma-tx-ch');
        const rxSelect = panel.querySelector('#cdma-rx-ch');
        
        if (txSelect) {
            txSelect.addEventListener('change', () => {
                channels.txChID = parseInt(txSelect.value);
                updateChannelInfo();
            });
        }
        
        if (rxSelect) {
            rxSelect.addEventListener('change', () => {
                channels.rxChID = parseInt(rxSelect.value);
                updateChannelInfo();
            });
        }
    }

    function loadChannelData() {
        channels.txChID = UWSettingsStorage.get('device.txChID', 0);
        channels.rxChID = UWSettingsStorage.get('device.rxChID', 0);
        channels.totalCodeChannels = UWSettingsStorage.get('device.totalCodeChannels', 0);
        
        // Если каналов нет — пробуем получить из порта
        if (channels.totalCodeChannels === 0) {
            const port = getPort();
            if (port && port.isOpen && port.deviceInfo) {
                channels.totalCodeChannels = port.deviceInfo.totalCodeChannels || 0;
            }
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'block';
        isOpen = true;
        
        loadChannelData();
        populateChannelSelects();
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

    // ========== ЗАПОЛНЕНИЕ СЕЛЕКТОРОВ ==========
    
    function populateChannelSelects() {
        if (!panel) return;
        
        const txSelect = panel.querySelector('#cdma-tx-ch');
        const rxSelect = panel.querySelector('#cdma-rx-ch');
        
        if (!txSelect || !rxSelect) return;
        
        const totalChannels = channels.totalCodeChannels > 0 ? channels.totalCodeChannels : 8;
        
        txSelect.innerHTML = '';
        rxSelect.innerHTML = '';
        
        for (let i = 0; i < totalChannels; i++) {
            const txOption = document.createElement('option');
            txOption.value = i;
            txOption.textContent = `Канал ${i}`;
            txSelect.appendChild(txOption);
            
            const rxOption = document.createElement('option');
            rxOption.value = i;
            rxOption.textContent = `Канал ${i}`;
            rxSelect.appendChild(rxOption);
        }
        
        txSelect.value = channels.txChID;
        rxSelect.value = channels.rxChID;
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        // Обновляем информацию о каналах
        const infoEl = panel.querySelector('#cdma-channel-info');
        if (infoEl) {
            if (channels.totalCodeChannels > 0) {
                infoEl.innerHTML = `
                    <div class="cdma-info-row">
                        <span>Всего каналов:</span>
                        <span>${channels.totalCodeChannels}</span>
                    </div>
                    <div class="cdma-info-row">
                        <span>Текущий TX:</span>
                        <span>${channels.txChID}</span>
                    </div>
                    <div class="cdma-info-row">
                        <span>Текущий RX:</span>
                        <span>${channels.rxChID}</span>
                    </div>
                `;
            } else {
                infoEl.innerHTML = '<span style="color:var(--text-muted);">Нет данных о каналах</span>';
            }
        }
        
        updateChannelInfo();
        updateStatus();
    }

    function updateChannelInfo() {
        if (!panel) return;
        
        const detailsEl = panel.querySelector('#cdma-channel-details');
        if (!detailsEl) return;
        
        const txCh = channels.txChID;
        const rxCh = channels.rxChID;
        
        detailsEl.innerHTML = `
            <div class="cdma-detail-item">
                <span class="cdma-detail-label">TX канал ${txCh}:</span>
                <span class="cdma-detail-value">${getChannelDescription(txCh)}</span>
            </div>
            <div class="cdma-detail-item">
                <span class="cdma-detail-label">RX канал ${rxCh}:</span>
                <span class="cdma-detail-value">${getChannelDescription(rxCh)}</span>
            </div>
            ${txCh === rxCh ? '<div class="cdma-warning">⚠ TX и RX каналы совпадают</div>' : ''}
        `;
    }

    function getChannelDescription(channelID) {
        const status = channels.channelStatus[channelID];
        
        if (status) {
            if (status.active) {
                return '🟢 Активен';
            } else if (status.busy) {
                return '🟡 Занят';
            } else if (status.noise) {
                return '🔴 Шум';
            }
        }
        
        return '⚪ Неизвестно';
    }

    function updateStatus() {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#cdma-status');
        if (!statusEl) return;
        
        const port = getPort();
        
        if (!port || !port.isOpen) {
            statusEl.textContent = 'Нет подключения';
            statusEl.className = 'cdma-status error';
            return;
        }
        
        statusEl.textContent = 'Готово';
        statusEl.className = 'cdma-status success';
    }

    // ========== ДЕЙСТВИЯ ==========
    
    async function applySettings() {
        if (!panel) return;
        
        const txCh = parseInt(panel.querySelector('#cdma-tx-ch')?.value || 0);
        const rxCh = parseInt(panel.querySelector('#cdma-rx-ch')?.value || 0);
        
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        showStatus('Применение настроек...', 'info');
        
        try {
            const salinity = UWSettingsStorage.get('device.salinityPSU', 0);
            const gravityAcc = UWSettingsStorage.get('device.gravityAcc', 9.8);
            const isCmdMode = UWSettingsStorage.get('device.isCmdMode', true);
            const isACK = UWSettingsStorage.get('device.isACKOnTXFinished', false);
            
            await port.querySettingsWrite(txCh, rxCh, salinity, isCmdMode, isACK, gravityAcc);
            
            // Сохраняем в настройки
            UWSettingsStorage.setDeviceSettings({
                txChID: txCh,
                rxChID: rxCh
            });
            UWSettingsStorage.save();
            
            // Обновляем локальные данные
            channels.txChID = txCh;
            channels.rxChID = rxCh;
            
            updateUI();
            showStatus('Настройки применены', 'success');
            
            notifyListeners('applied', { txCh, rxCh });
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
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
            const info = await port.queryDINFO();
            
            if (info) {
                channels.txChID = info.txChID;
                channels.rxChID = info.rxChID;
                channels.totalCodeChannels = info.totalCodeChannels;
                
                // Сохраняем в настройки
                UWSettingsStorage.setDeviceSettings({
                    txChID: info.txChID,
                    rxChID: info.rxChID,
                    totalCodeChannels: info.totalCodeChannels
                });
                UWSettingsStorage.save();
                
                populateChannelSelects();
                updateUI();
                showStatus('Настройки прочитаны', 'success');
            }
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }

    // ========== СТАТУС ==========
    
    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#cdma-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'cdma-status ' + type;
    }

    // ========== ПОЛУЧЕНИЕ ЗАВИСИМОСТЕЙ ==========
    
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
                console.warn('[UICDMA] Ошибка слушателя:', e.message);
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

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UICDMA;
}