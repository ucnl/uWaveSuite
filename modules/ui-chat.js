// modules/ui-chat.js — Модуль чата uWaveSuite
// Единая панель для отправки/приёма сообщений
// Заменяет ui-manual.js

const UIChat = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let messagesEl = null;
    let listeners = [];
    let isOpen = false;
    
    // Сообщения
    let messages = [];              // [{ id, direction, type, timestamp, ... }]
    let unreadCount = 0;
    let filter = 'all';             // 'all' | 'incoming' | 'outgoing' | 'async' | 'packet'
    
    const MAX_MESSAGES = 200;
    const STORAGE_KEY = 'uwave_chat_messages';
    
    let uwPort = null;
    let saveTimer = null;

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'chat-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIChat] Panel not found');
            return;
        }
        
        messagesEl = panel.querySelector('#chat-messages');
        
        loadMessages();
        initEventHandlers();
        renderMessages();
    }

    function initEventHandlers() {
        // Кнопка отправки
        const sendBtn = panel.querySelector('#chat-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', sendMessage);
        
        // Переключение типа отправки
        const typeSelect = panel.querySelector('#chat-send-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', updateFormVisibility);
        }
        
        // Размер пакета
        const pktData = panel.querySelector('#chat-pkt-data');
        const pktSize = panel.querySelector('#chat-pkt-size');
        if (pktData && pktSize) {
            pktData.addEventListener('input', () => {
                pktSize.textContent = `${pktData.value.length}/64`;
            });
        }
        
        // Фильтры
        panel.querySelectorAll('.chat-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.chat-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filter = btn.dataset.filter;
                renderMessages();
            });
        });
        
        // Enter в поле данных пакета
        if (pktData) {
            pktData.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') sendMessage();
            });
        }
        
        updateFormVisibility();
    }

    function updateFormVisibility() {
        const type = panel.querySelector('#chat-send-type')?.value || 'cdma';
        
        panel.querySelectorAll('.chat-form').forEach(form => {
            form.style.display = 'none';
        });
        
        const activeForm = panel.querySelector(`#chat-form-${type}`);
        if (activeForm) activeForm.style.display = 'block';
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        panel.classList.add('visible');
        isOpen = true;
        unreadCount = 0;
        updateBadge();
        
        // Полный рендер при открытии (чтобы увидеть накопленные сообщения)
        renderMessages();
        
        // Скролл вниз после рендера
        requestAnimationFrame(() => {
            scrollToBottom();
        });
        
        notifyListeners('open');
    }

    function close() {
        if (!panel) return;
        panel.classList.remove('visible');
        isOpen = false;
        notifyListeners('close');
    }

    function toggle() {
        if (isOpen) close();
        else open();
    }

    // ========== ПОРТ ==========
    
    /**
     * Установка порта (вызывается из app.js при инициализации)
     */
    function setPort(port) {
        uwPort = port;
    }
    
    /**
     * Получение порта — приоритет у прямой ссылки,
     * fallback на window.UWApp для совместимости
     */
    function getPort() {
        if (uwPort) return uwPort;
        
        if (window.UWApp && window.UWApp.getPort) {
            return window.UWApp.getPort();
        }
        return null;
    }

    // ========== ОТПРАВКА ==========
    
    async function sendMessage() {
        if (!panel) return;
        
        const type = panel.querySelector('#chat-send-type')?.value || 'cdma';
        const port = getPort();
        
        if (!port || !port.isOpen) {
            addSystemMessage('Нет подключения к устройству', 'error');
            return;
        }
        
        if (port.isWaitingLocal || port.isWaitingRemote) {
            addSystemMessage('Устройство занято другим запросом', 'warning');
            return;
        }
        
        try {
            if (type === 'cdma') {
                await sendCDMA(port);
            } else if (type === 'packet') {
                await sendPacket(port);
            } else if (type === 'itg') {
                await sendITG(port);
            }
        } catch (error) {
            addSystemMessage('Ошибка отправки: ' + error.message, 'error');
        }
    }

    async function sendCDMA(port) {
        const txCh = parseInt(panel.querySelector('#chat-cdma-tx')?.value || 0);
        const rxCh = parseInt(panel.querySelector('#chat-cdma-rx')?.value || 0);
        const cmdID = parseInt(panel.querySelector('#chat-cdma-cmd')?.value || 0);
        
        addOutgoing('cdma', {
            txChID: txCh,
            rxChID: rxCh,
            rcCmdID: cmdID
        });
        
        const sent = port.queryRC(txCh, rxCh, cmdID);
        
        if (!sent) {
            addSystemMessage('Не удалось отправить CDMA (занято)', 'warning');
        }
    }

    async function sendPacket(port) {
        const addr = parseInt(panel.querySelector('#chat-pkt-addr')?.value || 0);
        const tries = parseInt(panel.querySelector('#chat-pkt-tries')?.value || 3);
        const dataStr = panel.querySelector('#chat-pkt-data')?.value || '';
        
        if (dataStr.length === 0) {
            addSystemMessage('Введите данные пакета', 'warning');
            return;
        }
        
        if (dataStr.length > 64) {
            addSystemMessage('Пакет больше 64 байт', 'error');
            return;
        }
        
        const bytes = new TextEncoder().encode(dataStr);
        
        addOutgoing('packet', {
            targetPtAddress: addr,
            dataPacket: bytes,
            maxTries: tries
        });
        
        const sent = port.queryPTSend(addr, bytes, tries);
        
        if (!sent) {
            addSystemMessage('Не удалось отправить пакет (занято)', 'warning');
            return;
        }
        
        // Очищаем поле
        const pktData = panel.querySelector('#chat-pkt-data');
        if (pktData) {
            pktData.value = '';
            const pktSize = panel.querySelector('#chat-pkt-size');
            if (pktSize) pktSize.textContent = '0/64';
        }
    }

    async function sendITG(port) {
        const addr = parseInt(panel.querySelector('#chat-itg-addr')?.value || 0);
        const dataID = parseInt(panel.querySelector('#chat-itg-dataid')?.value || 0);
        
        addOutgoing('itg', {
            targetPtAddress: addr,
            dataId: dataID
        });
        
        const sent = port.queryPTITG(addr, dataID);
        
        if (!sent) {
            addSystemMessage('Не удалось отправить ITG (занято)', 'warning');
        }
    }

    // ========== ДОБАВЛЕНИЕ СООБЩЕНИЙ ==========
    
    function addIncoming(type, data) {
        const message = {
            id: Date.now() + Math.random(),
            direction: 'incoming',
            type: type,
            timestamp: Date.now(),
            data: data
        };
        
        messages.push(message);
        trimMessages();
        saveMessages();
        
        if (!isOpen) {
            unreadCount++;
            updateBadge();
            blinkButton();
        } else {
            appendMessage(message);
        }
        
        notifyListeners('message', message);
    }

    function addOutgoing(type, data) {
        const message = {
            id: Date.now() + Math.random(),
            direction: 'outgoing',
            type: type,
            timestamp: Date.now(),
            data: data
        };
        
        messages.push(message);
        trimMessages();
        saveMessages();
        
        if (isOpen) {
            appendMessage(message);
        }
        
        notifyListeners('message', message);
    }

    function addSystemMessage(text, type = 'info') {
        const message = {
            id: Date.now() + Math.random(),
            direction: 'system',
            type: type,
            timestamp: Date.now(),
            text: text
        };
        
        messages.push(message);
        trimMessages();
        saveMessages();
        
        if (isOpen) {
            appendMessage(message);
        }
        
        notifyListeners('message', message);
    }

    function trimMessages() {
        if (messages.length > MAX_MESSAGES) {
            const removed = messages.length - MAX_MESSAGES;
            messages = messages.slice(-MAX_MESSAGES);
            
            // Если панель открыта — убираем старые DOM-узлы
            if (isOpen && messagesEl) {
                for (let i = 0; i < removed; i++) {
                    const first = messagesEl.querySelector('.chat-message');
                    if (first) first.remove();
                    else break;
                }
            }
        }
    }

    // ========== ОТРИСОВКА ==========
    
    /**
     * Полная перерисовка списка сообщений
     * (используется при открытии, смене фильтра, очистке)
     */
    function renderMessages() {
        if (!messagesEl) return;
        
        const filtered = filterMessages();
        
        if (filtered.length === 0) {
            messagesEl.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Нет сообщений</div>';
            return;
        }
        
        let html = '';
        
        for (const msg of filtered) {
            try {
                html += renderMessage(msg);
            } catch (e) {
                console.warn('[UIChat] renderMessage error:', e.message, msg);
                html += `<div class="chat-message" style="color:var(--border-danger); margin-bottom:6px;">[ошибка рендера: ${escapeHtml(e.message)}]</div>`;
            }
        }
        
        messagesEl.innerHTML = html;
    }

    /**
     * Инкрементальное добавление одного сообщения в конец списка
     * (без полной перерисовки)
     */
    function appendMessage(msg) {
        if (!messagesEl || !isOpen) return;
        
        // Если сообщение не соответствует текущему фильтру — не добавляем
        if (!matchesFilter(msg)) return;
        
        try {
            const html = renderMessage(msg);
            messagesEl.insertAdjacentHTML('beforeend', html);
            scrollToBottom();
        } catch (e) {
            console.warn('[UIChat] appendMessage error:', e.message, msg);
        }
    }

    function matchesFilter(msg) {
        if (filter === 'all') return true;
        if (filter === 'incoming') return msg.direction === 'incoming';
        if (filter === 'outgoing') return msg.direction === 'outgoing';
        if (filter === 'async') return msg.type === 'async';
        if (filter === 'packet') return msg.type === 'packet' || msg.type === 'itg';
        return true;
    }

    function filterMessages() {
        if (filter === 'all') return messages;
        
        if (filter === 'incoming') {
            return messages.filter(m => m.direction === 'incoming');
        }
        
        if (filter === 'outgoing') {
            return messages.filter(m => m.direction === 'outgoing');
        }
        
        if (filter === 'async') {
            return messages.filter(m => m.type === 'async');
        }
        
        if (filter === 'packet') {
            return messages.filter(m => m.type === 'packet' || m.type === 'itg');
        }
        
        return messages;
    }

    function renderMessage(msg) {
        const time = formatTime(msg.timestamp);
        const color = getMessageColor(msg);
        const icon = getMessageIcon(msg);
        const text = formatMessageText(msg);
        
        return `
            <div class="chat-message ${msg.direction} ${msg.type}" data-id="${msg.id}" style="color:${color}; margin-bottom:6px; padding:4px 0; border-bottom:1px solid rgba(128,128,128,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <span style="font-size:10px; color:var(--text-muted); min-width:60px;">[${time}]</span>
                    <span style="font-size:10px; font-weight:600; color:${color}; min-width:20px;">${icon}</span>
                    <div style="flex:1; margin-left:8px; word-break:break-word; white-space:pre-wrap;">${escapeHtml(text)}</div>
                </div>
            </div>
        `;
    }

    function getMessageColor(msg) {
        if (msg.direction === 'system') {
            return msg.type === 'error' ? 'var(--border-danger)' :
                   msg.type === 'warning' ? 'var(--border-warning)' :
                   msg.type === 'success' ? 'var(--border-success)' :
                   'var(--text-muted)';
        }
        
        if (msg.direction === 'incoming') {
            if (msg.type === 'packet') return 'var(--btn-export)';
            if (msg.type === 'itg-response') return 'var(--text-info)';
            return 'var(--text-info)';
        }
        
        if (msg.direction === 'outgoing') {
            if (msg.type === 'packet-delivered') return 'var(--border-success)';
            if (msg.type === 'packet-failed') return 'var(--border-danger)';
            if (msg.type === 'timeout') return 'var(--border-danger)';
            if (msg.type === 'itg-timeout') return 'var(--border-danger)';
            return 'var(--btn-start)';
        }
        
        return 'var(--text-primary)';
    }

    function getMessageIcon(msg) {
        if (msg.direction === 'incoming') {
            if (msg.type === 'async') return '⬇';
            if (msg.type === 'packet') return '📦';
            if (msg.type === 'response') return '⬇';
            if (msg.type === 'itg-response') return '🔍';
        }
        
        if (msg.direction === 'outgoing') {
            if (msg.type === 'packet-delivered') return '✓';
            if (msg.type === 'packet-failed') return '✗';
            if (msg.type === 'cdma') return '📻';
            if (msg.type === 'packet') return '📦';
            if (msg.type === 'itg') return '🔍';
            if (msg.type === 'itg-timeout') return '⌛';
            if (msg.type === 'timeout') return '⌛';
            if (msg.type === 'response') return '✓';
        }
        
        return '•';
    }

    function formatMessageText(msg) {
        if (msg.direction === 'system') {
            return msg.text;
        }
        
        const d = msg.data || {};
        
        // Входящее ASYNC
        if (msg.type === 'async') {
            let text = `ASYNC_IN: cmd=${d.rcCmdID}`;
            if (Number.isFinite(d.msrDb)) text += `, msr=${d.msrDb.toFixed(1)} dB`;
            if (Number.isFinite(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            return text;
        }
        
        // Входящий/исходящий пакет
        if (msg.type === 'packet') {
            const addr = (d.targetPtAddress !== undefined && d.targetPtAddress !== null)
                ? d.targetPtAddress
                : '?';
            
            let text = msg.direction === 'incoming' ? `PKT от #${addr}` : `PKT → #${addr}`;
            
            if (Number.isFinite(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            if (d.triesTaken !== undefined && d.triesTaken !== null) text += ` (попыток: ${d.triesTaken})`;
            if (d.maxTries !== undefined && d.maxTries !== null) text += ` (попыток: ${d.maxTries})`;
            
            // Данные пакета
            if (d.dataPacket) {
                let dataText = '';
                try {
                    if (d.dataPacket instanceof Uint8Array || Array.isArray(d.dataPacket)) {
                        dataText = new TextDecoder().decode(new Uint8Array(d.dataPacket));
                    } else if (typeof d.dataPacket === 'string') {
                        dataText = d.dataPacket;
                    }
                } catch (e) {
                    dataText = '[binary]';
                }
                
                if (dataText) {
                    text += `\n"${dataText}"`;
                }
            }
            
            return text;
        }
        
        // Исходящий CDMA
        if (msg.type === 'cdma') {
            return `CDMA → Tx=${d.txChID} Rx=${d.rxChID}, cmd=${d.rcCmdID}`;
        }
        
        // Исходящий ITG
        if (msg.type === 'itg') {
            const dataNames = ['DPT', 'TMP', 'BAT'];
            const name = (d.dataId >= 0 && d.dataId <= 2) ? dataNames[d.dataId] : `ID${d.dataId}`;
            return `ITG → #${d.targetPtAddress}, ${name}`;
        }
        
        // Ответ на запрос
        if (msg.type === 'response') {
            const addr = d.userAddress !== undefined ? d.userAddress :
                         d.txChID !== undefined ? d.txChID : '?';
            let text = `Ответ #${addr}`;
            if (Number.isFinite(d.value)) text += `, value=${d.value.toFixed(2)}`;
            if (Number.isFinite(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            if (Number.isFinite(d.msrDb)) text += `, msr=${d.msrDb.toFixed(1)} dB`;
            return text;
        }
        
        // Таймаут (RC)
        if (msg.type === 'timeout') {
            const tx = (d.txChID === undefined || d.txChID === null || d.txChID < 0) ? '?' : d.txChID;
            const cmd = (d.rcCmdID === undefined || d.rcCmdID === null || d.rcCmdID < 0) ? '?' : d.rcCmdID;
            return `Таймаут Tx=${tx} cmd=${cmd}`;
        }
        
        // Пакет доставлен
        if (msg.type === 'packet-delivered') {
            const addr = (d.targetPtAddress === undefined || d.targetPtAddress === null || d.targetPtAddress < 0)
                ? '?'
                : d.targetPtAddress;
            let text = `PKT доставлен #${addr}`;
            if (d.triesTaken !== undefined && d.triesTaken !== null && d.triesTaken >= 0) {
                text += ` (попыток: ${d.triesTaken})`;
            }
            if (Number.isFinite(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            return text;
        }

        // Пакет не доставлен
        if (msg.type === 'packet-failed') {
            const addr = (d.targetPtAddress === undefined || d.targetPtAddress === null || d.targetPtAddress < 0)
                ? '?'
                : d.targetPtAddress;
            let text = `PKT НЕ доставлен #${addr}`;
            if (d.triesTaken !== undefined && d.triesTaken !== null && d.triesTaken >= 0) {
                text += ` (попыток: ${d.triesTaken})`;
            }
            return text;
        }
        
        // ITG таймаут
        if (msg.type === 'itg-timeout') {
            const addr = (d.targetPtAddress === undefined || d.targetPtAddress === null || d.targetPtAddress < 0)
                ? '?'
                : d.targetPtAddress;
            let text = `ITG ТАЙМАУТ #${addr}`;
            if (d.dataId !== undefined && d.dataId !== null && d.dataId >= 0) {
                text += ` (dataId=${d.dataId})`;
            }
            return text;
        }

        // ITG ответ
        if (msg.type === 'itg-response') {
            const addr = (d.targetPtAddress === undefined || d.targetPtAddress === null || d.targetPtAddress < 0)
                ? '?'
                : d.targetPtAddress;
            let text = `ITG ответ #${addr}`;
            if (d.dataId !== undefined && d.dataId !== null && d.dataId >= 0) {
                text += ` dataId=${d.dataId}`;
            }
            if (Number.isFinite(d.dataValue)) text += ` value=${d.dataValue.toFixed(2)}`;
            if (Number.isFinite(d.azimuthDeg)) text += ` az=${d.azimuthDeg.toFixed(1)}°`;
            return text;
        }
        
        return JSON.stringify(d);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(timestamp) {
        const d = new Date(timestamp);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }

    function scrollToBottom() {
        if (!messagesEl) return;
        requestAnimationFrame(() => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });
    }

    // ========== БЕЙДЖ И МИГАНИЕ ==========
    
    function updateBadge() {
        const badge = document.getElementById('chat-badge');
        if (!badge) return;
        
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    function blinkButton() {
        const btn = document.getElementById('btn-chat');
        if (!btn) return;
        
        btn.classList.add('blink');
        setTimeout(() => btn.classList.remove('blink'), 2000);
    }

    // ========== ДЕЙСТВИЯ ==========
    
    function clearMessages() {
        if (messages.length === 0) return;
        
        if (!confirm(`Очистить все сообщения (${messages.length})?`)) return;
        
        messages = [];
        unreadCount = 0;
        saveMessages();
        updateBadge();
        renderMessages();
    }

    function exportMessages() {
        if (messages.length === 0) {
            alert('Нет сообщений для экспорта');
            return;
        }
        
        const lines = ['# uWaveSuite Chat Export'];
        lines.push(`# ${new Date().toISOString()}`);
        lines.push('# Timestamp,Direction,Type,Data');
        
        for (const msg of messages) {
            const time = new Date(msg.timestamp).toISOString();
            const direction = msg.direction;
            const type = msg.type;
            const text = formatMessageText(msg).replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
            lines.push(`${time},${direction},${type},"${text}"`);
        }
        
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `uwave_chat_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== СОХРАНЕНИЕ/ЗАГРУЗКА ==========
    
    /**
     * Отложенная запись в localStorage (throttle 500 мс),
     * чтобы не тормозить UI при частых сообщениях
     */
    function saveMessages() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                const toSave = messages.slice(-100).map(msg => {
                    const copy = { ...msg };
                    if (copy.data && copy.data.dataPacket) {
                        if (copy.data.dataPacket instanceof Uint8Array) {
                            copy.data.dataPacket = Array.from(copy.data.dataPacket);
                        }
                    }
                    return copy;
                });
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } catch (e) {
                console.warn('[UIChat] Не удалось сохранить:', e);
            }
            saveTimer = null;
        }, 500);
    }

    function loadMessages() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                messages = (Array.isArray(parsed) ? parsed : []).filter(
                    msg => msg && typeof msg === 'object'
                );
            }
        } catch (e) {
            console.warn('[UIChat] Не удалось загрузить:', e);
            messages = [];
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
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
                console.warn('[UIChat] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        setPort,
        toggle,
        isOpen: () => isOpen,
        addIncoming,
        addOutgoing,
        addSystemMessage,
        clearMessages,
        exportMessages,
        sendMessage,
        subscribe
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIChat;
}