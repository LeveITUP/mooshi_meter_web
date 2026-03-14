# Mooshimeter Desktop

A browser-based companion app for the [Mooshimeter](https://moosh.im/) wireless dual-channel multimeter, built with the Web Bluetooth API. This app replaces the original mobile app, letting you control and monitor your meter from any desktop running Chrome or Edge.

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

## License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.
