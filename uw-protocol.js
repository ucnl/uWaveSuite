// uw-protocol.js — Ядро протокола uWave (NMEA $PUWV...)
// Константы, енумы, построение и парсинг предложений
// Основано на uWavePort.js из uWaver

const UWProtocol = (() => {

    // ======================== КОНСТАНТЫ И ЕНУМЫ ========================
    
    const ManufacturerCode = 'UWV';
    
    const ICs = Object.freeze({
        IC_D2H_ACK: 'IC_D2H_ACK',
        IC_H2D_SETTINGS_WRITE: 'IC_H2D_SETTINGS_WRITE',
        IC_H2D_RC_REQUEST: 'IC_H2D_RC_REQUEST',
        IC_D2H_RC_RESPONSE: 'IC_D2H_RC_RESPONSE',
        IC_D2H_RC_TIMEOUT: 'IC_D2H_RC_TIMEOUT',
        IC_D2H_RC_ASYNC_IN: 'IC_D2H_RC_ASYNC_IN',
        IC_H2D_AMB_DTA_CFG: 'IC_H2D_AMB_DTA_CFG',
        IC_D2H_AMB_DTA: 'IC_D2H_AMB_DTA',
        IC_H2D_INC_DTA_CFG: 'IC_H2D_INC_DTA_CFG',
        IC_D2H_INC_DTA: 'IC_D2H_INC_DTA',
        IC_H2D_DINFO_GET: 'IC_H2D_DINFO_GET',
        IC_D2H_DINFO: 'IC_D2H_DINFO',
        IC_H2D_PT_SETTINGS_READ: 'IC_H2D_PT_SETTINGS_READ',
        IC_D2H_PT_SETTINGS: 'IC_D2H_PT_SETTINGS',
        IC_H2H_PT_SETTINGS_WRITE: 'IC_H2H_PT_SETTINGS_WRITE',
        IC_H2D_PT_SEND: 'IC_H2D_PT_SEND',
        IC_D2H_PT_FAILED: 'IC_D2H_PT_FAILED',
        IC_D2H_PT_DLVRD: 'IC_D2H_PT_DLVRD',
        IC_D2H_PT_RCVD: 'IC_D2H_PT_RCVD',
        IC_H2D_PT_ITG: 'IC_H2D_PT_ITG',
        IC_D2H_PT_ITG_TMO: 'IC_D2H_PT_ITG_TMO',
        IC_D2H_PT_ITG_RESP: 'IC_D2H_PT_ITG_RESP',
        IC_H2D_AQPNG_SETTINGS_READ: 'IC_H2D_AQPNG_SETTINGS_READ',
        IC_HDH_AQPNG_SETTINGS: 'IC_HDH_AQPNG_SETTINGS',
        IC_D2H_ANY: 'IC_D2H_ANY',
        IC_INVALID: 'IC_INVALID'
    });

    const RC_CODES = Object.freeze({
        RC_PING: 0,
        RC_PONG: 1,
        RC_DPT_GET: 2,
        RC_TMP_GET: 3,
        RC_BAT_V_GET: 4,
        RC_ERR_NSUP: 5,
        RC_ACK: 6,
        RC_USR_CMD_000: 7,
        RC_USR_CMD_001: 8,
        RC_USR_CMD_002: 9,
        RC_USR_CMD_003: 10,
        RC_USR_CMD_004: 11,
        RC_USR_CMD_005: 12,
        RC_USR_CMD_006: 13,
        RC_USR_CMD_007: 14,
        RC_USR_CMD_008: 15,
        RC_MSG_ASYNC_IN: 16,
        RC_INVALID: -1
    });

    const LOC_ERR = Object.freeze({
        LOC_ERR_NO_ERROR: 0,
        LOC_ERR_INVALID_SYNTAX: 1,
        LOC_ERR_UNSUPPORTED: 2,
        LOC_ERR_TRANSMITTER_BUSY: 3,
        LOC_ERR_ARGUMENT_OUT_OF_RANGE: 4,
        LOC_ERR_INVALID_OPERATION: 5,
        LOC_ERR_UNKNOWN_FIELD_ID: 6,
        LOC_ERR_VALUE_UNAVAILABLE: 7,
        LOC_ERR_RECEIVER_BUSY: 8,
        LOC_ERR_TX_BUFFER_OVERRUN: 9,
        LOC_ERR_CHKSUM_ERROR: 10,
        LOC_ERR_TX_FINISHED: 11,
        LOC_ACK_BEFORE_STANDBY: 12,
        LOC_ACK_AFTER_WAKEUP: 13,
        LOC_ERR_SVOLTAGE_TOO_HIGH: 14,
        LOC_ERR_UNKNOWN: -1
    });

    const DataID = Object.freeze({
        DID_DPT: 0,
        DID_TMP: 1,
        DID_BAT: 2,
        DID_INVALID: -1
    });

    const AQPNGMode = Object.freeze({
        AQPNG_DISABLED: 0,
        AQPNG_PINGER: 1,
        AQPNG_MASTER: 2,
        AQPNG_INVALID: -1
    });

    // Маппинг ID предложений → ICs
    const MsgIDToIC = {
        '0': ICs.IC_D2H_ACK,
        '1': ICs.IC_H2D_SETTINGS_WRITE,
        '2': ICs.IC_H2D_RC_REQUEST,
        '3': ICs.IC_D2H_RC_RESPONSE,
        '4': ICs.IC_D2H_RC_TIMEOUT,
        '5': ICs.IC_D2H_RC_ASYNC_IN,
        '6': ICs.IC_H2D_AMB_DTA_CFG,
        '7': ICs.IC_D2H_AMB_DTA,
        '8': ICs.IC_H2D_INC_DTA_CFG,
        '9': ICs.IC_D2H_INC_DTA,
        '?': ICs.IC_H2D_DINFO_GET,
        '!': ICs.IC_D2H_DINFO,
        'D': ICs.IC_H2D_PT_SETTINGS_READ,
        'E': ICs.IC_D2H_PT_SETTINGS,
        'F': ICs.IC_H2H_PT_SETTINGS_WRITE,
        'G': ICs.IC_H2D_PT_SEND,
        'H': ICs.IC_D2H_PT_FAILED,
        'I': ICs.IC_D2H_PT_DLVRD,
        'J': ICs.IC_D2H_PT_RCVD,
        'K': ICs.IC_H2D_PT_ITG,
        'L': ICs.IC_D2H_PT_ITG_TMO,
        'M': ICs.IC_D2H_PT_ITG_RESP,
        'N': ICs.IC_H2D_AQPNG_SETTINGS_READ,
        'O': ICs.IC_HDH_AQPNG_SETTINGS
    };

    // ======================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ========================
    
    function o2i(val) {
        if (val === null || val === undefined || val === '') return -1;
        const i = parseInt(val);
        return isNaN(i) ? -1 : i;
    }

    function o2d(val) {
        if (val === null || val === undefined || val === '') return NaN;
        const d = parseFloat(val);
        return isNaN(d) ? NaN : d;
    }

    function o2s(val) {
        return val === null || val === undefined ? '' : String(val);
    }

    function o2rc(val) {
        const i = o2i(val);
        return (i >= 0 && i <= 16) ? i : RC_CODES.RC_INVALID;
    }

    function o2le(val) {
        const i = o2i(val);
        return (i >= 0 && i <= 14) ? i : LOC_ERR.LOC_ERR_UNKNOWN;
    }

    function o2did(val) {
        const i = o2i(val);
        return (i >= 0 && i <= 2) ? i : DataID.DID_INVALID;
    }

    function o2am(val) {
        const i = o2i(val);
        return (i >= 0 && i <= 2) ? i : AQPNGMode.AQPNG_INVALID;
    }

    function bcdToStr(v) {
        if (v < 0) return '';
        return `${v >> 8}.${(v & 0xFF).toString(16).padStart(2, '0').toUpperCase()}`;
    }

    function hexToBytes(hex) {
        if (hex.startsWith('0x')) hex = hex.substring(2);
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    function bytesToHex(bytes) {
        return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function icsByMsgID(msgID) {
        return MsgIDToIC[msgID] || ICs.IC_INVALID;
    }

    // ======================== NMEA ПОСТРОЕНИЕ ========================
    
    function nmeaChecksum(str) {
        let cs = 0;
        for (let i = 0; i < str.length; i++) {
            cs ^= str.charCodeAt(i);
        }
        return cs & 0xFF;
    }

    function buildSentence(sentenceId, params = []) {
        const fields = params.map(p => {
            if (p === null || p === undefined) return '';
            if (p instanceof Uint8Array || Array.isArray(p)) return bytesToHex(new Uint8Array(p));
            if (typeof p === 'number') {
                return Number.isInteger(p) ? p.toString() : p.toFixed(6).replace(/\.?0+$/, '');
            }
            return String(p);
        });

        let core = 'P' + ManufacturerCode + sentenceId;
        if (fields.length > 0) {
            core += ',' + fields.join(',');
        }

        const cs = nmeaChecksum(core);
        return '$' + core + '*' + cs.toString(16).toUpperCase().padStart(2, '0') + '\r\n';
    }

    function parseNMEA(rawLine) {
        if (!rawLine || rawLine.length === 0) return null;

        const line = rawLine.trim();
        if (!line.startsWith('$')) return null;

        const chkIdx = line.indexOf('*');
        let core, declaredCs;

        if (chkIdx >= 0) {
            core = line.substring(1, chkIdx);
            declaredCs = line.substring(chkIdx + 1);
        } else {
            core = line.substring(1);
            declaredCs = null;
        }

        if (declaredCs) {
            const realCs = nmeaChecksum(core);
            if (realCs !== parseInt(declaredCs, 16)) {
                return { valid: false, error: 'checksum', raw: rawLine };
            }
        }

        const fields = core.split(',');
        if (fields.length === 0) return null;

        const header = fields[0];
        if (!header.startsWith('P') || header.length < 5) return null;

        const manufacturer = header.substring(1, 4);
        if (manufacturer !== ManufacturerCode) return null;

        const sentenceId = header.substring(4);
        const params = fields.slice(1).map(f => {
            if (f === '') return null;
            if (f.startsWith('0x') || f.startsWith('0X')) return hexToBytes(f);
            if (/^-?\d+$/.test(f)) return parseInt(f, 10);
            if (/^-?\d+\.\d+$/.test(f)) return parseFloat(f);
            return f;
        });

        return {
            manufacturer,
            sentenceId,
            params,
            valid: true,
            raw: rawLine,
            ic: icsByMsgID(sentenceId)
        };
    }

    // ======================== ПАРСЕРЫ ОТВЕТОВ ========================
    
    function parseACK(params) {
        return {
            type: 'ack',
            sentenceID: icsByMsgID(o2s(params[0])),
            errorID: o2le(params[1])
        };
    }

	function parseRCResponse(params) {
		const azimuth = o2d(params[5]);
		const propTime = o2d(params[2]);
		return {
			type: 'rcResponse',
			txChID: o2i(params[0]),
			rcCmdID: o2rc(params[1]),
			propTimeS: propTime,     
			propTimeSec: propTime,   
			msrDb: o2d(params[3]),
			value: o2d(params[4]),
			azimuthDeg: azimuth,
			isValuePresent: !isNaN(o2d(params[4])),
			isAzimuthPresent: !isNaN(azimuth)
		};
	}

    function parseRCTimeout(params) {
        return {
            type: 'rcTimeout',
            txChID: o2i(params[0]),
            rcCmdID: o2rc(params[1])
        };
    }

    function parseRCAsync(params) {
        const azimuthDeg = o2d(params[2]);
        return {
            type: 'rcAsyncIn',
            rcCmdID: o2rc(params[0]),
            msrDb: o2d(params[1]),
            azimuthDeg: azimuthDeg,
            isAzimuthPresent: !isNaN(azimuthDeg)
        };
    }

    function parseAMBData(params) {
        return {
            type: 'ambData',
            pressureMbar: o2d(params[0]),
            temperatureC: o2d(params[1]),
            depthM: o2d(params[2]),
            voltageV: o2d(params[3])
        };
    }

    function parseINCData(params) {
        return {
            type: 'incData',
            pitchDeg: o2d(params[1]),
            rollDeg: o2d(params[2])
        };
    }

    function parseDINFO(params) {
        return {
            type: 'dinfo',
            serialNumber: o2s(params[0]),
            systemMoniker: o2s(params[1]),
            systemVersion: bcdToStr(o2i(params[2])),
            coreMoniker: o2s(params[3]),
            coreVersion: bcdToStr(o2i(params[4])),
            acousticBaudrate: o2d(params[5]),
            rxChID: o2i(params[6]),
            txChID: o2i(params[7]),
            totalCodeChannels: o2i(params[8]),
            salinityPSU: o2d(params[9]),
            isPTS: o2i(params[10]) !== 0,
            isCommandModeByDefault: o2i(params[11]) !== 0
        };
    }

    function parsePTSettings(params) {
        return {
            type: 'ptSettings',
            isPTMode: o2i(params[0]) !== 0,
            ptAddress: o2i(params[1])
        };
    }

    function parsePTFailed(params) {
        return {
            type: 'ptFailed',
            targetPtAddress: o2i(params[0]),
            triesTaken: o2i(params[1]),
            azimuthDeg: NaN,
            dataPacket: Array.isArray(params[2]) ? new Uint8Array(params[2]) : params[2]
        };
    }

    function parsePTDelivered(params) {
        return {
            type: 'ptDelivered',
            targetPtAddress: o2i(params[0]),
            triesTaken: o2i(params[1]),
            azimuthDeg: o2d(params[2]),
            dataPacket: Array.isArray(params[3]) ? new Uint8Array(params[3]) : params[3]
        };
    }

    function parsePTReceived(params) {
        return {
            type: 'ptReceived',
            targetPtAddress: o2i(params[0]),
            azimuthDeg: o2d(params[1]),
            dataPacket: Array.isArray(params[2]) ? new Uint8Array(params[2]) : params[2]
        };
    }

    function parsePTITGTimeout(params) {
        return {
            type: 'ptITGTimeout',
            targetPtAddress: o2i(params[0]),
            dataId: o2did(params[1])
        };
    }

	function parsePTITGResponse(params) {
		const propTime = o2d(params[3]);
		return {
			type: 'ptITGResponse',
			targetPtAddress: o2i(params[0]),
			dataId: o2did(params[1]),
			dataValue: o2d(params[2]),
			propTimeS: propTime,         
			propagationTimeS: propTime,     
			azimuthDeg: o2d(params[4])
		};
	}

    function parseAQPNGSettings(params) {
        return {
            type: 'aqpngSettings',
            mode: o2am(params[1]),
            periodMs: o2i(params[2]),
            dataId: o2i(params[3]),
            txID: o2i(params[4]),
            rxID: o2i(params[5]),
            isPT: o2i(params[6]) !== 0,
            ptTargetAddr: o2i(params[7])
        };
    }

    // ======================== ГЛАВНЫЙ ПАРСИНГ ========================
    
	function parse(rawLine) {
		const parsed = parseNMEA(rawLine);
		if (!parsed || !parsed.valid) return parsed;

		const { sentenceId, params } = parsed;

		let result;

		switch (sentenceId) {
			case '0': result = parseACK(params); break;
			case '3': result = parseRCResponse(params); break;
			case '4': result = parseRCTimeout(params); break;
			case '5': result = parseRCAsync(params); break;
			case '7': result = parseAMBData(params); break;
			case '9': result = parseINCData(params); break;
			case '!': result = parseDINFO(params); break;
			case 'E': result = parsePTSettings(params); break;
			case 'H': result = parsePTFailed(params); break;
			case 'I': result = parsePTDelivered(params); break;
			case 'J': result = parsePTReceived(params); break;
			case 'L': result = parsePTITGTimeout(params); break;
			case 'M': result = parsePTITGResponse(params); break;
			case 'O': result = parseAQPNGSettings(params); break;
			default: return null;
		}

		// Добавляем обязательные поля
		return {
			...result,
			valid: true,
			sentenceId: sentenceId,
			ic: parsed.ic,
			raw: rawLine
		};
	}

    // ======================== ПОСТРОИТЕЛИ КОМАНД ========================
    
    function buildDINFOGet() {
        return buildSentence('?', [0]);
    }

    function buildSettingsWrite(txChID, rxChID, salinityPSU, isCmdMode, isACKOnTXFinished, gravityAcc) {
        return buildSentence('1', [
            txChID,
            rxChID,
            salinityPSU,
            isCmdMode ? 1 : 0,
            isACKOnTXFinished ? 1 : 0,
            gravityAcc
        ]);
    }

	function buildAmbCfgWrite(isSaveToFlash, periodMs, isPressure, isTemperature, isDepth, isVCC) {
		return buildSentence('6', [
			isSaveToFlash ? 1 : 0,
			periodMs,
			isPressure ? 1 : 0,
			isTemperature ? 1 : 0,
			isDepth ? 1 : 0,
			isVCC ? 1 : 0
		]);
	}

    function buildIncCfgWrite(isSaveToFlash, periodMs) {
        return buildSentence('8', [
            isSaveToFlash ? 1 : 0,
            periodMs
        ]);
    }

    function buildRCRequest(txChID, rxChID, cmdID) {
        return buildSentence('2', [txChID, rxChID, cmdID]);
    }

    function buildPTSettingsRead() {
        return buildSentence('D', [0]);
    }

    function buildPTSettingsWrite(isSaveInFlash, isPTMode, ptAddress) {
        return buildSentence('F', [
            isSaveInFlash ? 1 : 0,
            isPTMode ? 1 : 0,
            ptAddress
        ]);
    }

    function buildPTAbortSend() {
        return buildSentence('G', [null, null, null]);
    }

    function buildPTSend(targetPtAddress, data, maxTries = null) {
        if (data.length > 64) {
            throw new Error('Packet size exceeds 64 bytes');
        }
        return buildSentence('G', [targetPtAddress, maxTries, data]);
    }

    function buildPTITG(targetPtAddress, dataID) {
        return buildSentence('K', [targetPtAddress, dataID]);
    }

    function buildAQPNGSettingsRead() {
        return buildSentence('N', [0]);
    }

    function buildAQPNGSettingsWrite(isSaveToFlash, modeID, periodMs, dataID, rcTxChID, rcRxChID, isPT, ptTargetAddr) {
        return buildSentence('O', [
            isSaveToFlash ? 1 : 0,
            modeID,
            periodMs,
            dataID,
            rcTxChID,
            rcRxChID,
            isPT ? 1 : 0,
            ptTargetAddr
        ]);
    }

    // ======================== ПУБЛИЧНЫЙ API ========================
    
    return {
        // Константы
        ManufacturerCode,
        ICs,
        RC_CODES,
        LOC_ERR,
        DataID,
        AQPNGMode,
        
        // Утилиты
        o2i,
        o2d,
        o2s,
        o2rc,
        o2le,
        o2did,
        o2am,
        bcdToStr,
        hexToBytes,
        bytesToHex,
        nmeaChecksum,
        
        // Парсинг
        parse,
        parseNMEA,
        
        // Построение команд
        buildDINFOGet,
        buildSettingsWrite,
        buildAmbCfgWrite,
        buildIncCfgWrite,
        buildRCRequest,
        buildPTSettingsRead,
        buildPTSettingsWrite,
        buildPTAbortSend,
        buildPTSend,
        buildPTITG,
        buildAQPNGSettingsRead,
        buildAQPNGSettingsWrite
    };

})();

// Экспорт для CommonJS/ESM
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWProtocol;
}