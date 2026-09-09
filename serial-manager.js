// serial-manager.js — Web Serial API wrapper with NMEA buffering

class SerialBridge {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;
        this.lineBuffer = '';
        this.onMessage = null;
        this.onError = null;
        this.onClose = null;
        this.onRawData = null;
        this._reading = false;
        this._closing = false;
    }

    async open(baudRate = 9600) {
        if (this.isOpen) {
            return false;
        }
        
        try {
            this.port = await navigator.serial.requestPort();
            
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none',
                bufferSize: 65536
            });
            
            // Ждем стабилизации порта
            await new Promise(r => setTimeout(r, 200));
            
            this.isOpen = true;
            this.lineBuffer = '';
            
            this.writer = this.port.writable.getWriter();
            this.reader = this.port.readable.getReader();
            
            this._readLoop();
            
            return true;
            
        } catch (err) {
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    async send(message) {
        if (!this.isOpen || !this.writer) {
            throw new Error('Port not open or writer unavailable');
        }
        
        const data = new TextEncoder().encode(message);
        await this.writer.write(data);
    }

    async sendRaw(data) {
        if (!this.writer) throw new Error('Port not open');
        await this.writer.write(data);
    }

    async _readLoop() {
        if (this._reading) {
            return;
        }
        this._reading = true;
        
        const decoder = new TextDecoder();
        
        if (!this.isOpen || !this.reader || !this.port) {
            this._reading = false;
            return;
        }
        
        while (this.reader && this.isOpen) {
            try {
                const { value, done } = await this.reader.read();

                if (done) {
                    break;
                }
                
                if (!value || value.length === 0) continue;
                
                const chunk = decoder.decode(value, { stream: true });
                
                this.lineBuffer += chunk;
                
                let idx;
                while ((idx = this.lineBuffer.indexOf('\n')) >= 0) {
                    let line = this.lineBuffer.substring(0, idx + 1);
                    this.lineBuffer = this.lineBuffer.substring(idx + 1);
                    
                    if (this.onMessage) {
                        try {
                            this.onMessage(line);
                        } catch (e) {
                            console.warn('[SerialBridge] onMessage error:', e.message);
                        }
                    }
                }
                
                if (this.lineBuffer.length > 65535) {
                    this.lineBuffer = '';
                }
                
            } catch (err) {
                if (err.name === 'NetworkError' || err.name === 'AbortError') {
                    break;
                }
                
                await new Promise(r => setTimeout(r, 100));
            }
        }
        
        this._reading = false;
        this.isOpen = false;
        
        if (this.onClose) {
            try {
                this.onClose();
            } catch (e) {}
        }
    }

    async close() {
        if (this._closing) {
            return;
        }
        this._closing = true;
        
        if (!this.isOpen || !this.port) {
            this.isOpen = false;
            this._closing = false;
            return;
        }
        
        try {
            if (this.reader) {
                try { await this.reader.cancel(); } catch (err) {}
                try { this.reader.releaseLock(); } catch (e) {}
                this.reader = null;
            }
            
            if (this.writer) {
                try { this.writer.releaseLock(); } catch (e) {}
                this.writer = null;
            }
            
            if (this.port) {
                try { await this.port.close(); } catch (err) {}
                this.port = null;
            }
            
        } catch (e) {
            console.warn('[SerialBridge] Close error:', e.message);
        } finally {
            this.isOpen = false;
            this.lineBuffer = '';
            this._closing = false;
        }
    }

    get connected() {
        return this.isOpen && this.port !== null;
    }
}