# Mooshimeter Desktop

A browser-based companion app for the [Mooshimeter](https://moosh.im/) wireless dual-channel multimeter, built with the Web Bluetooth API. This app replaces the original mobile app, letting you control and monitor your meter from any desktop running Chrome or Edge.

Live version available here : [mooshimeter.levelitup.tech](https://mooshimeter.levelitup.tech)

## Features

- **Dual-channel measurements** — voltage, current, resistance, temperature, and diode testing on two independent channels simultaneously
- **Real-time graphing** — live chart powered by [uPlot](https://github.com/leeoniya/uPlot) with combined, split, and single-channel display modes
- **Long-duration logging** — record 24hr+ sessions to IndexedDB with CSV export
- **Spreadsheet view** — virtual-scrolling data table with progressive IndexedDB loading for browsing large sessions
- **Math channels** — real power, apparent power, power factor, and thermocouple (K/J/T) temperature calculations
- **Auto-ranging** — automatic measurement range selection with manual override
- **Continuity beep** — audible tone for resistance below 40 ohms or diode forward voltage detection
- **SD card logging** — control on-board SD card recording interval
- **Keyboard shortcuts** — Space (stream), H (hold), Z (zero), 1/2/C (graph modes), ? (help)
- **Hold/freeze display** — freeze readings while streaming continues in background
- **Min/Max/Avg statistics** — per-channel stat tracking with auto-reset
- **Resizable panels** — drag to resize the control and graph panels
- **Toast notifications** — non-intrusive status messages
- **Collapsible sections** — accordion UI with persistent state
- **CSV export** — export live graph data or full IndexedDB sessions

## Requirements

- **Browser**: Google Chrome or Microsoft Edge (Web Bluetooth support required)
- **OS**: Windows, macOS, Linux, or ChromeOS
- **Hardware**: Mooshimeter (any hardware revision)

## Getting Started

1. Clone the repository:
   ```
   git clone https://github.com/LeveITUP/mooshi_meter_web.git
   cd mooshi_meter_web
   ```

2. Serve the files over HTTP (required for Web Bluetooth):
   ```
   python serve.py
   ```
   Or use any static file server of your choice.

3. Open `https://localhost:8443` in Chrome or Edge.

4. Turn on your Mooshimeter, click **Scan & Connect**, and select your device.

5. Press **Start** to begin streaming measurements.

## Linux Setup

Web Bluetooth is supported on Linux via Chrome/Chromium but requires a few extra steps:

1. **Install BlueZ 5.41+** (the Linux Bluetooth stack):
   ```bash
   # Check your current version
   bluetoothctl --version

   # Install or update (Debian/Ubuntu)
   sudo apt install bluez
   ```

2. **Start the Bluetooth service**:
   ```bash
   sudo systemctl enable bluetooth
   sudo systemctl start bluetooth
   ```

3. **Add your user to the bluetooth group**:
   ```bash
   sudo usermod -aG bluetooth $USER
   # Log out and back in for this to take effect
   ```

4. **Enable the Web Bluetooth flag in Chrome** (if not already enabled):
   - Navigate to `chrome://flags/#enable-web-bluetooth`
   - Set to **Enabled** and relaunch

   Or launch Chrome from the terminal with:
   ```bash
   google-chrome --enable-features=WebBluetooth
   ```

5. **Run the server** as normal:
   ```bash
   python3 serve.py
   ```

> **Note:** The `serve.py` server uses `localhost`, which counts as a secure context for Web Bluetooth — no HTTPS certificate is needed.

## Project Structure

```
├── index.html              Main application page
├── serve.py                Development HTTPS server
├── css/
│   └── style.css           Application styles
└── js/
    ├── app.js              Main application logic and UI binding
    ├── mooshimeter.js      BLE protocol and GATT communication
    ├── config-tree.js      Mooshimeter config tree parser (zlib-compressed)
    ├── byte-pack.js        Binary packing/unpacking utilities
    ├── meter-reading.js    Value formatting with SI prefixes
    ├── input-config.js     Channel input/mapping definitions
    ├── range-config.js     Auto-range logic and range options
    ├── thermocouple.js     Thermocouple voltage-to-temperature conversion
    ├── graph.js            Real-time charting with uPlot
    ├── data-table.js       Virtual-scrolling spreadsheet view
    ├── sample-store.js     IndexedDB session storage and export
    ├── toast.js            Toast notification system
    ├── tooltip.js          Custom tooltip system
    └── shortcuts.js        Keyboard shortcut handler
```

## Protocol

The app communicates with the Mooshimeter over BLE using the proprietary Mooshimeter protocol:

- **Service UUID**: `1bc5ffa0-0200-62ab-e411-f254e005dbd4`
- **Serial In/Out characteristics** for bidirectional command exchange
- **Config tree** with numbered shortcodes, transmitted as zlib-compressed data
- Commands sent as `SHORTCODE VALUE` pairs; responses parsed from the config tree structure

## Acknowledgements

This project builds on and was adapted from the following:

- **[Mooshimeter-PythonAPI](https://github.com/EEVblog/Mooshimeter-PythonAPI)** — EEVblog's Python API for the Mooshimeter, which provided the reference implementation for the BLE protocol, config tree structure, and command interface
- **[Mooshimeter-AndroidApp](https://github.com/mooshim/Mooshimeter-AndroidApp)** — The original open-source Android app by Mooshim Engineering, used as protocol documentation for BLE service UUIDs, config tree encoding, and channel mapping conventions
- **[uPlot](https://github.com/leeoniya/uPlot)** by Leon Sorokin — ultra-fast time-series charting library used for real-time graph rendering
- **[pako](https://github.com/nicolo-ribaudo/pako-es)** — JavaScript zlib implementation used to decompress the Mooshimeter's config tree data
- **[NIST ITS-90 Thermocouple Database](https://srdata.nist.gov/its90/main/)** — polynomial coefficients for K, J, and T type thermocouple voltage-to-temperature conversion
- **[Web Bluetooth API](https://webbluetoothcg.github.io/web-bluetooth/)** — W3C Community Group specification for browser-based Bluetooth Low Energy access

The Python companion code in the parent project uses [Bleak](https://github.com/hbldh/bleak) for cross-platform BLE and [Matplotlib](https://matplotlib.org/) for desktop graphing.

## License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.
