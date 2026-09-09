// modules/ui-manual.js — Панель ручных запросов uWaveSuite
// Короткие команды CDMA и пакетные запросы

const UIManual = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // История запросов
    let history = {
        rc: [],     // [{ txCh, rxCh, cmdID, timestamp }]
        pt: []      // [{ addr, data, timestamp }]
    };
    
    const MAX_HISTORY = 20;

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'manual-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIManual] Panel not found');
            return;
        }
        
        // Инициализация обработчиков
        initEventHandlers();
        
        // Загрузка истории из localStorage
        loadHistory();
        
        // Обновление UI
        updateHistoryUI();
    }

    function initEventHandlers() {
        // Кнопки отправки
        const btnRC = panel.querySelector('#btn-rc-send');
        const btnPT = panel.querySelector('#btn-pt-send');
        
        if (btnRC) {
            btnRC.addEventListener('click', () => sendRCRequest());
        }
        
        if (btnPT) {
            btnPT.addEventListener('click', () => sendPTRequest());
        }
        
        // Enter в полях ввода
        const ptData = panel.querySelector('#pt-data');
        if (ptData) {
            ptData.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    sendPTRequest();
                }
            });
        }
        
        // Автозаполнение каналов из настроек
        const txCh = panel.querySelector('#rc-tx-ch');
        const rxCh = panel.querySelector('#rc-rx-ch');
        
        if (txCh && rxCh) {
            txCh.value = UWSettingsStorage.get('device.txChID', 0);
            rxCh.value = UWSettingsStorage.get('device.rxChID', 0);
        }
        
        // Ограничение длины пакета
        const ptInput = panel.querySelector('#pt-data');
        const ptSizeHint = panel.querySelector('#pt-size-hint');
        
        if (ptInput && ptSizeHint) {
            ptInput.addEventListener('input', () => {
                ptSizeHint.textContent = `${ptInput.value.length} / 64`;
                ptSizeHint.style.color = ptInput.value.length > 64 ? 'var(--border-danger)' : 'var(--text-secondary)';
            });
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'block';
        isOpen = true;
        
        // Обновляем поля
        updateFields();
        
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

    function isPanelOpen() {
        return isOpen;
    }

    function updateFields() {
        if (!panel) return;
        
        // Обновляем каналы из настроек
        const txCh = panel.querySelector('#rc-tx-ch');
        const rxCh = panel.querySelector('#rc-rx-ch');
        
        if (txCh) txCh.value = UWSettingsStorage.get('device.txChID', 0);
        if (rxCh) rxCh.value = UWSettingsStorage.get('device.rxChID', 0);
    }

    // ========== ОТПРАВКА ЗАПРОСОВ ==========
    
    async function sendRCRequest() {
        if (!panel) return;
        
        const txCh = parseInt(panel.querySelector('#rc-tx-ch')?.value || 0);
        const rxCh = parseInt(panel.querySelector('#rc-rx-ch')?.value || 0);
        const cmdID = parseInt(panel.querySelector('#rc-cmd')?.value || 0);
        
        // Проверяем порт
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        // Проверяем каналы
        const totalChannels = UWSettingsStorage.get('device.totalCodeChannels', 0);
        if (totalChannels > 0 && (txCh >= totalChannels || rxCh >= totalChannels)) {
            showStatus(`Каналы должны быть 0-${totalChannels - 1}`, 'error');
            return;
        }
        
        showStatus(`Отправка RC (Tx=${txCh}, Rx=${rxCh}, Cmd=${cmdID})...`, 'info');
        
        try {
            const queueManager = getQueueManager();
            
            if (queueManager) {
                queueManager.enqueueManualRequest(async () => {
                    const result = await port.queryRC(txCh, rxCh, cmdID);
                    return result;
                }, `RC: Tx=${txCh}, Rx=${rxCh}, Cmd=${cmdID}`);
            } else {
                const result = await port.queryRC(txCh, rxCh, cmdID);
                handleRCResult(result);
            }
            
            // Добавляем в историю
            addToHistory('rc', { txCh, rxCh, cmdID });
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }

    async function sendPTRequest() {
        if (!panel) return;
        
        const addr = parseInt(panel.querySelector('#pt-addr')?.value || 0);
        const dataStr = panel.querySelector('#pt-data')?.value || '';
        
        // Проверяем адрес
        if (addr < 0 || addr > 255) {
            showStatus('Адрес должен быть 0-255', 'error');
            return;
        }
        
        // Проверяем данные
        if (dataStr.length === 0) {
            showStatus('Введите данные пакета', 'error');
            return;
        }
        
        if (dataStr.length > 64) {
            showStatus('Пакет больше 64 байт', 'error');
            return;
        }
        
        // Проверяем порт
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        showStatus(`Отправка пакета #${addr}...`, 'info');
        
        try {
            const bytes = new TextEncoder().encode(dataStr);
            const maxTries = parseInt(panel.querySelector('#pt-tries')?.value || 3);
            
            const queueManager = getQueueManager();
            
            if (queueManager) {
                queueManager.enqueueManualRequest(async () => {
                    const result = await port.queryPTSend(addr, bytes, maxTries);
                    return result;
                }, `PT: #${addr} (${dataStr.length} bytes)`);
            } else {
                const result = await port.queryPTSend(addr, bytes, maxTries);
                handlePTResult(result);
            }
            
            // Добавляем в историю
            addToHistory('pt', { addr, data: dataStr });
            
            // Очищаем поле
            const ptData = panel.querySelector('#pt-data');
            if (ptData) ptData.value = '';
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }

    async function sendPTInterrogation() {
        if (!panel) return;
        
        const addr = parseInt(panel.querySelector('#pt-itg-addr')?.value || 0);
        const dataID = parseInt(panel.querySelector('#pt-itg-dataid')?.value || 0);
        
        const port = getPort();
        if (!port || !port.isOpen) {
            showStatus('Нет подключения', 'error');
            return;
        }
        
        showStatus(`Запрос данных #${addr} (ID=${dataID})...`, 'info');
        
        try {
            const queueManager = getQueueManager();
            
            if (queueManager) {
                queueManager.enqueueManualRequest(async () => {
                    const result = await port.queryPTITG(addr, dataID);
                    return result;
                }, `PT ITG: #${addr}, DataID=${dataID}`);
            } else {
                const result = await port.queryPTITG(addr, dataID);
                handlePTITGResult(result);
            }
            
        } catch (error) {
            showStatus('Ошибка: ' + error.message, 'error');
        }
    }

    // ========== ОБРАБОТКА РЕЗУЛЬТАТОВ ==========
    
    function handleRCResult(result) {
        let msg = `RC ответ: Cmd=${result.rcCmdID}`;
        
        if (!isNaN(result.value)) {
            msg += `, Value=${result.value.toFixed(2)}`;
        }
        
        if (!isNaN(result.azimuthDeg)) {
            msg += `, Az=${result.azimuthDeg.toFixed(1)}°`;
        }
        
        if (!isNaN(result.msrDb)) {
            msg += `, MSR=${result.msrDb.toFixed(1)}dB`;
        }
        
        if (!isNaN(result.propTimeSec)) {
            msg += `, Tp=${result.propTimeSec.toFixed(5)}s`;
        }
        
        showStatus(msg, 'success');
        notifyListeners('rcResult', result);
    }

    function handlePTResult(result) {
        let msg = `Пакет доставлен #${result.targetPtAddress}`;
        
        if (!isNaN(result.azimuthDeg)) {
            msg += `, Az=${result.azimuthDeg.toFixed(1)}°`;
        }
        
        showStatus(msg, 'success');
        notifyListeners('ptResult', result);
    }

    function handlePTITGResult(result) {
        let msg = `Данные #${result.targetPtAddress}: ID=${result.dataId}, Value=${result.dataValue.toFixed(2)}`;
        
        if (!isNaN(result.azimuthDeg)) {
            msg += `, Az=${result.azimuthDeg.toFixed(1)}°`;
        }
        
        showStatus(msg, 'success');
        notifyListeners('ptITGResult', result);
    }

    // ========== ИСТОРИЯ ==========
    
    function addToHistory(type, entry) {
        entry.timestamp = Date.now();
        history[type].unshift(entry);
        
        if (history[type].length > MAX_HISTORY) {
            history[type].pop();
        }
        
        saveHistory();
        updateHistoryUI();
    }

    function loadHistory() {
        try {
            const saved = localStorage.getItem('uwave_manual_history');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.rc) history.rc = parsed.rc;
                if (parsed.pt) history.pt = parsed.pt;
            }
        } catch (e) {
            console.warn('[UIManual] Ошибка загрузки истории:', e.message);
        }
    }

    function saveHistory() {
        try {
            localStorage.setItem('uwave_manual_history', JSON.stringify(history));
        } catch (e) {
            console.warn('[UIManual] Ошибка сохранения истории:', e.message);
        }
    }

    function updateHistoryUI() {
        if (!panel) return;
        
        const rcHistory = panel.querySelector('#rc-history');
        const ptHistory = panel.querySelector('#pt-history');
        
        if (rcHistory) {
            if (history.rc.length === 0) {
                rcHistory.innerHTML = '<span style="color:var(--text-muted);">Нет истории</span>';
            } else {
                rcHistory.innerHTML = history.rc.slice(0, 5).map(h => {
                    const time = new Date(h.timestamp).toLocaleTimeString();
                    return `<div style="font-size:11px; color:var(--text-secondary);">${time} — Tx=${h.txCh}, Rx=${h.rxCh}, Cmd=${h.cmdID}</div>`;
                }).join('');
            }
        }
        
        if (ptHistory) {
            if (history.pt.length === 0) {
                ptHistory.innerHTML = '<span style="color:var(--text-muted);">Нет истории</span>';
            } else {
                ptHistory.innerHTML = history.pt.slice(0, 5).map(h => {
                    const time = new Date(h.timestamp).toLocaleTimeString();
                    return `<div style="font-size:11px; color:var(--text-secondary);">${time} — #${h.addr}: "${h.data.substring(0, 20)}"</div>`;
                }).join('');
            }
        }
    }

    function clearHistory() {
        history.rc = [];
        history.pt = [];
        saveHistory();
        updateHistoryUI();
        showStatus('История очищена', 'info');
    }

    // ========== СТАТУС ==========
    
    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#manual-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'manual-status ' + type;
    }

    // ========== ПОЛУЧЕНИЕ ЗАВИСИМОСТЕЙ ==========
    
    function getPort() {
        if (window.UWApp && window.UWApp.getPort) {
            return window.UWApp.getPort();
        }
        return null;
    }

    function getQueueManager() {
        if (window.UWApp && window.UWApp.getQueueManager) {
            return window.UWApp.getQueueManager();
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
                console.warn('[UIManual] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        isPanelOpen,
        sendRCRequest,
        sendPTRequest,
        sendPTInterrogation,
        clearHistory,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIManual;
}