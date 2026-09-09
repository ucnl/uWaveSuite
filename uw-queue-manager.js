// uw-queue-manager.js — Очередь запросов uWave с приоритетами
// Управляет последовательностью запросов к модему
// Приоритеты: MANUAL (высший) → TRACKING → BACKGROUND (низший)

class UWQueueManager extends EventTarget {

    constructor(port) {
        super();
        
        this.port = port;                   // UWPort instance
        this.queue = [];                    // Очередь запросов
        this.isProcessing = false;          // Флаг обработки
        this.currentRequest = null;         // Текущий выполняемый запрос
        
        // Приоритеты
        this.priorities = {
            MANUAL: 0,      // Ручные запросы пользователя
            TRACKING: 1,    // Запросы трекинга
            BACKGROUND: 2   // Фоновые запросы (ping, status)
        };
        
        // Статистика
        this.stats = {
            total: 0,
            completed: 0,
            failed: 0,
            timeouts: 0
        };
        
        // Подписка на события порта
        this._wirePortEvents();
    }

    _wirePortEvents() {
        this.port.addEventListener('error', (e) => {
            this._handlePortError(e.detail);
        });
        
        this.port.addEventListener('stateChanged', () => {
            if (!this.port.isOpen) {
                this._handlePortClosed();
            }
        });
    }

    // ======================== ДОБАВЛЕНИЕ ЗАПРОСОВ ========================
    
    /**
     * Добавить запрос в очередь
     * @param {Object} request - { id, type, priority, execute, onComplete, onError }
     */
    enqueue(request) {
        const queueItem = {
            id: request.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: request.type || 'generic',
            priority: request.priority || this.priorities.BACKGROUND,
            execute: request.execute,           // async () => result
            onComplete: request.onComplete || null,
            onError: request.onError || null,
            addedAt: Date.now(),
            retries: request.retries || 0,
            maxRetries: request.maxRetries || 0,
            timeout: request.timeout || null,
            data: request.data || null,
            status: 'pending'                   // pending | processing | completed | failed
        };
        
        // Вставляем с учетом приоритета
        this._insertWithPriority(queueItem);
        
        this.stats.total++;
        this._emit('queued', { request: queueItem, queueLength: this.queue.length });
        
        // Запускаем обработку если не идет
        if (!this.isProcessing) {
            this._processNext();
        }
        
        return queueItem.id;
    }

    /**
     * Вставка с учетом приоритета
     */
    _insertWithPriority(queueItem) {
        // Находим позицию для вставки
        let insertIndex = this.queue.length;
        
        for (let i = 0; i < this.queue.length; i++) {
            if (queueItem.priority < this.queue[i].priority) {
                insertIndex = i;
                break;
            }
        }
        
        // Если MANUAL — вставляем в начало (прерываем текущий TRACKING при необходимости)
        if (queueItem.priority === this.priorities.MANUAL) {
            // Если текущий запрос TRACKING или BACKGROUND — прерываем
            if (this.currentRequest && 
                this.currentRequest.priority !== this.priorities.MANUAL) {
                this._interruptCurrent();
            }
            insertIndex = 0;
        }
        
        this.queue.splice(insertIndex, 0, queueItem);
    }

    /**
     * Прерывание текущего запроса
     */
    _interruptCurrent() {
        if (!this.currentRequest) return;
        
        const interrupted = this.currentRequest;
        this._emit('interrupted', { request: interrupted });
        
        // Отменяем текущий запрос
        if (this.currentRequest.cancelFn) {
            try {
                this.currentRequest.cancelFn();
            } catch (e) {
                console.warn('[UWQueue] Cancel error:', e.message);
            }
        }
        
        // Возвращаем в очередь с тем же приоритетом (если не завершен)
        if (interrupted.status === 'processing') {
            interrupted.status = 'pending';
            interrupted.interrupted = true;
            this.queue.unshift(interrupted);
        }
        
        this.currentRequest = null;
        this.isProcessing = false;
    }

    // ======================== ОБРАБОТКА ОЧЕРЕДИ ========================
    
    async _processNext() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        
        // Проверяем порт
        if (!this.port.isOpen || !this.port.detected) {
            this._emit('waiting', { reason: 'port_not_ready' });
            return;
        }
        
        // Берем первый из очереди
        const request = this.queue.shift();
        this.currentRequest = request;
        this.isProcessing = true;
        request.status = 'processing';
        
        this._emit('processing', { request });
        
        try {
            // Выполняем запрос с таймаутом
            const result = await this._executeWithTimeout(request);
            
            // Успех
            request.status = 'completed';
            this.stats.completed++;
            
            this._emit('completed', { request, result });
            
            if (request.onComplete) {
                try {
                    request.onComplete(result);
                } catch (e) {
                    console.warn('[UWQueue] onComplete error:', e.message);
                }
            }
            
        } catch (error) {
            // Ошибка
            request.status = 'failed';
            request.error = error;
            
            // Проверяем retry
            if (request.retries < request.maxRetries && this._isRetryable(error)) {
                request.retries++;
                request.status = 'pending';
                this.queue.unshift(request);
                this._emit('retry', { request, retry: request.retries, error });
            } else {
                if (error.message.includes('timeout')) {
                    this.stats.timeouts++;
                } else {
                    this.stats.failed++;
                }
                
                this._emit('failed', { request, error });
                
                if (request.onError) {
                    try {
                        request.onError(error);
                    } catch (e) {
                        console.warn('[UWQueue] onError error:', e.message);
                    }
                }
            }
        }
        
        // Очищаем текущий запрос
        this.currentRequest = null;
        this.isProcessing = false;
        
        // Запускаем следующий
        setTimeout(() => this._processNext(), 10);
    }

    /**
     * Выполнение с таймаутом
     */
    async _executeWithTimeout(request) {
        if (!request.timeout) {
            return await request.execute();
        }
        
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Request timeout (${request.timeout}ms)`));
            }, request.timeout);
            
            // Функция отмены
            request.cancelFn = () => {
                clearTimeout(timer);
                reject(new Error('Request cancelled'));
            };
            
            try {
                const result = await request.execute();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    /**
     * Проверка возможности повторного выполнения
     */
    _isRetryable(error) {
        // Не повторяем если:
        // - порт закрыт
        // - запрос отменен
        // - ошибка протокола (не таймаут)
        if (!this.port.isOpen) return false;
        if (error.message.includes('cancelled')) return false;
        if (error.message.includes('checksum')) return false;
        
        // Повторяем при таймаутах и сетевых ошибках
        return error.message.includes('timeout') || 
               error.message.includes('NetworkError') ||
               error.message.includes('busy');
    }

    // ======================== ОБРАБОТЧИКИ ОШИБОК ========================
    
    _handlePortError(error) {
        this._emit('portError', error);
        
        // Если есть текущий запрос — проваливаем
        if (this.currentRequest) {
            const request = this.currentRequest;
            request.status = 'failed';
            request.error = new Error(`Port error: ${error.message}`);
            
            this._emit('failed', { request, error: request.error });
            
            if (request.onError) {
                try {
                    request.onError(request.error);
                } catch (e) {}
            }
            
            this.currentRequest = null;
            this.isProcessing = false;
        }
    }

    _handlePortClosed() {
        // Очищаем очередь
        const pending = this.queue;
        this.queue = [];
        
        for (const request of pending) {
            request.status = 'failed';
            request.error = new Error('Port closed');
            
            this._emit('failed', { request, error: request.error });
            
            if (request.onError) {
                try {
                    request.onError(request.error);
                } catch (e) {}
            }
        }
        
        if (this.currentRequest) {
            this.currentRequest = null;
            this.isProcessing = false;
        }
    }

    // ======================== СПЕЦИАЛЬНЫЕ ЗАПРОСЫ ========================
    
    /**
     * Запрос трекинга (циклический опрос маяка)
     */
    enqueueTrackingRequest(txChID, rxChID, cmdID, address) {
        return this.enqueue({
            type: 'tracking',
            priority: this.priorities.TRACKING,
            timeout: 7000, // ACK + remote response
            execute: async () => {
                const result = await this.port.queryRC(txChID, rxChID, cmdID);
                return {
                    ...result,
                    address,
                    timestamp: Date.now()
                };
            },
            onComplete: (result) => {
                this._emit('trackingResult', result);
            },
            onError: (error) => {
                this._emit('trackingError', { address, error });
            },
            retries: 0,
            maxRetries: 1
        });
    }

    /**
     * Ручной запрос (прерывает трекинг)
     */
    enqueueManualRequest(executeFn, description = '') {
        return this.enqueue({
            type: 'manual',
            priority: this.priorities.MANUAL,
            timeout: 10000,
            execute: executeFn,
            description,
            onComplete: (result) => {
                this._emit('manualComplete', { description, result });
            },
            onError: (error) => {
                this._emit('manualError', { description, error });
            }
        });
    }

    /**
     * Фоновый запрос (ping, статус)
     */
    enqueueBackgroundRequest(executeFn, description = '') {
        return this.enqueue({
            type: 'background',
            priority: this.priorities.BACKGROUND,
            timeout: 5000,
            execute: executeFn,
            description,
            onComplete: (result) => {
                this._emit('backgroundComplete', { description, result });
            },
            onError: (error) => {
                this._emit('backgroundError', { description, error });
            }
        });
    }

    // ======================== УПРАВЛЕНИЕ ========================
    
    /**
     * Очистить очередь
     */
    clear() {
        const cleared = this.queue;
        this.queue = [];
        
        for (const request of cleared) {
            request.status = 'failed';
            request.error = new Error('Queue cleared');
            this._emit('failed', { request, error: request.error });
        }
        
        this._emit('cleared', { count: cleared.length });
        return cleared.length;
    }

    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            queueLength: this.queue.length,
            isProcessing: this.isProcessing,
            currentRequest: this.currentRequest ? this.currentRequest.id : null
        };
    }

    /**
     * Получить состояние очереди
     */
    getQueue() {
        return this.queue.map(r => ({
            id: r.id,
            type: r.type,
            priority: r.priority,
            status: r.status,
            description: r.description || r.type,
            addedAt: r.addedAt
        }));
    }

    // ======================== УТИЛИТЫ ========================
    
    _emit(eventType, detail = {}) {
        this.dispatchEvent(new CustomEvent(eventType, { detail }));
    }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWQueueManager;
}