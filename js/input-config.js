/**
 * Input descriptors matching the iOS/Android app menus.
 * Each entry combines a tree MAPPING + ANALYSIS mode into a user-friendly option.
 *
 * The firmware's config tree typically has these MAPPING children:
 *   CH1: CURRENT, TEMP, SHARED
 *   CH2: VOLTAGE, TEMP, SHARED
 *
 * "Shared" inputs (Aux Voltage, Resistance, Diode) all use the SHARED mapping
 * and are differentiated by RANGE_I selection within SHARED mode.
 */

// Analysis mode indices (CHOOSER children order in config tree)
export const ANALYSIS = { MEAN: 0, RMS: 1, BUFFER: 2 };

// Channel 1 input descriptors
// mapping: the actual tree MAPPING child name to select
// sharedRangeHint: for SHARED mappings, which RANGE_I index to auto-select
export const CH1_INPUTS = [
    { label: "Current DC",      mapping: "CURRENT", analysis: ANALYSIS.MEAN, units: "A",      shared: false },
    { label: "Current AC",      mapping: "CURRENT", analysis: ANALYSIS.RMS,  units: "A",      shared: false },
    { label: "Temperature",     mapping: "TEMP",    analysis: ANALYSIS.MEAN, units: "K",      shared: false, isTemp: true },
    { label: "Aux Voltage DC",  mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "V",      shared: true,  sharedRangeHint: 0 },
    { label: "Aux Voltage AC",  mapping: "SHARED",  analysis: ANALYSIS.RMS,  units: "V",      shared: true,  sharedRangeHint: 0 },
    { label: "Resistance",      mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "\u2126", shared: true,  sharedRangeHint: "resistance" },
    { label: "Diode Drop",     mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "V",      shared: true,  isDiode: true, sharedRangeHint: "diode" },
];

// Channel 2 input descriptors
export const CH2_INPUTS = [
    { label: "Voltage DC",      mapping: "VOLTAGE", analysis: ANALYSIS.MEAN, units: "V",      shared: false },
    { label: "Voltage AC",      mapping: "VOLTAGE", analysis: ANALYSIS.RMS,  units: "V",      shared: false },
    { label: "Temperature",     mapping: "TEMP",    analysis: ANALYSIS.MEAN, units: "K",      shared: false, isTemp: true },
    { label: "Aux Voltage DC",  mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "V",      shared: true,  sharedRangeHint: 0 },
    { label: "Aux Voltage AC",  mapping: "SHARED",  analysis: ANALYSIS.RMS,  units: "V",      shared: true,  sharedRangeHint: 0 },
    { label: "Resistance",      mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "\u2126", shared: true,  sharedRangeHint: "resistance" },
    { label: "Diode Drop",     mapping: "SHARED",  analysis: ANALYSIS.MEAN, units: "V",      shared: true,  isDiode: true, sharedRangeHint: "diode" },
];

// Math channel options (computed from CH1 + CH2 values)
export const MATH_INPUTS = [
    { label: "Off",              id: "off" },
    { label: "Real Power",      id: "real_power",     units: "W" },
    { label: "Apparent Power",  id: "apparent_power", units: "W" },
    { label: "Power Factor",    id: "power_factor",   units: "" },
    { label: "Thermocouple K",  id: "tc_k",           units: "\u00b0C", tcType: "K" },
    { label: "Thermocouple J",  id: "tc_j",           units: "\u00b0C", tcType: "J" },
    { label: "Thermocouple T",  id: "tc_t",           units: "\u00b0C", tcType: "T" },
];

/**
 * Find the MAPPING chooser index for a given mapping name.
 * Checks tree children names (case-insensitive).
 * Returns -1 if not found.
 */
export function findMappingIndex(meter, channel, mappingName) {
    const names = meter.getChannelMappings(channel);
    const target = mappingName.toUpperCase();
    const idx = names.findIndex(n => n.toUpperCase() === target);
    return idx;
}

/**
 * Build the list of available inputs for a channel.
 * Filters descriptors to only those whose mapping name exists in the tree.
 * Also tries common firmware aliases if the exact name isn't found.
 */
export function getAvailableInputs(meter, channel) {
    const descriptors = channel === 1 ? CH1_INPUTS : CH2_INPUTS;
    const treeMappings = meter.getChannelMappings(channel).map(n => n.toUpperCase());

    console.log(`CH${channel} tree mappings:`, treeMappings);

    const available = descriptors.filter(d => {
        const found = treeMappings.includes(d.mapping.toUpperCase());
        if (!found) {
            console.log(`  Filtered out "${d.label}" - mapping "${d.mapping}" not in tree`);
        }
        return found;
    });

    // If nothing matched (shouldn't happen), fall back to showing everything
    if (available.length === 0) {
        console.warn(`No inputs matched tree for CH${channel}, showing all`);
        return descriptors;
    }

    return available;
}

/**
 * Try to auto-select a range for shared inputs (resistance, diode).
 * Searches range names for keywords.
 * Returns the range index, or -1 if no match found.
 */
export function findSharedRangeIndex(meter, channel, hint) {
    if (hint === undefined || hint === null) return -1;
    if (typeof hint === "number") return hint;

    const ranges = meter.getChannelRanges(channel);
    const target = String(hint).toUpperCase();

    for (let i = 0; i < ranges.length; i++) {
        const name = ranges[i].toUpperCase();
        if (name.includes(target) || target.includes(name)) {
            return i;
        }
    }
    // For resistance, look for ohm symbol or "K", "M" in range names
    if (target === "RESISTANCE") {
        for (let i = 0; i < ranges.length; i++) {
            const name = ranges[i].toUpperCase();
            if (name.includes("\u2126") || name.includes("OHM") || name.match(/\d+[KM]$/)) {
                return i;
            }
        }
    }
    // For diode, look for "DIODE" or small voltage range
    if (target === "DIODE") {
        for (let i = 0; i < ranges.length; i++) {
            const name = ranges[i].toUpperCase();
            if (name.includes("DIODE") || name.includes("1.7")) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Continuity thresholds (from iOS app).
 */
export const CONTINUITY_THRESHOLD_OHMS = 40;
export const DIODE_BEEP_THRESHOLD_V = 0.1;
