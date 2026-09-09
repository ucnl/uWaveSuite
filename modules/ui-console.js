// modules/ui-console.js — Консоль протокола uWaveSuite
// Отображение логов, сообщений протокола, диагностики

const UIConsole = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let contentEl = null;
    let listeners = [];
    let isOpen = false;
    
    // Настройки консоли
    let settings = {
        maxEntries: 1000,
        autoScroll: true,
        showTimestamps: true,
        showDebug: false,
        showInfo: true,
        showSuccess: true,
        showWarning: true,
        showError: true,
        filter: ''          // Фильтр по тексту
    };
    
    // Счетчики
    let counters = {
        total: 0,
        info: 0,
        success: 0,
        warning: 0,
        error: 0,
        debug: 0
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'console-panel', contentId = 'console-content') {
        panel = document.getElementById(panelId);
        contentEl = document.getElementById(contentId);
        
        if (!panel || !contentEl) {
            console.warn('[UIConsole] Panel or content not found');
            return;
        }
        
        loadSettings();
        initEventHandlers();
        updateUI();
    }

    function initEventHandlers() {
        // Кнопка очистки
        const btnClear = panel.querySelector('#console-btn-clear');
        if (btnClear) btnClear.addEventListener('click', () => clearConsole());
        
        // Кнопка копирования
        const btnCopy = panel.querySelector('#console-btn-copy');
        if (btnCopy) btnCopy.addEventListener('click', () => copyConsole());
        
        // Кнопка экспорта
        const btnExport = panel.querySelector('#console-btn-export');
        if (btnExport) btnExport.addEventListener('click', () => exportConsole());
        
        // Автопрокрутка
        const autoScrollCheckbox = panel.querySelector('#console-auto-scroll');
        if (autoScrollCheckbox) {
            autoScrollCheckbox.checked = settings.autoScroll;
            autoScrollCheckbox.addEventListener('change', () => {
                settings.autoScroll = autoScrollCheckbox.checked;
                saveSettings();
            });
        }
        
        // Фильтр
        const filterInput = panel.querySelector('#console-filter');
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                settings.filter = filterInput.value.toLowerCase();
                applyFilter();
            });
        }
        
        // Переключатели типов сообщений
        const typeCheckboxes = panel.querySelectorAll('.console-type-checkbox');
        typeCheckboxes.forEach(checkbox => {
            checkbox.checked = settings[`show${capitalize(checkbox.dataset.type)}`];
            checkbox.addEventListener('change', () => {
                settings[`show${capitalize(checkbox.dataset.type)}`] = checkbox.checked;
                saveSettings();
                applyFilter();
            });
        });
        
        // Прокрутка
        contentEl.addEventListener('scroll', () => {
            if (settings.autoScroll) {
                const isAtBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 10;
                if (!isAtBottom) {
                    settings.autoScroll = false;
                    const autoScrollCheckbox = panel.querySelector('#console-auto-scroll');
                    if (autoScrollCheckbox) autoScrollCheckbox.checked = false;
                }
            }
        });
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem('uwave_console_settings');
            if (saved) {
                settings = { ...settings, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('[UIConsole] Ошибка загрузки настроек:', e.message);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem('uwave_console_settings', JSON.stringify(settings));
        } catch (e) {
            console.warn('[UIConsole] Ошибка сохранения настроек:', e.message);
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'flex';
        isOpen = true;
        
        updateUI();
        applyFilter();
        
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

    // ========== ДОБАВЛЕНИЕ СООБЩЕНИЙ ==========
    
    function addMessage(message, type = 'info', source = '') {
        if (!contentEl) return;
        
        // Проверяем фильтр типа
        if (!settings[`show${capitalize(type)}`]) return;
        
        // Проверяем текстовый фильтр
        if (settings.filter && !message.toLowerCase().includes(settings.filter)) return;
        
        // Создаем элемент
        const entry = document.createElement('div');
        entry.className = `console-entry ${type}`;
        entry.dataset.type = type;
        
        // Добавляем timestamp
        if (settings.showTimestamps) {
            const timestamp = new Date().toLocaleTimeString('ru-RU', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            entry.innerHTML = `<span class="console-timestamp">[${timestamp}]</span>`;
        }
        
        // Добавляем источник
        if (source) {
            entry.innerHTML += `<span class="console-source">[${source}]</span>`;
        }
        
        // Добавляем сообщение
        entry.innerHTML += `<span class="console-message">${escapeHtml(message)}</span>`;
        
        contentEl.appendChild(entry);
        
        // Обновляем счетчики
        counters.total++;
        counters[type]++;
        
        // Ограничиваем количество записей
        while (contentEl.children.length > settings.maxEntries) {
            contentEl.removeChild(contentEl.firstChild);
        }
        
        // Автопрокрутка
        if (settings.autoScroll) {
            contentEl.scrollTop = contentEl.scrollHeight;
        }
        
        // Обновляем статистику
        updateStats();
    }

    function addInfo(message, source = '') {
        addMessage(message, 'info', source);
    }

    function addSuccess(message, source = '') {
        addMessage(message, 'success', source);
    }

    function addWarning(message, source = '') {
        addMessage(message, 'warning', source);
    }

    function addError(message, source = '') {
        addMessage(message, 'error', source);
    }

    function addDebug(message, source = '') {
        addMessage(message, 'debug', source);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== ФИЛЬТРАЦИЯ ==========
    
    function applyFilter() {
        if (!contentEl) return;
        
        const entries = contentEl.querySelectorAll('.console-entry');
        
        entries.forEach(entry => {
            const type = entry.dataset.type;
            const text = entry.textContent.toLowerCase();
            
            const typeVisible = settings[`show${capitalize(type)}`];
            const textVisible = !settings.filter || text.includes(settings.filter);
            
            entry.style.display = (typeVisible && textVisible) ? '' : 'none';
        });
    }

    // ========== ДЕЙСТВИЯ ==========
    
    function clearConsole() {
        if (!contentEl) return;
        
        contentEl.innerHTML = '';
        
        // Сбрасываем счетчики
        counters = {
            total: 0,
            info: 0,
            success: 0,
            warning: 0,
            error: 0,
            debug: 0
        };
        
        updateStats();
        
        notifyListeners('cleared');
    }

    function copyConsole() {
        if (!contentEl) return;
        
        const text = Array.from(contentEl.children)
            .filter(el => el.style.display !== 'none')
            .map(el => el.textContent)
            .join('\n');
        
        navigator.clipboard.writeText(text).then(() => {
            addSuccess('Консоль скопирована');
        }).catch(() => {
            addError('Не удалось скопировать');
        });
    }

    function exportConsole() {
        if (!contentEl) return;
        
        const text = Array.from(contentEl.children)
            .filter(el => el.style.display !== 'none')
            .map(el => el.textContent)
            .join('\n');
        
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `uwave_console_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        addSuccess('Консоль экспортирована');
    }

    // ========== СТАТИСТИКА ==========
    
    function updateStats() {
        if (!panel) return;
        
        const statsEl = panel.querySelector('#console-stats');
        if (!statsEl) return;
        
        statsEl.innerHTML = `
            <span>Всего: ${counters.total}</span>
            <span style="color:var(--text-info);">Info: ${counters.info}</span>
            <span style="color:var(--border-success);">OK: ${counters.success}</span>
            <span style="color:var(--border-warning);">Warn: ${counters.warning}</span>
            <span style="color:var(--border-danger);">Err: ${counters.error}</span>
        `;
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        updateStats();
        
        // Обновляем переключатели
        const typeCheckboxes = panel.querySelectorAll('.console-type-checkbox');
        typeCheckboxes.forEach(checkbox => {
            checkbox.checked = settings[`show${capitalize(checkbox.dataset.type)}`];
        });
        
        // Обновляем автопрокрутку
        const autoScrollCheckbox = panel.querySelector('#console-auto-scroll');
        if (autoScrollCheckbox) {
            autoScrollCheckbox.checked = settings.autoScroll;
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
                console.warn('[UIConsole] Ошибка слушателя:', e.message);
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
        addMessage,
        addInfo,
        addSuccess,
        addWarning,
        addError,
        addDebug,
        clearConsole,
        copyConsole,
        exportConsole,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIConsole;
}