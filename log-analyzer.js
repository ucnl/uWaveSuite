// log-analyzer.js — Анализатор логов uWaveSuite
// Обработка NMEA $PUWV... сообщений, статистика, отчеты

const LogAnalyzer = (() => {

    // ========== КОНСТАНТЫ ==========
    const ManufacturerCode = 'UWV';
    
    // ========== АНАЛИЗ ЗАПИСЕЙ ==========
    
    function analyze(entries) {
        const report = {
            totalEntries: entries.length,
            incoming: 0,
            outgoing: 0,
            errors: 0,
            checksumErrors: 0,
            
            // Статистика по типам сообщений
            messages: {},
            
            // Статистика устройств
            devices: {},
            
            // Временные метки
            firstTimestamp: null,
            lastTimestamp: null,
            durationMs: 0,
            
            // Данные измерений
            measurements: {
                depth: [],
                temperature: [],
                voltage: [],
                azimuth: [],
                msr: [],
                propagationTime: []
            }
        };
        
        for (const entry of entries) {
            // Определяем тип записи
            if (entry.type === 'incoming') {
                report.incoming++;
                processIncoming(entry, report);
            } else if (entry.type === 'outgoing') {
                report.outgoing++;
                processOutgoing(entry, report);
            } else if (entry.type === 'error') {
                report.errors++;
            }
            
            // Временные метки
            if (entry.timestamp) {
                if (!report.firstTimestamp || entry.timestamp < report.firstTimestamp) {
                    report.firstTimestamp = entry.timestamp;
                }
                if (!report.lastTimestamp || entry.timestamp > report.lastTimestamp) {
                    report.lastTimestamp = entry.timestamp;
                }
            }
        }
        
        // Вычисляем длительность
        if (report.firstTimestamp && report.lastTimestamp) {
            report.durationMs = report.lastTimestamp - report.firstTimestamp;
        }
        
        // Вычисляем статистику измерений
        calculateMeasurementStats(report);
        
        return report;
    }
    
    function processIncoming(entry, report) {
        const parsed = UWProtocol.parse(entry.data);
        
        if (!parsed) {
            return;
        }
        
        if (!parsed.valid) {
            if (parsed.error === 'checksum') {
                report.checksumErrors++;
            }
            return;
        }
        
        // Счетчик сообщений
        const msgType = parsed.ic || parsed.sentenceId;
        report.messages[msgType] = (report.messages[msgType] || 0) + 1;
        
        // Обработка по типу
        switch (parsed.ic) {
            case UWProtocol.ICs.IC_D2H_RC_RESPONSE:
                processRCResponse(parsed, report);
                break;
                
            case UWProtocol.ICs.IC_D2H_RC_TIMEOUT:
                processRCTimeout(parsed, report);
                break;
                
            case UWProtocol.ICs.IC_D2H_DINFO:
                processDINFO(parsed, report);
                break;
                
            case UWProtocol.ICs.IC_D2H_AMB_DTA:
                processAMBData(parsed, report);
                break;
        }
    }
    
    function processOutgoing(entry, report) {
        const parsed = UWProtocol.parse(entry.data);
        
        if (!parsed || !parsed.valid) {
            return;
        }
        
        const msgType = parsed.ic || parsed.sentenceId;
        report.messages[msgType] = (report.messages[msgType] || 0) + 1;
    }
    
    function processRCResponse(parsed, report) {
        const address = parsed.txChID !== undefined ? parsed.txChID : 0;
        
        if (!report.devices[address]) {
            report.devices[address] = {
                address,
                responses: 0,
                timeouts: 0,
                firstSeen: null,
                lastSeen: null
            };
        }
        
        const device = report.devices[address];
        device.responses++;
        device.lastSeen = Date.now();
        if (!device.firstSeen) device.firstSeen = Date.now();
        
        // Собираем измерения
        if (!isNaN(parsed.value)) {
            if (parsed.rcCmdID === UWProtocol.RC_CODES.RC_DPT_GET) {
                report.measurements.depth.push(parsed.value);
            } else if (parsed.rcCmdID === UWProtocol.RC_CODES.RC_TMP_GET) {
                report.measurements.temperature.push(parsed.value);
            } else if (parsed.rcCmdID === UWProtocol.RC_CODES.RC_BAT_V_GET) {
                report.measurements.voltage.push(parsed.value);
            }
        }
        
        if (!isNaN(parsed.azimuthDeg)) {
            report.measurements.azimuth.push(parsed.azimuthDeg);
        }
        
        if (!isNaN(parsed.msrDb)) {
            report.measurements.msr.push(parsed.msrDb);
        }
        
        if (!isNaN(parsed.propTimeSec)) {
            report.measurements.propagationTime.push(parsed.propTimeSec);
        }
    }
    
    function processRCTimeout(parsed, report) {
        const address = parsed.txChID !== undefined ? parsed.txChID : 0;
        
        if (!report.devices[address]) {
            report.devices[address] = {
                address,
                responses: 0,
                timeouts: 0,
                firstSeen: null,
                lastSeen: null
            };
        }
        
        report.devices[address].timeouts++;
    }
    
    function processDINFO(parsed, report) {
        report.deviceInfo = {
            serialNumber: parsed.serialNumber,
            systemMoniker: parsed.systemMoniker,
            systemVersion: parsed.systemVersion,
            coreMoniker: parsed.coreMoniker,
            coreVersion: parsed.coreVersion,
            acousticBaudrate: parsed.acousticBaudrate,
            totalCodeChannels: parsed.totalCodeChannels,
            isPTS: parsed.isPTS
        };
    }
    
    function processAMBData(parsed, report) {
        if (!isNaN(parsed.depthM)) report.measurements.depth.push(parsed.depthM);
        if (!isNaN(parsed.temperatureC)) report.measurements.temperature.push(parsed.temperatureC);
        if (!isNaN(parsed.voltageV)) report.measurements.voltage.push(parsed.voltageV);
    }
    
    function calculateMeasurementStats(report) {
        for (const key in report.measurements) {
            const values = report.measurements[key];
            
            if (values.length === 0) continue;
            
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = sum / values.length;
            const min = Math.min(...values);
            const max = Math.max(...values);
            
            // Стандартное отклонение
            const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
            const stdDev = Math.sqrt(variance);
            
            report.measurements[key] = {
                values,
                count: values.length,
                avg,
                min,
                max,
                stdDev
            };
        }
    }
    
    // ========== ФОРМАТИРОВАНИЕ ОТЧЕТА ==========
    
    function formatReport(report) {
        const lines = [];
        
        lines.push('=== uWaveSuite Log Analysis ===');
        lines.push('');
        
        // Общая информация
        lines.push('--- Общая информация ---');
        lines.push(`Всего записей: ${report.totalEntries}`);
        lines.push(`Входящих: ${report.incoming}`);
        lines.push(`Исходящих: ${report.outgoing}`);
        lines.push(`Ошибок: ${report.errors}`);
        lines.push(`Ошибок контрольной суммы: ${report.checksumErrors}`);
        
        if (report.durationMs > 0) {
            lines.push(`Длительность: ${formatDuration(report.durationMs)}`);
        }
        
        lines.push('');
        
        // Информация об устройстве
        if (report.deviceInfo) {
            lines.push('--- Информация об устройстве ---');
            lines.push(`Серийный номер: ${report.deviceInfo.serialNumber}`);
            lines.push(`Система: ${report.deviceInfo.systemMoniker} v${report.deviceInfo.systemVersion}`);
            lines.push(`Ядро: ${report.deviceInfo.coreMoniker} v${report.deviceInfo.coreVersion}`);
            lines.push(`Акустическая скорость: ${report.deviceInfo.acousticBaudrate} бод`);
            lines.push(`Каналов: ${report.deviceInfo.totalCodeChannels}`);
            lines.push(`PTS: ${report.deviceInfo.isPTS ? 'да' : 'нет'}`);
            lines.push('');
        }
        
        // Статистика устройств
        if (Object.keys(report.devices).length > 0) {
            lines.push('--- Устройства ---');
            
            for (const address in report.devices) {
                const device = report.devices[address];
                const total = device.responses + device.timeouts;
                const successRate = total > 0 ? (device.responses / total * 100).toFixed(1) : '--';
                
                lines.push(`Устройство #${address}:`);
                lines.push(`  Ответов: ${device.responses}`);
                lines.push(`  Таймаутов: ${device.timeouts}`);
                lines.push(`  Успешность: ${successRate}%`);
            }
            
            lines.push('');
        }
        
        // Статистика измерений
        lines.push('--- Измерения ---');
        
        if (report.measurements.depth.count) {
            lines.push(`Глубина (м): avg=${report.measurements.depth.avg.toFixed(2)}, min=${report.measurements.depth.min.toFixed(2)}, max=${report.measurements.depth.max.toFixed(2)}, σ=${report.measurements.depth.stdDev.toFixed(2)}, n=${report.measurements.depth.count}`);
        }
        
        if (report.measurements.temperature.count) {
            lines.push(`Температура (°C): avg=${report.measurements.temperature.avg.toFixed(2)}, min=${report.measurements.temperature.min.toFixed(2)}, max=${report.measurements.temperature.max.toFixed(2)}, σ=${report.measurements.temperature.stdDev.toFixed(2)}, n=${report.measurements.temperature.count}`);
        }
        
        if (report.measurements.voltage.count) {
            lines.push(`Напряжение (V): avg=${report.measurements.voltage.avg.toFixed(2)}, min=${report.measurements.voltage.min.toFixed(2)}, max=${report.measurements.voltage.max.toFixed(2)}, σ=${report.measurements.voltage.stdDev.toFixed(2)}, n=${report.measurements.voltage.count}`);
        }
        
        if (report.measurements.azimuth.count) {
            lines.push(`Азимут (°): avg=${report.measurements.azimuth.avg.toFixed(1)}, min=${report.measurements.azimuth.min.toFixed(1)}, max=${report.measurements.azimuth.max.toFixed(1)}, σ=${report.measurements.azimuth.stdDev.toFixed(1)}, n=${report.measurements.azimuth.count}`);
        }
        
        if (report.measurements.msr.count) {
            lines.push(`MSR (dB): avg=${report.measurements.msr.avg.toFixed(1)}, min=${report.measurements.msr.min.toFixed(1)}, max=${report.measurements.msr.max.toFixed(1)}, σ=${report.measurements.msr.stdDev.toFixed(1)}, n=${report.measurements.msr.count}`);
        }
        
        if (report.measurements.propagationTime.count) {
            lines.push(`Время распространения (с): avg=${report.measurements.propagationTime.avg.toFixed(5)}, min=${report.measurements.propagationTime.min.toFixed(5)}, max=${report.measurements.propagationTime.max.toFixed(5)}, n=${report.measurements.propagationTime.count}`);
        }
        
        lines.push('');
        
        // Сообщения
        lines.push('--- Сообщения ---');
        
        const msgTypes = Object.keys(report.messages).sort();
        for (const msgType of msgTypes) {
            lines.push(`${msgType}: ${report.messages[msgType]}`);
        }
        
        return lines.join('\n');
    }
    
    function formatDuration(ms) {
        if (ms < 1000) return `${ms} мс`;
        
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds} с`;
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
        
        const hours = Math.floor(minutes / 60);
        return `${hours} ч ${minutes % 60} мин`;
    }
    
    // ========== ЭКСПОРТ CSV ==========
    
    function exportCSV(report) {
        const lines = [];
        
        lines.push('Parameter,Count,Average,Min,Max,StdDev');
        
        for (const key in report.measurements) {
            const m = report.measurements[key];
            if (m.count) {
                lines.push(`${key},${m.count},${m.avg.toFixed(4)},${m.min.toFixed(4)},${m.max.toFixed(4)},${m.stdDev.toFixed(4)}`);
            }
        }
        
        return lines.join('\n');
    }
    
    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        analyze,
        formatReport,
        exportCSV,
        formatDuration
    };
    
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogAnalyzer;
}