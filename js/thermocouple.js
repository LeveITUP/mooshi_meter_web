/** ITS-90 thermocouple polynomial conversion for multiple types. */

// NIST ITS-90 coefficients: voltage in millivolts -> temperature in Celsius
const THERMOCOUPLE_TYPES = {
    K: {
        range: [0, 500],
        coefficients: [
            0.0, 2.508355e+01, 7.860106e-02, -2.503131e-01,
            8.315270e-02, -1.228034e-02, 9.804036e-04,
            -4.413030e-05, 1.057734e-06, -1.052755e-08,
        ],
    },
    J: {
        range: [0, 760],
        coefficients: [
            0.0, 1.978425e+01, -2.001204e-01, 1.036969e-02,
            -2.549687e-04, 3.585153e-06, -5.344285e-08, 5.099890e-10,
        ],
    },
    T: {
        range: [0, 400],
        coefficients: [
            0.0, 2.592800e+01, -7.602961e-01, 4.637791e-02,
            -2.165394e-03, 6.048144e-05, -7.293422e-07,
        ],
    },
};

export function thermocoupleVoltageToTemp(voltageV, coldJunctionK, tcType = "K") {
    const tc = THERMOCOUPLE_TYPES[tcType];
    if (!tc) return coldJunctionK;

    const mv = voltageV * 1e3;
    const c = tc.coefficients;

    // Horner's method
    let tempC = c[c.length - 1];
    for (let i = c.length - 2; i >= 0; i--) {
        tempC = tempC * mv + c[i];
    }

    // Add cold junction contribution
    tempC += (coldJunctionK - 273.15);
    return tempC + 273.15;
}

export function kelvinToCelsius(k) { return k - 273.15; }
export function kelvinToFahrenheit(k) { return (k - 273.15) * 9 / 5 + 32; }
