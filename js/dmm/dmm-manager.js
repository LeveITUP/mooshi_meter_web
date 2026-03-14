/**
 * DMM Manager — coordinates WebSerial port, packet reader, and protocol decoder.
 * Emits 'reading' events with decoded measurement data.
 *
 * EXPERIMENTAL — requires WebSerial API (Chrome/Edge 89+)
 */

import { PROTOCOL, meterName } from "./meter-db.js";
import { Metex14Decoder } from "./decoders/metex14.js";
import { VC820Decoder } from "./decoders/vc820.js";

const FIFO_SIZE = 100;

function createDecoder(protocol) {
    switch (protocol) {
        case PROTOCOL.METEX14:
        case PROTOCOL.PEAKTECH10:
        case PROTOCOL.VOLTCRAFT14:
        case PROTOCOL.VOLTCRAFT15:
            return new Metex14Decoder(protocol);
        case PROTOCOL.VC820:
            return new VC820Decoder();
        default:
            throw new Error(`No decoder for protocol: ${protocol}`);
    }
}

export class DmmManager extends EventTarget {
    constructor() {
        super();
        this.port = null;
        this.meter = null;
        this.decoder = null;
        this._reader = null;
        this._writer = null;
        this._running = false;
        this._pollTimer = null;
        this._fifo = new Uint8Array(FIFO_SIZE);
        this._fifoIdx = 0;
    }

    get isConnected() { return this._running; }

    /** Check if WebSerial API is available */
    static isSupported() {
        return !!navigator.serial;
    }

    /**
     * Open a serial port for the given meter config.
     * Shows the browser's serial port picker.
     */
    async connect(meter) {
        if (this._running) await this.disconnect();

        this.meter = meter;
        this.decoder = createDecoder(meter.protocol);

        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({
                baudRate: meter.baud,
                dataBits: meter.bits,
                stopBits: meter.stopBits,
                parity: meter.parity,
                flowControl: "none",
            });

            this._running = true;
            this._fifoIdx = 0;

            this._emit("connected", { name: meterName(meter) });

            // Start reading
            this._readLoop();

            // Start polling if required
            if (this.decoder.polling) {
                this._startPolling();
            }

        } catch (e) {
            this._running = false;
            if (e.name !== "NotFoundError") {
                this._emit("error", { message: e.message });
            }
            throw e;
        }
    }

    async disconnect() {
        this._running = false;
        this._stopPolling();

        try {
            if (this._reader) {
                await this._reader.cancel();
                this._reader.releaseLock();
                this._reader = null;
            }
        } catch (e) { /* ignore */ }

        try {
            if (this.port) {
                await this.port.close();
            }
        } catch (e) { /* ignore */ }

        this.port = null;
        this._emit("disconnected");
    }

    /** Main read loop — reads bytes, pushes to FIFO, checks for packets */
    async _readLoop() {
        try {
            const readable = this.port.readable;
            while (this._running && readable) {
                this._reader = readable.getReader();
                try {
                    while (this._running) {
                        const { value, done } = await this._reader.read();
                        if (done) break;
                        if (value) this._processBytes(value);
                    }
                } finally {
                    this._reader.releaseLock();
                    this._reader = null;
                }
            }
        } catch (e) {
            if (this._running) {
                this._emit("error", { message: e.message });
                this._running = false;
            }
        }

        if (this.port) {
            this._emit("disconnected");
        }
    }

    /** Push bytes into circular FIFO and check for complete packets */
    _processBytes(data) {
        for (let i = 0; i < data.length; i++) {
            this._fifo[this._fifoIdx] = data[i];

            if (this.decoder.checkFormat(this._fifo, this._fifoIdx)) {
                // Extract packet from FIFO
                const pktLen = this.decoder.packetLength;
                const pkt = new Uint8Array(pktLen);
                let start = (this._fifoIdx - pktLen + 1 + FIFO_SIZE) % FIFO_SIZE;
                for (let j = 0; j < pktLen; j++) {
                    pkt[j] = this._fifo[start];
                    start = (start + 1) % FIFO_SIZE;
                }

                // Decode and emit
                const reading = this.decoder.decode(pkt);
                if (reading) {
                    this._emit("reading", reading);
                }

                this._fifoIdx = 0;
            } else {
                this._fifoIdx = (this._fifoIdx + 1) % FIFO_SIZE;
            }
        }
    }

    /** Send polling command "D\n" for Metex-protocol meters */
    _startPolling() {
        this._stopPolling();
        this._pollTimer = setInterval(async () => {
            if (!this._running || !this.port?.writable) return;
            try {
                const writer = this.port.writable.getWriter();
                await writer.write(new Uint8Array([0x44, 0x0A])); // "D\n"
                writer.releaseLock();
            } catch (e) { /* port may have closed */ }
        }, 1000);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    _emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}
