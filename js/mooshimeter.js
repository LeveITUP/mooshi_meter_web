/** Mooshimeter device protocol handler - BLE communication and config tree. */

import { BytePack, UnderflowError } from "./byte-pack.js";
import { NTYPE, ConfigTree, buildBootstrapTree } from "./config-tree.js";

// BLE UUIDs
export const METER_SERVICE  = "1bc5ffa0-0200-62ab-e411-f254e005dbd4";
export const METER_SERIN    = "1bc5ffa1-0200-62ab-e411-f254e005dbd4";
export const METER_SEROUT   = "1bc5ffa2-0200-62ab-e411-f254e005dbd4";
export const OAD_SERVICE    = "1bc5ffc0-0200-62ab-e411-f254e005dbd4";

export const SAMPLE_RATES  = [125, 250, 500, 1000, 2000, 4000, 8000];
export const BUFFER_DEPTHS = [32, 64, 128, 256];

const INPUT_UNITS = {
    CURRENT: "A", VOLTAGE: "V", TEMP: "K",
    AUX_V: "V", RESISTANCE: "\u2126", DIODE: "V", SHARED: "V",
};

export function getUnitsForMapping(name) {
    return INPUT_UNITS[(name || "").toUpperCase()] || "";
}

export class Mooshimeter extends EventTarget {
    constructor() {
        super();
        this.device = null;       // BluetoothDevice
        this.server = null;       // BluetoothRemoteGATTServer
        this.serinChar = null;    // write characteristic
        this.seroutChar = null;   // notify characteristic

        this.tree = buildBootstrapTree();
        this.codeList = this.tree.getShortCodeList();

        this._seqOut = 0;
        this._seqIn = -1;
        this._aggregate = [];
        this._connected = false;
        this._treeLoaded = false;
        this._lastHeartbeat = 0;

        // Latest values
        this.ch1Value = null;
        this.ch2Value = null;
        this.batV = null;
        this.pcbVersion = null;
        this.meterName = null;
        this.realPower = null;

        this._setupBootstrapHandlers();
    }

    // --- Event helpers ---

    _emit(name, detail = {}) {
        this.dispatchEvent(new CustomEvent(name, { detail }));
    }

    // --- Bootstrap ---

    _setupBootstrapHandlers() {
        const treeNode = this.tree.getNodeAtLongname("ADMIN:TREE");
        if (treeNode) {
            treeNode.notificationHandler = (payload) => this._onTreeReceived(payload);
        }
    }

    _onTreeReceived(payload) {
        const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
        console.log(`Received config tree: ${bytes.length} bytes compressed`);

        this.tree.unpack(bytes);
        this.codeList = this.tree.getShortCodeList();

        // Log tree
        for (const line of this.tree.enumerate()) {
            console.log(line);
        }

        // Compute CRC32 for acknowledgment
        const crcNode = this.tree.getNodeAtLongname("ADMIN:CRC32");
        if (crcNode) {
            crcNode.value = crc32(bytes);
        }

        this._setupValueHandlers();
        this._treeLoaded = true;
        this._emit("treeloaded");
    }

    _setupValueHandlers() {
        const handlers = {
            "CH1:VALUE": v => { this.ch1Value = v; this._emit("ch1", { value: v }); this._checkPair(); },
            "CH2:VALUE": v => { this.ch2Value = v; this._emit("ch2", { value: v }); this._checkPair(); },
            "BAT_V":     v => { this.batV = v; this._emit("battery", { value: v }); },
            "PCB_VERSION": v => { this.pcbVersion = v; this._emit("pcb", { value: v }); },
            "REAL_PWR":  v => { this.realPower = v; this._emit("realpower", { value: v }); },
            "NAME":      v => {
                if (v instanceof Uint8Array) {
                    this.meterName = new TextDecoder().decode(v).replace(/\0+$/, "");
                } else if (Array.isArray(v)) {
                    this.meterName = String.fromCharCode(...v).replace(/\0+$/, "");
                } else {
                    this.meterName = String(v);
                }
                this._emit("name", { value: this.meterName });
            },
        };

        for (const [path, handler] of Object.entries(handlers)) {
            const node = this.tree.getNodeAtLongname(path);
            if (node) node.notificationHandler = handler;
        }
    }

    _pairReady = false;
    _checkPair() {
        if (this.ch1Value !== null && this.ch2Value !== null) {
            this._emit("sample", { ch1: this.ch1Value, ch2: this.ch2Value });
            this.ch1Value = null;
            this.ch2Value = null;
        }
    }

    // --- BLE notification handling ---

    _handleNotification(event) {
        const data = new Uint8Array(event.target.value.buffer);
        const seqN = data[0] & 0xFF;

        if (this._seqIn !== -1 && seqN !== (this._seqIn + 1) % 256) {
            console.warn(`Out of order packet: expected ${(this._seqIn + 1) % 256}, got ${seqN}`);
        }
        this._seqIn = seqN;

        // Append payload (skip sequence byte)
        for (let i = 1; i < data.length; i++) {
            this._aggregate.push(data[i]);
        }
        this._interpretAggregate();
    }

    _interpretAggregate() {
        while (this._aggregate.length > 0) {
            try {
                const b = new BytePack(this._aggregate);
                const shortcode = b.getU8();
                const node = this.codeList.get(shortcode);

                if (!node) {
                    console.warn(`Unrecognized shortcode: ${shortcode}`);
                    this._aggregate = [];
                    return;
                }

                const value = this._readNodeValue(b, node);
                if (value !== null && node.notificationHandler) {
                    node.notificationHandler(value);
                }

                // Consume processed bytes
                this._aggregate = this._aggregate.slice(b.i);
            } catch (e) {
                if (e instanceof UnderflowError) return;
                throw e;
            }
        }
    }

    _readNodeValue(b, node) {
        switch (node.ntype) {
            case NTYPE.CHOOSER: return b.getU8();
            case NTYPE.VAL_U8:  return b.getU8();
            case NTYPE.VAL_U16: return b.getU16();
            case NTYPE.VAL_U32: return b.getU32();
            case NTYPE.VAL_S8:  return b.getS8();
            case NTYPE.VAL_S16: return b.getS16();
            case NTYPE.VAL_S32: return b.getS32();
            case NTYPE.VAL_STR: {
                const len = b.getU16();
                if (b.bytesRemaining() < len) throw new UnderflowError();
                return b.getBytes(len);
            }
            case NTYPE.VAL_BIN: {
                const len = b.getU16();
                if (b.bytesRemaining() < len) throw new UnderflowError();
                return b.getBytes(len);
            }
            case NTYPE.VAL_FLT: return b.getFloat();
            default: return null;
        }
    }

    // --- Sending commands ---

    async sendCommand(cmd) {
        if (!this.serinChar || !this._connected) {
            console.warn("Cannot send: not connected");
            return;
        }

        const parts = cmd.split(" ");
        const nodePath = parts[0];
        const payloadStr = parts.length > 1 ? parts.slice(1).join(" ") : null;

        const node = this.tree.getNodeAtLongname(nodePath);
        if (!node) { console.warn(`Node not found: ${nodePath}`); return; }
        if (node.code === -1) { console.warn(`No shortcode: ${nodePath}`); return; }

        const b = new BytePack();
        if (payloadStr === null) {
            b.putU8(node.code);
        } else {
            b.putU8(node.code | 0x80);
            this._encodePayload(b, node, payloadStr);
        }

        await this._sendToMeter(b.bytes);
    }

    _encodePayload(b, node, payloadStr) {
        switch (node.ntype) {
            case NTYPE.CHOOSER: b.putU8(parseInt(payloadStr)); break;
            case NTYPE.VAL_U8:  b.putU8(parseInt(payloadStr)); break;
            case NTYPE.VAL_U16: b.putU16(parseInt(payloadStr)); break;
            case NTYPE.VAL_U32: b.putU32(parseInt(payloadStr)); break;
            case NTYPE.VAL_S8:  b.putS8(parseInt(payloadStr)); break;
            case NTYPE.VAL_S16: b.putS16(parseInt(payloadStr)); break;
            case NTYPE.VAL_S32: b.putS32(parseInt(payloadStr)); break;
            case NTYPE.VAL_STR: {
                const enc = new TextEncoder().encode(payloadStr);
                b.putU16(enc.length);
                b.putBytes(enc);
                break;
            }
            case NTYPE.VAL_FLT: b.putFloat(parseFloat(payloadStr)); break;
        }
    }

    async _sendToMeter(payload) {
        if (payload.length > 19) {
            console.error("Payload too long (max 19 bytes)");
            return;
        }

        const data = new Uint8Array(1 + payload.length);
        data[0] = this._seqOut & 0xFF;
        data.set(payload, 1);
        this._seqOut = (this._seqOut + 1) % 256;

        try {
            await this.serinChar.writeValueWithoutResponse(data);
        } catch (e) {
            console.error("Write failed:", e);
        }
    }

    // --- Connection ---

    async requestDevice() {
        this.device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [METER_SERVICE] }],
            optionalServices: [OAD_SERVICE],
        });

        this.device.addEventListener("gattserverdisconnected", () => {
            this._connected = false;
            this._treeLoaded = false;
            this._emit("disconnected");
        });

        return this.device;
    }

    async connect(device = null) {
        if (device) this.device = device;
        if (!this.device) throw new Error("No device");

        this._emit("status", { message: "Connecting..." });
        this.server = await this.device.gatt.connect();

        this._emit("status", { message: "Discovering services..." });
        const service = await this.server.getPrimaryService(METER_SERVICE);

        this.serinChar = await service.getCharacteristic(METER_SERIN);
        this.seroutChar = await service.getCharacteristic(METER_SEROUT);

        // Subscribe to notifications
        this._emit("status", { message: "Subscribing to notifications..." });
        this.seroutChar.addEventListener("characteristicvaluechanged",
            (e) => this._handleNotification(e));
        await this.seroutChar.startNotifications();

        this._connected = true;
        this._seqOut = 0;
        this._seqIn = -1;
        this._aggregate = [];

        // Reset bootstrap tree for fresh connection
        this.tree = buildBootstrapTree();
        this.codeList = this.tree.getShortCodeList();
        this._treeLoaded = false;
        this._setupBootstrapHandlers();

        // Request config tree
        this._emit("status", { message: "Loading config tree..." });
        await this.sendCommand("ADMIN:TREE");

        // Wait for tree
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Tree load timeout")), 10000);
            this.addEventListener("treeloaded", () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
        });

        // Send CRC32 ack
        const crcNode = this.tree.getNodeAtLongname("ADMIN:CRC32");
        if (crcNode && crcNode.value !== null) {
            await this.sendCommand(`ADMIN:CRC32 ${crcNode.value}`);
        }

        this._lastHeartbeat = Date.now();
        this._emit("connected");
        this._emit("status", { message: "Connected" });
        return true;
    }

    async disconnect() {
        try {
            if (this._connected) {
                await this.sendCommand("SAMPLING:TRIGGER 0");
                await sleep(100);
            }
        } catch (e) { /* ignore */ }

        if (this.server && this.server.connected) {
            this.server.disconnect();
        }
        this._connected = false;
        this._treeLoaded = false;
    }

    // --- Configuration ---

    async configureChannel(ch, mappingIdx, rangeIdx = 0) {
        await this.sendCommand(`CH${ch}:MAPPING ${mappingIdx}`);
        await sleep(50);
        await this.sendCommand(`CH${ch}:RANGE_I ${rangeIdx}`);
    }

    async configureSampling(rateIdx = 0, depthIdx = 3) {
        await this.sendCommand(`SAMPLING:RATE ${rateIdx}`);
        await sleep(50);
        await this.sendCommand(`SAMPLING:DEPTH ${depthIdx}`);
    }

    async startStreaming() { await this.sendCommand("SAMPLING:TRIGGER 2"); }
    async stopStreaming()  { await this.sendCommand("SAMPLING:TRIGGER 0"); }
    async singleShot()     { await this.sendCommand("SAMPLING:TRIGGER 1"); }

    async heartbeat() {
        if (Date.now() - this._lastHeartbeat > 10000) {
            await this.sendCommand("PCB_VERSION");
            this._lastHeartbeat = Date.now();
        }
    }

    async syncTime() {
        await this.sendCommand(`TIME_UTC ${Math.floor(Date.now() / 1000)}`);
    }

    async setLogging(enable) {
        await this.sendCommand(`LOG:ON ${enable ? 1 : 0}`);
    }

    async setLogInterval(ms) {
        await this.sendCommand(`LOG:INTERVAL ${ms}`);
    }

    async reboot() {
        await this.sendCommand("REBOOT 1");
    }

    getChannelMappings(ch) {
        const node = this.tree.getNodeAtLongname(`CH${ch}:MAPPING`);
        return node ? node.getChildrenNames() : [];
    }

    getChannelRanges(ch) {
        const node = this.tree.getNodeAtLongname(`CH${ch}:RANGE_I`);
        return node ? node.getChildrenNames() : [];
    }

    getSampleRates() {
        const node = this.tree.getNodeAtLongname("SAMPLING:RATE");
        return node ? node.getChildrenNames() : SAMPLE_RATES.map(String);
    }

    getBufferDepths() {
        const node = this.tree.getNodeAtLongname("SAMPLING:DEPTH");
        return node ? node.getChildrenNames() : BUFFER_DEPTHS.map(String);
    }

    get isConnected() { return this._connected && this.server?.connected; }
    get isTreeLoaded() { return this._treeLoaded; }
    get deviceName() { return this.meterName || this.device?.name || "Mooshimeter"; }
}

// --- Utilities ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
