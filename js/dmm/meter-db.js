/**
 * Database of supported serial multimeters.
 * Each entry maps to a protocol decoder and serial configuration.
 *
 * EXPERIMENTAL — requires WebSerial API (Chrome/Edge 89+)
 */

export const PROTOCOL = {
    METEX14:              "metex14",
    PEAKTECH10:           "peaktech10",
    VOLTCRAFT14:          "voltcraft14",
    VOLTCRAFT15:          "voltcraft15",
    VC820:                "vc820",
};

export const METERS = [
    // --- Metex14 (polled, "D\n") ---
    { vendor: "Metex",     model: "M-3660D",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-3830D",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-3840D",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-3850D",       protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-3850M",       protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-3870D",       protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "M-4650C",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "ME-11",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "ME-22",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "ME-32",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Metex",     model: "ME-42",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "PeakTech",  model: "4010",          protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "PeakTech",  model: "4015A",         protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "PeakTech",  model: "4390",          protocol: PROTOCOL.METEX14,    baud: 2400, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Radioshack",model: "22-805 DMM",    protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-3610D",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-3650D",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-3860",        protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-4660",        protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-4660A",       protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "M-4660M",       protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "MXD-4660A",     protocol: PROTOCOL.METEX14,    baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "ME-11",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "ME-22T",        protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "ME-32",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "ME-42",         protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "McVoice",   model: "M-345pro",      protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "McVoice",   model: "M-980T",        protocol: PROTOCOL.METEX14,    baud: 9600, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "MASTECH",   model: "MAS-343",       protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "MASTECH",   model: "MAS-345",       protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Sinometer", model: "MAS-343",       protocol: PROTOCOL.METEX14,    baud: 600,  bits: 7, stopBits: 2, parity: "none" },

    // --- PeakTech10 (polled, "D\n", 11-byte '#' start) ---
    { vendor: "PeakTech",  model: "451",           protocol: PROTOCOL.PEAKTECH10, baud: 600,  bits: 7, stopBits: 2, parity: "none" },

    // --- Voltcraft14Continuous (streaming, 14-byte CR-terminated) ---
    { vendor: "Voltcraft", model: "M-4650CR",      protocol: PROTOCOL.VOLTCRAFT14, baud: 1200, bits: 7, stopBits: 2, parity: "none" },
    { vendor: "Voltcraft", model: "VC 630",        protocol: PROTOCOL.VOLTCRAFT14, baud: 2400, bits: 7, stopBits: 1, parity: "none" },
    { vendor: "Voltcraft", model: "VC 650",        protocol: PROTOCOL.VOLTCRAFT14, baud: 2400, bits: 7, stopBits: 1, parity: "none" },
    { vendor: "Voltcraft", model: "VC 670",        protocol: PROTOCOL.VOLTCRAFT14, baud: 4800, bits: 7, stopBits: 1, parity: "none" },

    // --- Voltcraft15Continuous (streaming, 15-byte CRLF-terminated) ---
    { vendor: "Voltcraft", model: "VC 635",        protocol: PROTOCOL.VOLTCRAFT15, baud: 2400, bits: 7, stopBits: 1, parity: "none" },
    { vendor: "Voltcraft", model: "VC 655",        protocol: PROTOCOL.VOLTCRAFT15, baud: 2400, bits: 7, stopBits: 1, parity: "none" },

    // --- VC820 / Fortune FS9721 (streaming, 14-byte binary) ---
    { vendor: "Digitek",   model: "DT-9062",       protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Digitech",  model: "QM1462",        protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Digitech",  model: "QM1538",        protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "HoldPeak",  model: "HP-90EPC",      protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "PeakTech",  model: "3330",          protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Tenma",     model: "72-7745",       protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "TekPower",  model: "TP4000ZC",      protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Digitek",   model: "DT4000ZC",      protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Digitek",   model: "INO2513",       protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Uni-Trend", model: "UT60A",         protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Uni-Trend", model: "UT60E",         protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Voltcraft", model: "VC 820",        protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Voltcraft", model: "VC 840",        protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Iso-Tech",  model: "IDM 73",        protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Vichy",     model: "VC99",          protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Tenma",     model: "72-1016",       protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
    { vendor: "Tenma",     model: "72-7732",       protocol: PROTOCOL.VC820,      baud: 2400, bits: 8, stopBits: 1, parity: "none" },
];

/** Get display name for a meter entry */
export function meterName(m) {
    return `${m.vendor} ${m.model}`;
}

/** Group meters by protocol for UI */
export function metersByProtocol() {
    const groups = {};
    for (const m of METERS) {
        if (!groups[m.protocol]) groups[m.protocol] = [];
        groups[m.protocol].push(m);
    }
    return groups;
}
