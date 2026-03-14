/**
 * VC820 / Fortune Semiconductor FS9721 decoder.
 * 14-byte binary protocol with 7-segment encoded display data.
 *
 * Based on QtDMM DecoderVC820 — see https://github.com/tuxmaster/QtDMM
 */

// 7-segment lookup: combined segment bits → digit character
const SEG_TABLE = {
    0x7D: "0", 0x05: "1", 0x5B: "2", 0x1F: "3", 0x27: "4",
    0x3E: "5", 0x7E: "6", 0x15: "7", 0x7F: "8", 0x3F: "9",
};

export class VC820Decoder {
    constructor() {
        this.packetLength = 14;
        this.polling = false; // continuous streaming
    }

    /** Packet ends when byte has high nibble 0xE0 (byte 13 of 14) */
    checkFormat(fifo, idx) {
        return (fifo[idx] & 0xF0) === 0xE0;
    }

    /** Decode 14-byte binary packet → reading object */
    decode(buf) {
        // Validate sequential high nibbles (0x10..0xE0)
        for (let i = 0; i < 14; i++) {
            if ((buf[i] & 0xF0) !== ((i + 1) << 4)) return null;
        }

        // --- Flags ---
        const ac   = !!(buf[0] & 0x08);
        const dc   = !!(buf[0] & 0x04);
        const auto = !!(buf[0] & 0x02);
        const neg  = !!(buf[1] & 0x08);
        const hold = !!(buf[11] & 0x01);
        const rel  = !!(buf[11] & 0x02);
        const diode = !!(buf[9] & 0x01);
        const beep  = !!(buf[10] & 0x01);
        const lowBat = !!(buf[12] & 0x01);

        // --- Check for overload (0L display) ---
        if ((buf[3] & 0x07) === 0x07 &&
            (buf[4] & 0x0F) === 0x0D &&
            (buf[5] & 0x07) === 0x06 &&
            (buf[6] & 0x0F) === 0x08) {
            return this._makeResult(null, "OL", true, buf, { ac, dc, auto, hold, rel, diode, beep, lowBat });
        }

        // --- Decode 4 digits from 7-segment data ---
        let digits = "";
        let dpPos = -1;

        for (let d = 0; d < 4; d++) {
            const hiByteIdx = 1 + 2 * d;
            const loByteIdx = 2 + 2 * d;

            const segBits = ((buf[hiByteIdx] & 0x07) << 4) | (buf[loByteIdx] & 0x0F);
            const ch = SEG_TABLE[segBits];

            if (ch === undefined) {
                digits += "?";
            } else {
                digits += ch;
            }

            // Decimal point is bit 3 of the even-indexed byte (bytes 3, 5, 7)
            if (d < 3 && (buf[3 + 2 * d] & 0x08)) {
                dpPos = d;
            }
        }

        // Build value string with decimal point
        let valStr = neg ? "-" : "";
        if (dpPos >= 0) {
            valStr += digits.substring(0, dpPos + 1) + "." + digits.substring(dpPos + 1);
        } else {
            valStr += digits;
        }

        const numericVal = parseFloat(valStr);

        // --- SI prefix ---
        let prefix = "";
        let scale = 1;
        if (buf[9]  & 0x04) { prefix = "n"; scale = 1e-9; }
        if (buf[9]  & 0x08) { prefix = "\u00b5"; scale = 1e-6; }
        if (buf[10] & 0x08) { prefix = "m"; scale = 1e-3; }
        if (buf[9]  & 0x02) { prefix = "k"; scale = 1e3; }
        if (buf[10] & 0x02) { prefix = "M"; scale = 1e6; }

        // --- Unit ---
        let unit = "";
        let mode = "";
        if (buf[11] & 0x08) { unit = "F"; mode = "capacitance"; }
        else if (buf[11] & 0x04) { unit = "\u2126"; mode = "resistance"; }
        else if (buf[12] & 0x08) { unit = "A"; mode = ac ? "ac" : "dc"; }
        else if (buf[12] & 0x02) { unit = "Hz"; mode = "frequency"; }
        else if (buf[12] & 0x04) { unit = "V"; mode = ac ? "ac" : "dc"; }
        else if (buf[10] & 0x04) { unit = "%"; mode = "duty"; }
        else if (buf[13] & 0x01) { unit = "\u00b0C"; mode = "temperature"; }

        if (diode) mode = "diode";

        return this._makeResult(
            isNaN(numericVal) ? null : numericVal * scale,
            valStr,
            false,
            buf,
            { ac, dc, auto, hold, rel, diode, beep, lowBat, prefix, scale, unit, mode }
        );
    }

    _makeResult(value, display, overload, buf, flags) {
        return {
            value,
            display: overload ? "OL" : display,
            unit: flags.unit || "",
            prefix: flags.prefix || "",
            scale: flags.scale || 1,
            ac: flags.ac,
            dc: flags.dc,
            auto: flags.auto,
            hold: flags.hold,
            relative: flags.rel,
            diode: flags.diode,
            continuity: flags.beep,
            lowBattery: flags.lowBat,
            mode: flags.mode || "",
            overload,
        };
    }
}
