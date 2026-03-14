/**
 * Range configuration and auto-range logic.
 *
 * The firmware tree RANGE_I node is a CHOOSER whose children may or may not
 * have descriptive names. This module provides fallback display names and
 * auto-range thresholds based on known firmware configurations.
 */

// Known range tables per mapping type (from iOS/Android app source).
// Keys are mapping names (uppercase), values are arrays of { name, max } objects.
// max = the maximum absolute value the range can measure.
const KNOWN_RANGES = {
    CURRENT: [
        { name: "10 A",  max: 10 },
    ],
    VOLTAGE: [
        { name: "60 V",   max: 60 },
        { name: "600 V",  max: 600 },
    ],
    SHARED: [
        { name: "100 mV", max: 0.1 },
        { name: "300 mV", max: 0.3 },
        { name: "1.2 V",  max: 1.2 },
    ],
    TEMP: [
        { name: "Default", max: 500 },
    ],
};

// Auto-range: expand if reading > max, contract if reading < 70% of next-lower max.
const AUTO_RANGE_CONTRACT_RATIO = 0.7;

/**
 * Get display-friendly range names for a channel.
 * Uses tree children names if they look meaningful, otherwise falls back to known tables.
 * Always prepends "Auto" as the first option.
 *
 * @returns {{ names: string[], hasAuto: boolean, autoOffset: number }}
 *   names: array of display names for the select (first is "Auto")
 *   autoOffset: 1 (the RANGE_I index is select index minus this)
 */
export function getRangeOptions(meter, channel, mappingName) {
    const treeNames = meter.getChannelRanges(channel);
    let displayNames;

    console.log(`CH${channel} RANGE_I tree children for mapping "${mappingName}":`, treeNames);

    if (treeNames.length > 0 && treeNames.some(n => n.length > 0 && !/^\d+$/.test(n))) {
        // Tree has meaningful names (not just "0","1","2")
        displayNames = [...treeNames];
    } else {
        // Use known fallback names
        const known = KNOWN_RANGES[mappingName.toUpperCase()];
        if (known && known.length === treeNames.length) {
            displayNames = known.map(r => r.name);
        } else if (known) {
            displayNames = known.map(r => r.name);
        } else {
            // Last resort: just number them
            displayNames = treeNames.map((_, i) => `Range ${i}`);
        }
    }

    // Prepend Auto
    return {
        names: ["Auto", ...displayNames],
        autoOffset: 1,
    };
}

/**
 * Get the max value for a given range index and mapping.
 * Used by auto-range to decide when to switch.
 */
export function getRangeMax(mappingName, rangeIdx) {
    const known = KNOWN_RANGES[mappingName.toUpperCase()];
    if (known && rangeIdx >= 0 && rangeIdx < known.length) {
        return known[rangeIdx].max;
    }
    return Infinity;
}

/**
 * Auto-range logic: given the current reading and range, decide if we should change range.
 *
 * @param {number} absValue - absolute value of current reading
 * @param {number} currentRangeIdx - current RANGE_I index (0-based, not counting Auto)
 * @param {string} mappingName - current mapping name
 * @returns {number|null} new range index, or null if no change needed
 */
export function autoRangeCheck(absValue, currentRangeIdx, mappingName) {
    const known = KNOWN_RANGES[mappingName.toUpperCase()];
    if (!known || known.length <= 1) return null;

    const currentMax = known[currentRangeIdx]?.max ?? Infinity;

    // Expand: value exceeds current range
    if (absValue > currentMax && currentRangeIdx < known.length - 1) {
        return currentRangeIdx + 1;
    }

    // Contract: value is below 70% of next-lower range's max
    if (currentRangeIdx > 0) {
        const lowerMax = known[currentRangeIdx - 1].max;
        if (absValue < lowerMax * AUTO_RANGE_CONTRACT_RATIO) {
            return currentRangeIdx - 1;
        }
    }

    return null;
}
