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
		scrollToBottom();
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
        
        // Добавляем сообщение в чат
        addOutgoing('cdma', {
            txChID: txCh,
            rxChID: rxCh,
            rcCmdID: cmdID
        });
        
        // Отправляем напрямую (не через queueManager, чтобы не мешало трекингу)
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
        
        // Добавляем сообщение
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
        
        // Добавляем сообщение
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
            type: type,                 // 'async' | 'packet' | 'response'
            timestamp: Date.now(),
            data: data
        };
        
        messages.push(message);
        trimMessages();
        saveMessages();
        
        // Бейдж если панель закрыта
        if (!isOpen) {
            unreadCount++;
            updateBadge();
            blinkButton();
        }
        
        if (isOpen) {
            renderMessages();
            scrollToBottom();
        }
        
        notifyListeners('message', message);
    }

    function addOutgoing(type, data) {
        const message = {
            id: Date.now() + Math.random(),
            direction: 'outgoing',
            type: type,                 // 'cdma' | 'packet' | 'itg' | 'response' | 'timeout'
            timestamp: Date.now(),
            data: data
        };
        
        messages.push(message);
        trimMessages();
        saveMessages();
        
        if (isOpen) {
            renderMessages();
            scrollToBottom();
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
            renderMessages();
            scrollToBottom();
        }
    }

    function trimMessages() {
        if (messages.length > MAX_MESSAGES) {
            messages = messages.slice(-MAX_MESSAGES);
        }
    }

    // ========== ОТРИСОВКА ==========
    
    function renderMessages() {
        if (!messagesEl) return;
        
        const filtered = filterMessages();
        
        if (filtered.length === 0) {
            messagesEl.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Нет сообщений</div>';
            return;
        }
        
        let html = '';
        
        for (const msg of filtered) {
            html += renderMessage(msg);
        }
        
        messagesEl.innerHTML = html;
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
            <div class="chat-message ${msg.direction} ${msg.type}" style="color:${color}; margin-bottom:6px; padding:4px 0; border-bottom:1px solid rgba(128,128,128,0.1);">
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
            return msg.type === 'packet' ? 'var(--btn-export)' : 'var(--text-info)';
        }
        
        if (msg.direction === 'outgoing') {
			if (msg.type === 'packet-delivered') return 'var(--border-success)';
			if (msg.type === 'packet-failed') return 'var(--border-danger)';
			if (msg.type === 'timeout') return 'var(--border-danger)';
			return 'var(--btn-start)';
		}
        
        return 'var(--text-primary)';
    }

    function getMessageIcon(msg) {
        if (msg.direction === 'incoming') {
            if (msg.type === 'async') return '⬇';
            if (msg.type === 'packet') return '📦';
            if (msg.type === 'response') return '⬇';
        }
        
        if (msg.direction === 'outgoing') {
            if (msg.type === 'packet-delivered') return '✓';
			if (msg.type === 'packet-failed') return '✗';
			if (msg.type === 'cdma') return '📻';
            if (msg.type === 'packet') return '📦';
            if (msg.type === 'itg') return '🔍';
            if (msg.type === 'timeout') return '⌛';
            if (msg.type === 'response') return '✓';
        }
        
        return '•';
    }

    function formatMessageText(msg) {
        if (msg.direction === 'system') {
            return msg.text;
        }
        
        const d = msg.data;
        
        // Входящее ASYNC
        if (msg.type === 'async') {
            let text = `ASYNC_IN: cmd=${d.rcCmdID}`;
            if (!isNaN(d.msrDb)) text += `, msr=${d.msrDb.toFixed(1)} dB`;
            if (!isNaN(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            return text;
        }
        
        // Входящий/исходящий пакет
        if (msg.type === 'packet') {
            const addr = d.targetPtAddress !== undefined ? d.targetPtAddress : '?';
            
            let text = msg.direction === 'incoming' ? `PKT от #${addr}` : `PKT → #${addr}`;
            
            if (!isNaN(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            if (d.triesTaken !== undefined) text += ` (попыток: ${d.triesTaken})`;
            if (d.maxTries !== undefined) text += ` (попыток: ${d.maxTries})`;
            
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
            const name = dataNames[d.dataId] || `ID${d.dataId}`;
            return `ITG → #${d.targetPtAddress}, ${name}`;
        }
        
        // Ответ на запрос
        if (msg.type === 'response') {
            let text = `Ответ #${d.userAddress || d.txChID || '?'}`;
            if (!isNaN(d.value)) text += `, value=${d.value.toFixed(2)}`;
            if (!isNaN(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
            if (!isNaN(d.msrDb)) text += `, msr=${d.msrDb.toFixed(1)} dB`;
            return text;
        }
        
        // Таймаут
        if (msg.type === 'timeout') {
            return `Таймаут #${d.txChID || '?'} (cmd=${d.rcCmdID || '?'})`;
        }
		
		// Пакет доставлен
		if (msg.type === 'packet-delivered') {
			let text = `PKT доставлен #${d.targetPtAddress}`;
			if (d.triesTaken !== undefined) text += ` (попыток: ${d.triesTaken})`;
			if (!isNaN(d.azimuthDeg)) text += `, az=${d.azimuthDeg.toFixed(1)}°`;
			return text;
		}

		// Пакет не доставлен
		if (msg.type === 'packet-failed') {
			let text = `PKT НЕ доставлен #${d.targetPtAddress}`;
			if (d.triesTaken !== undefined) text += ` (попыток: ${d.triesTaken})`;
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
        if (messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
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
    
    function saveMessages() {
        try {
            // Сохраняем только последние 100 (для скорости)
            const toSave = messages.slice(-100).map(msg => {
                // Uint8Array не сериализуется в JSON, конвертируем в Array
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
    }

    function loadMessages() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                messages = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[UIChat] Не удалось загрузить:', e);
        }
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
                console.warn('[UIChat] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
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