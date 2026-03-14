/** Value formatting with SI prefixes for meter readings. */

const SI_PREFIXES = [
    [1e-9, "n"],
    [1e-6, "\u00b5"],
    [1e-3, "m"],
    [1e0, ""],
    [1e3, "k"],
    [1e6, "M"],
    [1e9, "G"],
];

export function formatValue(value, units = "", nDigits = 6) {
    if (value === 0 || !isFinite(value)) {
        return `0.000 ${units}`;
    }

    const absVal = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    let prefixScale = 1;
    let prefixStr = "";
    for (const [scale, name] of SI_PREFIXES) {
        if (absVal >= scale * 0.999) {
            prefixScale = scale;
            prefixStr = name;
        }
    }

    const scaled = absVal / prefixScale;
    let decimals;
    if (scaled >= 100) decimals = Math.max(0, nDigits - 3);
    else if (scaled >= 10) decimals = Math.max(0, nDigits - 2);
    else decimals = Math.max(0, nDigits - 1);

    return `${sign}${scaled.toFixed(decimals)} ${prefixStr}${units}`;
}
