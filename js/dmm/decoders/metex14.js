/**
 * Metex14-family ASCII decoder.
 * Handles Metex14 (polled), PeakTech10, Voltcraft14Continuous, Voltcraft15Continuous.
 *
 * Based on QtDMM DecoderAscii — see https://github.com/tuxmaster/QtDMM
 */

import { PROTOCOL } from "../meter-db.js";

const SI_PREFIX = { k: 1e3, M: 1e6, G: 1e9, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };

/** Protocol config per sub-type */
const CONFIGS = {
    [PROTOCOL.METEX14]:    { len: 14, polling: true,  check: (fifo, i) => fifo[i] === 0x0D },
    [PROTOCOL.PEAKTECH10]: { len: 11, polling: true,  check: (fifo, i, len) => fifo[(i - 10 + len) % len] === 0x23 },
    [PROTOCOL.VOLTCRAFT14]:{ len: 14, polling: false, check: (fifo, i) => fifo[i] === 0x0D },
    [PROTOCOL.VOLTCRAFT15]:{ len: 15, polling: false, check: (fifo, i, len) => fifo[(i - 1 + len) % len] === 0x0D && fifo[i] === 0x0A },
};

export class Metex14Decoder {
    constructor(protocol) {
        this.protocol = protocol;
        const cfg = CONFIGS[protocol];
        if (!cfg) throw new Error(`Unknown ASCII protocol: ${protocol}`);
        this.packetLength = cfg.len;
        this.polling = cfg.polling;
        this._check = cfg.check;
    }

    /** Check if a complete packet ends at fifo[idx] */
    checkFormat(fifo, idx) {
        return this._check(fifo, idx, fifo.length);
    }

    /** Decode a packet buffer (Uint8Array of packetLength bytes) → reading object */
    decode(buf) {
        const str = String.fromCharCode(...buf);

        let special, valStr, unitStr;

        if (this.protocol === PROTOCOL.PEAKTECH10) {
            // '#' + 6-char value + 4-char unit
            valStr = str.substring(1, 7).trim();
            unitStr = str.substring(7, 11).trim();
            special = "";
        } else {
            // Metex14 / Voltcraft14 / Voltcraft15 share the same layout
            special = str.substring(0, 3).trim();
            valStr = str.substring(2, 9).trim();
            unitStr = str.substring(9, 13).trim();
        }

        // Parse numeric value
        const overload = /OL|OFL|FUSE/i.test(valStr);
        const numericVal = overload ? Infinity : parseFloat(valStr);

        // Extract SI prefix from unit
        let prefix = "";
        let baseUnit = unitStr;
        let scale = 1;
        if (unitStr.length > 0 && SI_PREFIX[unitStr[0]] !== undefined) {
            prefix = unitStr[0];
            baseUnit = unitStr.substring(1);
            scale = SI_PREFIX[prefix];
        }

        // Normalize unit names
        if (/^ohm$/i.test(baseUnit)) baseUnit = "\u2126";
        if (/^deg?C$/i.test(baseUnit) || baseUnit === "C") baseUnit = "\u00b0C";

        // Determine mode from special field
        let ac = /AC/i.test(special);
        let dc = /DC/i.test(special);
        let mode = "";
        if (/OH/i.test(special)) mode = "resistance";
        else if (/DI/i.test(special)) mode = "diode";
        else if (/HZ|FR/i.test(special)) mode = "frequency";
        else if (/CA/i.test(special)) mode = "capacitance";
        else if (/TE/i.test(special)) mode = "temperature";
        else if (ac) mode = "ac";
        else if (dc) mode = "dc";

        return {
            value: overload ? null : numericVal * scale,
            display: overload ? "OL" : valStr,
            unit: baseUnit,
            prefix,
            scale,
            ac,
            dc,
            mode,
            overload,
        };
    }
}
