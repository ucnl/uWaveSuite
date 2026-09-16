// uw-port.js — Драйвер порта uWave

class UWPort extends EventTarget {

    constructor(baudRate = 9600) {
        super();
        
        this.serial = new SerialBridge();
        this.baudRate = baudRate;
        
        // Состояние
        this.detected = false;
        this.connecting = false;
        this.isWaitingLocal = false;
        this.isWaitingRemote = false;
        
        // Таймер
        this.timerPeriodMs = 200;
        this.timeoutTimer = null;
        this.timerCnt = 0;
        this.timerCntMax = 5;
        
        // Таймауты
        this.defaultTimeoutMs = 1000;
        this.longTimeoutMs = 3000;
        this.remoteTimeoutMs = 6000;
        
        // Текущий запрос
        this.currentQuery = null;
        this.lastQueryID = UWProtocol.ICs.IC_INVALID;
        this.rcQueryRxChID = -1;
        
        // Информация об устройстве
        this.deviceInfo = {
            serialNumber: '',
            systemMoniker: '',
            systemVersion: '',
            coreMoniker: '',
            coreVersion: '',
            acousticBaudrate: 0,
            rxChID: 0,
            txChID: 0,
            totalCodeChannels: 0,
            salinityPSU: 0,
            isPTS: false,
            isCommandModeByDefault: false,
            isACKOnTxFinished: false,
            ptAddress: 0,
            isValid: false
        };
        
        // Сенсоры
        this.sensors = {
            pitchDeg: null,
            rollDeg: null,
            pressureMbar: null,
            temperatureC: null,
            depthM: null,
            voltageV: null
        };
        
        // Колбэки SerialBridge
        this.serial.onMessage = (line) => this._onNMEAMessage(line);
        this.serial.onError = (err) => this._onError(err);
        this.serial.onClose = () => this._onClose();
    }

    get isOpen() {
        return this.serial.isOpen;
    }

    // ======================== ОТКРЫТИЕ/ЗАКРЫТИЕ ========================
    
    async open() {
        if (this.connecting || this.serial.isOpen) {
            throw new Error('Already connecting or connected');
        }
        
        this.connecting = true;
        
        try {
            await this.serial.open(this.baudRate);
            
            // Отправляем DINFO запрос
            const msg = UWProtocol.buildDINFOGet();
            await this.serial.send(msg);
            
            this._emit('log', { message: `SND << ${msg.trim()}` });
            
            this._startTimer(this.defaultTimeoutMs);
            
        } catch (err) {
            this.connecting = false;
            this._emit('error', { message: err.message });
            throw err;
        }
    }

    async close() {
        this._stopTimer();
        await this.serial.close();
        this.detected = false;
        this.deviceInfo.isValid = false;
        this.connecting = false;
        this.isWaitingLocal = false;
        this.isWaitingRemote = false;
        this._emit('stateChanged');
    }

    _onClose() {
        this._stopTimer();
        this._emit('log', { message: 'Port closed' });
        this.detected = false;
        this.deviceInfo.isValid = false;
        this.connecting = false;
        this._emit('stateChanged');
    }

    _onError(err) {
        this._emit('error', { message: err.message });
    }

    // ======================== ТАЙМЕР ========================
    
    _startTimer(timeoutMs) {
        this._stopTimer();
        this.timerCnt = 0;
        this.timerCntMax = Math.max(1, Math.ceil(timeoutMs / this.timerPeriodMs));
        this.timeoutTimer = setInterval(() => this._timerTick(), this.timerPeriodMs);
    }

    _stopTimer() {
        if (this.timeoutTimer) {
            clearInterval(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        this.timerCnt = 0;
    }

    _resetTimer() {
        this.timerCnt = 0;
    }

    _timerTick() {
        this.timerCnt++;
        if (this.timerCnt >= this.timerCntMax) {
            this._stopTimer();
            
            if (this.detected) {
                this._emit('timeout', { queryID: this.lastQueryID });
                this.detected = false;
                this.isWaitingLocal = false;
                this.isWaitingRemote = false;
                this._emit('stateChanged');
            } else {
                this.connecting = false;
                this._emit('error', { message: 'Timeout waiting for device response' });
            }
        }
    }

    // ======================== ОБРАБОТКА ВХОДЯЩИХ ========================
    
	_onNMEAMessage(rawLine) {
		this._resetTimer();
		this._emit('log', { message: `RCV >> ${rawLine.trim()}` });
		
		// Логируем в Logger если доступен
		if (typeof Logger !== 'undefined' && Logger.logIncoming) {
			Logger.logIncoming('UWV', rawLine.trim());
		}
		
		const parsed = UWProtocol.parse(rawLine);
		
		if (!parsed) return;
		
		if (parsed.valid === false) {
			if (parsed.error === 'checksum') {
				this._emit('log', { message: `Checksum error: ${rawLine.trim()}` });
			}
			return;
		}
		
		if (!this.detected) {
			this.detected = true;
			this._stopTimer();
			this._emit('stateChanged');
		}
		
		this._processIncoming(parsed);
	}

    _processIncoming(parsed) {
        switch (parsed.sentenceId || parsed.type) {
            case '0':
            case 'ack':
                this._handleACK(parsed);
                break;
            case '3':
            case 'rcResponse':
                this._handleRCResponse(parsed);
                break;
            case '4':
            case 'rcTimeout':
                this._handleRCTimeout(parsed);
                break;
            case '5':
            case 'rcAsyncIn':
                this._handleRCAsync(parsed);
                break;
            case '7':
            case 'ambData':
                this._handleAMBData(parsed);
                break;
            case '9':
            case 'incData':
                this._handleINCData(parsed);
                break;
            case '!':
            case 'dinfo':
                this._handleDINFO(parsed);
                break;
            case 'E':
            case 'ptSettings':
                this._handlePTSettings(parsed);
                break;
				
			case 'H':
			case 'ptFailed':
				this._handlePTFailed(parsed);
				break;
			case 'I':
			case 'ptDelivered':
				this._handlePTDelivered(parsed);
				break;
			case 'J':
			case 'ptReceived':
				this._handlePTReceived(parsed);
				break;

			// === НОВЫЕ: PT ITG (короткий логический запрос) ===
			case 'L':
			case 'ptITGTimeout':
				this._handlePTITGTimeout(parsed);
				break;
			case 'M':
			case 'ptITGResponse':
				this._handlePTITGResponse(parsed);
				break;

			// === НОВЫЕ: AQPNG (автономный пинг) ===
			case 'O':
			case 'aqpngSettings':
				this._handleAQPNGSettings(parsed);
				break;

			// === Прочее (на всякий случай) ===
			default:
				// Неизвестный тип — можно залогировать в debug
				// this._emit('log', { message: `Unhandled sentence: ${parsed.sentenceId}` });
				break;
				
				
        }
    }

    // ======================== ОБРАБОТЧИКИ ========================
    
    _handleACK(parsed) {
        this._stopTimer();
        this.isWaitingLocal = false;
        
        if (parsed.sentenceID === UWProtocol.ICs.IC_H2D_RC_REQUEST || 
            parsed.sentenceID === UWProtocol.ICs.IC_H2D_PT_ITG) {
            this.isWaitingRemote = true;
            this._startTimer(this.remoteTimeoutMs);
        }
        
        this._emit('ackReceived', parsed);
        this._emit('stateChanged');
    }

    _handleRCResponse(parsed) {
        this._stopTimer();
        this.isWaitingRemote = false;
		parsed.rxChID = this.rcQueryRxChID;
        this._emit('rcResponse', parsed);
        this._emit('stateChanged');
    }

    _handleRCTimeout(parsed) {
        this._stopTimer();
        this.isWaitingRemote = false;
		parsed.rxChID = this.rcQueryRxChID;
        this._emit('rcTimeout', parsed);
        this._emit('stateChanged');
    }

    _handleRCAsync(parsed) {
        this._stopTimer();
        this.isWaitingRemote = false;
        this._emit('rcAsyncIn', parsed);
        this._emit('stateChanged');
    }

    _handleAMBData(parsed) {
        if (!isNaN(parsed.pressureMbar)) this.sensors.pressureMbar = parsed.pressureMbar;
        if (!isNaN(parsed.temperatureC)) this.sensors.temperatureC = parsed.temperatureC;
        if (!isNaN(parsed.depthM)) this.sensors.depthM = parsed.depthM;
        if (!isNaN(parsed.voltageV)) this.sensors.voltageV = parsed.voltageV;
        this._emit('ambData', this.sensors);
    }

    _handleINCData(parsed) {
        if (!isNaN(parsed.pitchDeg)) this.sensors.pitchDeg = parsed.pitchDeg;
        if (!isNaN(parsed.rollDeg)) this.sensors.rollDeg = parsed.rollDeg;
        this._emit('incData', this.sensors);
    }

    _handleDINFO(parsed) {
        this.deviceInfo = {
            serialNumber: parsed.serialNumber,
            systemMoniker: parsed.systemMoniker,
            systemVersion: parsed.systemVersion,
            coreMoniker: parsed.coreMoniker,
            coreVersion: parsed.coreVersion,
            acousticBaudrate: parsed.acousticBaudrate,
            rxChID: parsed.rxChID,
            txChID: parsed.txChID,
            totalCodeChannels: parsed.totalCodeChannels,
            salinityPSU: parsed.salinityPSU,
            isPTS: parsed.isPTS,
            isCommandModeByDefault: parsed.isCommandModeByDefault,
            isValid: true
        };
        
        this._stopTimer();
        this.isWaitingLocal = false;
        this.connecting = false;
        this.detected = true;
        
        this._emit('deviceInfo', this.deviceInfo);
        this._emit('stateChanged');
    }

    _handlePTSettings(parsed) {
        this._stopTimer();
        this.isWaitingLocal = false;
        this.deviceInfo.ptAddress = parsed.ptAddress;
        this._emit('ptSettings', parsed);
        this._emit('stateChanged');
    }

    _handlePTFailed(parsed) {
        this._emit('packetTransferFailed', parsed);
    }

    _handlePTDelivered(parsed) {
        this._emit('packetTransferred', parsed);
    }

    _handlePTReceived(parsed) {
        this._emit('packetReceived', parsed);
    }

    _handlePTITGTimeout(parsed) {
        this._stopTimer();
        this.isWaitingRemote = false;
        this._emit('packetRequestTimeout', parsed);
        this._emit('stateChanged');
    }

    _handlePTITGResponse(parsed) {
        this._stopTimer();
        this.isWaitingRemote = false;
        this._emit('packetResponse', parsed);
        this._emit('stateChanged');
    }

    _handleAQPNGSettings(parsed) {
        this._stopTimer();
        this.isWaitingLocal = false;
        this._emit('aqpngSettings', parsed);
        this._emit('stateChanged');
    }

    // ======================== ОТПРАВКА КОМАНД ========================
    
	_trySend(message, queryID, timeoutMs = null) {
		if (!this.detected || this.isWaitingLocal || this.isWaitingRemote) {
			return false;
		}
		
		try {
			this.serial.send(message);
			this._emit('log', { message: `SND << ${message.trim()}` });
			
			// Логируем в Logger если доступен
			if (typeof Logger !== 'undefined' && Logger.logOutgoing) {
				Logger.logOutgoing('UWV', message.trim());
			}
			
			const timeout = timeoutMs || (
				[UWProtocol.ICs.IC_H2D_SETTINGS_WRITE,
				 UWProtocol.ICs.IC_H2H_PT_SETTINGS_WRITE,
				 UWProtocol.ICs.IC_H2D_AMB_DTA_CFG,
				 UWProtocol.ICs.IC_H2D_INC_DTA_CFG].includes(queryID)
					? this.longTimeoutMs
					: this.defaultTimeoutMs
			);
			
			this._startTimer(timeout);
			this.isWaitingLocal = true;
			this.lastQueryID = queryID;
			this._emit('stateChanged');
			return true;
			
		} catch (err) {
			this._emit('error', { message: `Send error: ${err.message}` });
			return false;
		}
	}

    queryDINFO() { return this._trySend(UWProtocol.buildDINFOGet(), UWProtocol.ICs.IC_H2D_DINFO_GET); }
    
    querySettingsWrite(txChID, rxChID, salinityPSU, isCmdMode, isACKOnTXFinished, gravityAcc) {
        this.isACKOnTxFinished = isACKOnTXFinished;
        return this._trySend(
            UWProtocol.buildSettingsWrite(txChID, rxChID, salinityPSU, isCmdMode, isACKOnTXFinished, gravityAcc),
            UWProtocol.ICs.IC_H2D_SETTINGS_WRITE
        );
    }
    
    queryAmbCfgWrite(isSaveToFlash, periodMs, isPressure, isTemperature, isDepth, isVCC) {
        return this._trySend(
            UWProtocol.buildAmbCfgWrite(isSaveToFlash, periodMs, isPressure, isTemperature, isDepth, isVCC),
            UWProtocol.ICs.IC_H2D_AMB_DTA_CFG
        );
    }
    
    queryIncCfgWrite(isSaveToFlash, periodMs) {
        return this._trySend(
            UWProtocol.buildIncCfgWrite(isSaveToFlash, periodMs),
            UWProtocol.ICs.IC_H2D_INC_DTA_CFG
        );
    }
    
	queryRC(txChID, rxChID, cmdID) {
		if (this.isWaitingRemote) return false;
		this.rcQueryRxChID = rxChID;
		return this._trySend(
			UWProtocol.buildRCRequest(txChID, rxChID, cmdID),
			UWProtocol.ICs.IC_H2D_RC_REQUEST
		);
	}
    
    queryPTSettings() { return this._trySend(UWProtocol.buildPTSettingsRead(), UWProtocol.ICs.IC_H2D_PT_SETTINGS_READ); }
    
    queryPTSettingsWrite(isSaveInFlash, isPTMode, ptAddress) {
        return this._trySend(
            UWProtocol.buildPTSettingsWrite(isSaveInFlash, isPTMode, ptAddress),
            UWProtocol.ICs.IC_H2H_PT_SETTINGS_WRITE
        );
    }
    
    queryPTAbortSend() { return this._trySend(UWProtocol.buildPTAbortSend(), UWProtocol.ICs.IC_H2D_PT_SEND); }
    
    queryPTSend(targetPtAddress, data, maxTries = null) {
        if (data.length > 64) {
            this._emit('log', { message: 'ERROR: Packet size exceeds 64 bytes' });
            return false;
        }
        return this._trySend(
            UWProtocol.buildPTSend(targetPtAddress, data, maxTries),
            UWProtocol.ICs.IC_H2D_PT_SEND
        );
    }
    
    queryPTITG(targetPtAddress, dataID) {
        return this._trySend(
            UWProtocol.buildPTITG(targetPtAddress, dataID),
            UWProtocol.ICs.IC_H2D_PT_ITG
        );
    }
    
    queryAQPNGSettings() { return this._trySend(UWProtocol.buildAQPNGSettingsRead(), UWProtocol.ICs.IC_H2D_AQPNG_SETTINGS_READ); }
    
    queryAQPNGSettingsWrite(isSaveToFlash, modeID, periodMs, dataID, rcTxChID, rcRxChID, isPT, ptTargetAddr) {
        return this._trySend(
            UWProtocol.buildAQPNGSettingsWrite(isSaveToFlash, modeID, periodMs, dataID, rcTxChID, rcRxChID, isPT, ptTargetAddr),
            UWProtocol.ICs.IC_HDH_AQPNG_SETTINGS
        );
    }

    // ======================== УТИЛИТЫ ========================
    
    _emit(eventType, detail = {}) {
        this.dispatchEvent(new CustomEvent(eventType, { detail }));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWPort;
}