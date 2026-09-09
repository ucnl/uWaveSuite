// modules/ui-export.js — Панель экспорта данных uWaveSuite
// Экспорт треков, устройств, данных в различные форматы

const UIExport = (() => {

    // ========== СОСТОЯНИЕ ==========
    let panel = null;
    let listeners = [];
    let isOpen = false;
    
    // Настройки экспорта
    let exportConfig = {
        format: 'csv',              // 'csv' | 'kml' | 'json' | 'gga' | 'dxf'
        includeDepth: true,
        includeAzimuth: true,
        includeMSR: true,
        includeTemperature: true,
        includeVoltage: true,
        includeCoordinates: true,
        includeTimestamps: true,
        delimiter: ';',             // ';' | ',' | '\t'
        decimalSeparator: '.',      // '.' | ','
        encoding: 'utf-8',          // 'utf-8' | 'cp1251'
        lineEnding: 'crlf',         // 'crlf' | 'lf'
        timezone: 'local'           // 'local' | 'utc'
    };
    
    // Данные для экспорта
    let exportData = {
        devices: [],
        tracks: {},
        stationTrack: []
    };

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(panelId = 'export-panel') {
        panel = document.getElementById(panelId);
        
        if (!panel) {
            console.warn('[UIExport] Panel not found');
            return;
        }
        
        loadSettings();
        initEventHandlers();
        updateUI();
    }

    function initEventHandlers() {
        // Кнопки
        const btnExport = panel.querySelector('#export-btn-export');
        const btnPreview = panel.querySelector('#export-btn-preview');
        const btnCopy = panel.querySelector('#export-btn-copy');
        
        if (btnExport) btnExport.addEventListener('click', () => doExport());
        if (btnPreview) btnPreview.addEventListener('click', () => previewExport());
        if (btnCopy) btnCopy.addEventListener('click', () => copyExport());
        
        // Формат
        const formatSelect = panel.querySelector('#export-format');
        if (formatSelect) {
            formatSelect.addEventListener('change', () => {
                exportConfig.format = formatSelect.value;
                updateFormatSpecificUI();
                saveSettings();
            });
        }
        
        // Разделитель
        const delimiterSelect = panel.querySelector('#export-delimiter');
        if (delimiterSelect) {
            delimiterSelect.addEventListener('change', () => {
                exportConfig.delimiter = delimiterSelect.value;
                saveSettings();
            });
        }
        
        // Десятичный разделитель
        const decimalSelect = panel.querySelector('#export-decimal');
        if (decimalSelect) {
            decimalSelect.addEventListener('change', () => {
                exportConfig.decimalSeparator = decimalSelect.value;
                saveSettings();
            });
        }
        
        // Кодировка
        const encodingSelect = panel.querySelector('#export-encoding');
        if (encodingSelect) {
            encodingSelect.addEventListener('change', () => {
                exportConfig.encoding = encodingSelect.value;
                saveSettings();
            });
        }
        
        // Опции
        const optionCheckboxes = panel.querySelectorAll('.export-option-checkbox');
        optionCheckboxes.forEach(checkbox => {
            checkbox.checked = exportConfig[checkbox.dataset.option];
            checkbox.addEventListener('change', () => {
                exportConfig[checkbox.dataset.option] = checkbox.checked;
                saveSettings();
            });
        });
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem('uwave_export_settings');
            if (saved) {
                exportConfig = { ...exportConfig, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('[UIExport] Ошибка загрузки настроек:', e.message);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem('uwave_export_settings', JSON.stringify(exportConfig));
        } catch (e) {
            console.warn('[UIExport] Ошибка сохранения настроек:', e.message);
        }
    }

    // ========== ОТКРЫТИЕ/ЗАКРЫТИЕ ==========
    
    function open() {
        if (!panel) return;
        
        panel.style.display = 'block';
        isOpen = true;
        
        collectExportData();
        updateUI();
        updateFormatSpecificUI();
        
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

    // ========== СБОР ДАННЫХ ==========
    
    function collectExportData() {
        // Устройства
        const deviceManager = getDeviceManager();
        if (deviceManager) {
            exportData.devices = deviceManager.getAllDevices();
        }
        
        // Треки
        if (typeof Tracks !== 'undefined' && Tracks.getAll) {
            exportData.tracks = Tracks.getAll();
        }
        
        // Трек станции
        if (typeof Tracks !== 'undefined' && Tracks.stationTrack) {
            exportData.stationTrack = Tracks.stationTrack;
        }
    }

    // ========== ОБНОВЛЕНИЕ UI ==========
    
    function updateUI() {
        if (!panel) return;
        
        // Формат
        const formatSelect = panel.querySelector('#export-format');
        if (formatSelect) formatSelect.value = exportConfig.format;
        
        // Разделитель
        const delimiterSelect = panel.querySelector('#export-delimiter');
        if (delimiterSelect) delimiterSelect.value = exportConfig.delimiter;
        
        // Десятичный
        const decimalSelect = panel.querySelector('#export-decimal');
        if (decimalSelect) decimalSelect.value = exportConfig.decimalSeparator;
        
        // Кодировка
        const encodingSelect = panel.querySelector('#export-encoding');
        if (encodingSelect) encodingSelect.value = exportConfig.encoding;
        
        // Опции
        const optionCheckboxes = panel.querySelectorAll('.export-option-checkbox');
        optionCheckboxes.forEach(checkbox => {
            checkbox.checked = exportConfig[checkbox.dataset.option];
        });
        
        // Обновляем статистику
        updateStats();
    }

    function updateFormatSpecificUI() {
        if (!panel) return;
        
        const csvOptions = panel.querySelector('#export-csv-options');
        const kmlOptions = panel.querySelector('#export-kml-options');
        
        if (csvOptions) csvOptions.style.display = exportConfig.format === 'csv' ? 'block' : 'none';
        if (kmlOptions) kmlOptions.style.display = exportConfig.format === 'kml' ? 'block' : 'none';
    }

    function updateStats() {
        if (!panel) return;
        
        const statsEl = panel.querySelector('#export-stats');
        if (!statsEl) return;
        
        const deviceCount = exportData.devices.length;
        const trackCount = Object.keys(exportData.tracks).length;
        const stationPoints = exportData.stationTrack.length;
        
        statsEl.innerHTML = `
            <div class="export-stat-row">
                <span>Устройств:</span>
                <span>${deviceCount}</span>
            </div>
            <div class="export-stat-row">
                <span>Треков маяков:</span>
                <span>${trackCount}</span>
            </div>
            <div class="export-stat-row">
                <span>Точек станции:</span>
                <span>${stationPoints}</span>
            </div>
        `;
    }

    // ========== ЭКСПОРТ ==========
    
    function doExport() {
        const format = exportConfig.format;
        
        switch (format) {
            case 'csv':
                exportCSV();
                break;
            case 'kml':
                exportKML();
                break;
            case 'json':
                exportJSON();
                break;
            case 'gga':
                exportGGA();
                break;
            case 'dxf':
                exportDXF();
                break;
            default:
                exportCSV();
        }
    }

    function exportCSV() {
        const lines = [];
        
        // Заголовок
        const headers = [];
        headers.push('Timestamp');
        headers.push('Device');
        headers.push('Address');
        headers.push('Type');
        
        if (exportConfig.includeAzimuth) headers.push('Azimuth_deg');
        if (exportConfig.includeDepth) headers.push('Depth_m');
        if (exportConfig.includeMSR) headers.push('MSR_dB');
        if (exportConfig.includeTemperature) headers.push('Temperature_C');
        if (exportConfig.includeVoltage) headers.push('Voltage_V');
        if (exportConfig.includeCoordinates) {
            headers.push('Latitude');
            headers.push('Longitude');
        }
        headers.push('Range_m');
        headers.push('PropagationTime_s');
        headers.push('Status');
        
        const delim = getDelimiter();
        lines.push(headers.join(delim));
        
        // Данные устройств
        for (const device of exportData.devices) {
            const row = [];
            
            row.push(formatTimestamp(device.lastUpdateTime));
            row.push('uWave');
            row.push(device.userAddress);
            row.push(device.isUSBL ? 'USBL' : 'Standard');
            
            if (exportConfig.includeAzimuth) row.push(formatNumber(device.azimuthDeg, 1));
            if (exportConfig.includeDepth) row.push(formatNumber(device.depthM, 1));
            if (exportConfig.includeMSR) row.push(formatNumber(device.msrDB, 1));
            if (exportConfig.includeTemperature) row.push(formatNumber(device.temperatureC, 1));
            if (exportConfig.includeVoltage) row.push(formatNumber(device.voltageV, 1));
            if (exportConfig.includeCoordinates) {
                row.push(formatNumber(device.latitudeDeg, 8));
                row.push(formatNumber(device.longitudeDeg, 8));
            }
            row.push(formatNumber(device.absoluteDistanceM, 2));
            row.push(formatNumber(device.propTimeS, 5));
            row.push(device.isTimeout ? 'Timeout' : 'OK');
            
            lines.push(row.join(delim));
        }
        
        // Скачивание
        downloadFile(lines.join(getLineEnding()), 'text/csv', `uwave_data_${getDateString()}.csv`);
        
        showStatus(`Экспортировано ${exportData.devices.length} устройств`, 'success');
    }

    function exportKML() {
        const lines = [];
        
        // KML заголовок
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');
        lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
        lines.push('<Document>');
        lines.push(`<name>uWaveSuite Export ${getDateString()}</name>`);
        
        // Стили
        lines.push('<Style id="usblStyle">');
        lines.push('<IconStyle><color>ff00ff00</color><scale>1.0</scale></IconStyle>');
        lines.push('</Style>');
        lines.push('<Style id="standardStyle">');
        lines.push('<IconStyle><color>ff0000ff</color><scale>1.0</scale></IconStyle>');
        lines.push('</Style>');
        
        // Устройства
        for (const device of exportData.devices) {
            if (isNaN(device.latitudeDeg) || isNaN(device.longitudeDeg)) continue;
            
            lines.push('<Placemark>');
            lines.push(`<name>Device #${device.userAddress}</name>`);
            lines.push(`<description>Type: ${device.isUSBL ? 'USBL' : 'Standard'}, Depth: ${formatNumber(device.depthM, 1)}m</description>`);
            lines.push(`<styleUrl>#${device.isUSBL ? 'usblStyle' : 'standardStyle'}</styleUrl>`);
            lines.push(`<Point><coordinates>${device.longitudeDeg},${device.latitudeDeg},${device.depthM || 0}</coordinates></Point>`);
            lines.push('</Placemark>');
        }
        
        // Треки
        for (const address in exportData.tracks) {
            const track = exportData.tracks[address];
            if (track.length < 2) continue;
            
            lines.push('<Placemark>');
            lines.push(`<name>Track #${parseInt(address) + 1}</name>`);
            lines.push('<LineString>');
            lines.push('<coordinates>');
            
            for (const point of track) {
                if (isNaN(point.lat) || isNaN(point.lon)) continue;
                lines.push(`${point.lon},${point.lat},${point.depth || 0}`);
            }
            
            lines.push('</coordinates>');
            lines.push('</LineString>');
            lines.push('</Placemark>');
        }
        
        lines.push('</Document>');
        lines.push('</kml>');
        
        downloadFile(lines.join('\n'), 'application/vnd.google-earth.kml+xml', `uwave_tracks_${getDateString()}.kml`);
        
        showStatus('KML экспортирован', 'success');
    }

    function exportJSON() {
        const data = {
            type: 'uwave_export',
            timestamp: new Date().toISOString(),
            settings: UWSettingsStorage.getSettings(),
            devices: exportData.devices.map(d => ({
                address: d.address,
                type: d.type,
                userAddress: d.userAddress,
                isUSBL: d.isUSBL,
                slantRangeM: d.slantRangeM,
                azimuthDeg: d.azimuthDeg,
                depthM: d.depthM,
                latitudeDeg: d.latitudeDeg,
                longitudeDeg: d.longitudeDeg,
                temperatureC: d.temperatureC,
                voltageV: d.voltageV,
                msrDB: d.msrDB,
                propTimeS: d.propTimeS,
                succeededRequests: d.succeededRequests,
                failedRequests: d.failedRequests,
                timeouts: d.timeouts,
                lastUpdateTime: d.lastUpdateTime
            })),
            tracks: exportData.tracks,
            stationTrack: exportData.stationTrack
        };
        
        const json = JSON.stringify(data, null, 2);
        downloadFile(json, 'application/json', `uwave_export_${getDateString()}.json`);
        
        showStatus('JSON экспортирован', 'success');
    }

    function exportGGA() {
        const lines = [];
        
        for (const device of exportData.devices) {
            if (isNaN(device.latitudeDeg) || isNaN(device.longitudeDeg)) continue;
            
            const gga = buildGGA(
                device.latitudeDeg,
                device.longitudeDeg,
                device.depthM || 0,
                device.userAddress
            );
            
            lines.push(gga);
        }
        
        downloadFile(lines.join(getLineEnding()), 'text/plain', `uwave_gga_${getDateString()}.txt`);
        
        showStatus(`GGA экспортировано (${lines.length} предложений)`, 'success');
    }

    function buildGGA(latDeg, lonDeg, depthM, address) {
        const lat = Math.abs(latDeg);
        const latDegInt = Math.floor(lat);
        const latMin = (lat - latDegInt) * 60;
        const latHemisphere = latDeg >= 0 ? 'N' : 'S';
        
        const lon = Math.abs(lonDeg);
        const lonDegInt = Math.floor(lon);
        const lonMin = (lon - lonDegInt) * 60;
        const lonHemisphere = lonDeg >= 0 ? 'E' : 'W';
        
        const time = new Date().toISOString().slice(11, 19).replace(/:/g, '');
        
        const latStr = `${String(latDegInt).padStart(2, '0')}${latMin.toFixed(4).padStart(7, '0')}`;
        const lonStr = `${String(lonDegInt).padStart(3, '0')}${lonMin.toFixed(4).padStart(7, '0')}`;
        
        let gga = `$GPGGA,${time},${latStr},${latHemisphere},${lonStr},${lonHemisphere},1,08,0.9,${depthM.toFixed(1)},M,0.0,M,,`;
        
        // Контрольная сумма
        let checksum = 0;
        for (let i = 1; i < gga.length; i++) {
            checksum ^= gga.charCodeAt(i);
        }
        gga += `*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
        
        return gga;
    }

    function exportDXF() {
        const lines = [];
        
        // DXF заголовок
        lines.push('0');
        lines.push('SECTION');
        lines.push('2');
        lines.push('ENTITIES');
        
        // Устройства как точки
        for (const device of exportData.devices) {
            if (isNaN(device.xM) || isNaN(device.yM)) continue;
            
            lines.push('0');
            lines.push('POINT');
            lines.push('8');
            lines.push('DEVICES');
            lines.push('10');
            lines.push(device.xM.toFixed(3));
            lines.push('20');
            lines.push(device.yM.toFixed(3));
            lines.push('30');
            lines.push((device.zM || 0).toFixed(3));
        }
        
        // Треки как линии
        for (const address in exportData.tracks) {
            const track = exportData.tracks[address];
            
            for (let i = 0; i < track.length - 1; i++) {
                const p1 = track[i];
                const p2 = track[i + 1];
                
                if (isNaN(p1.xM) || isNaN(p1.yM) || isNaN(p2.xM) || isNaN(p2.yM)) continue;
                
                lines.push('0');
                lines.push('LINE');
                lines.push('8');
                lines.push('TRACKS');
                lines.push('10');
                lines.push(p1.xM.toFixed(3));
                lines.push('20');
                lines.push(p1.yM.toFixed(3));
                lines.push('30');
                lines.push((p1.zM || 0).toFixed(3));
                lines.push('11');
                lines.push(p2.xM.toFixed(3));
                lines.push('21');
                lines.push(p2.yM.toFixed(3));
                lines.push('31');
                lines.push((p2.zM || 0).toFixed(3));
            }
        }
        
        lines.push('0');
        lines.push('ENDSEC');
        lines.push('0');
        lines.push('EOF');
        
        downloadFile(lines.join('\n'), 'application/dxf', `uwave_tracks_${getDateString()}.dxf`);
        
        showStatus('DXF экспортирован', 'success');
    }

    // ========== ПРЕДПРОСМОТР ==========
    
    function previewExport() {
        if (!panel) return;
        
        const previewEl = panel.querySelector('#export-preview');
        if (!previewEl) return;
        
        let preview = '';
        
        switch (exportConfig.format) {
            case 'csv':
                preview = generateCSVPreview();
                break;
            case 'kml':
                preview = 'KML экспорт (превью недоступно)';
                break;
            case 'json':
                preview = generateJSONPreview();
                break;
            case 'gga':
                preview = generateGGAPreview();
                break;
            default:
                preview = 'Превью недоступно для выбранного формата';
        }
        
        previewEl.textContent = preview;
        previewEl.style.display = 'block';
    }

    function generateCSVPreview() {
        const lines = [];
        const delim = getDelimiter();
        
        lines.push(['Address', 'Type', 'Azimuth', 'Depth', 'Range'].join(delim));
        
        for (const device of exportData.devices.slice(0, 5)) {
            lines.push([
                device.userAddress,
                device.isUSBL ? 'USBL' : 'Std',
                formatNumber(device.azimuthDeg, 1),
                formatNumber(device.depthM, 1),
                formatNumber(device.absoluteDistanceM, 2)
            ].join(delim));
        }
        
        if (exportData.devices.length > 5) {
            lines.push(`... и еще ${exportData.devices.length - 5} устройств`);
        }
        
        return lines.join('\n');
    }

    function generateJSONPreview() {
        const preview = {
            deviceCount: exportData.devices.length,
            trackCount: Object.keys(exportData.tracks).length,
            stationPoints: exportData.stationTrack.length
        };
        
        return JSON.stringify(preview, null, 2);
    }

    function generateGGAPreview() {
        const device = exportData.devices.find(d => !isNaN(d.latitudeDeg) && !isNaN(d.longitudeDeg));
        
        if (!device) {
            return 'Нет устройств с координатами';
        }
        
        return buildGGA(device.latitudeDeg, device.longitudeDeg, device.depthM || 0, device.userAddress);
    }

    // ========== КОПИРОВАНИЕ ==========
    
    function copyExport() {
        if (!panel) return;
        
        const previewEl = panel.querySelector('#export-preview');
        if (!previewEl || !previewEl.textContent) {
            showStatus('Нет данных для копирования', 'warning');
            return;
        }
        
        navigator.clipboard.writeText(previewEl.textContent).then(() => {
            showStatus('Скопировано в буфер', 'success');
        }).catch(() => {
            showStatus('Не удалось скопировать', 'error');
        });
    }

    // ========== УТИЛИТЫ ==========
    
    function getDelimiter() {
        switch (exportConfig.delimiter) {
            case 'comma': return ',';
            case 'tab': return '\t';
            case 'semicolon': return ';';
            default: return ';';
        }
    }

    function getLineEnding() {
        return exportConfig.lineEnding === 'crlf' ? '\r\n' : '\n';
    }

    function formatNumber(value, decimals = 2) {
        if (isNaN(value) || value === null || value === undefined) {
            return '';
        }
        
        let result = value.toFixed(decimals);
        
        if (exportConfig.decimalSeparator === ',') {
            result = result.replace('.', ',');
        }
        
        return result;
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        
        if (exportConfig.timezone === 'utc') {
            return date.toISOString();
        } else {
            return date.toLocaleString('ru-RU');
        }
    }

    function getDateString() {
        return new Date().toISOString().slice(0, 10);
    }

    function downloadFile(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== СТАТУС ==========
    
    function showStatus(message, type = 'info') {
        if (!panel) return;
        
        const statusEl = panel.querySelector('#export-status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'export-status ' + type;
    }

    // ========== ПОЛУЧЕНИЕ ЗАВИСИМОСТЕЙ ==========
    
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
                console.warn('[UIExport] Ошибка слушателя:', e.message);
            }
        }
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        init,
        open,
        close,
        toggle,
        doExport,
        previewExport,
        copyExport,
        subscribe
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIExport;
}