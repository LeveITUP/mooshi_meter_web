/** Main application - binds Mooshimeter protocol to UI. */

import { Mooshimeter } from "./mooshimeter.js";
import { formatValue } from "./meter-reading.js";
import { kelvinToCelsius, thermocoupleVoltageToTemp } from "./thermocouple.js";
import { RealtimeGraph, GRAPH_MODE } from "./graph.js";
import {
    CH1_INPUTS, CH2_INPUTS, MATH_INPUTS,
    findMappingIndex, getAvailableInputs, findSharedRangeIndex,
    CONTINUITY_THRESHOLD_OHMS, DIODE_BEEP_THRESHOLD_V,
} from "./input-config.js";
import { getRangeOptions, autoRangeCheck } from "./range-config.js";
import { SampleStore, formatBytes, formatDuration } from "./sample-store.js";
import { DataTable } from "./data-table.js";
import { showToast } from "./toast.js";
import "./tooltip.js";
import { initShortcuts } from "./shortcuts.js";
import { DmmManager } from "./dmm/dmm-manager.js";
import { METERS, meterName, metersByProtocol } from "./dmm/meter-db.js";

class App {
    constructor() {
        this.meter = null;
        this.graph = null;
        this.streaming = false;
        this.heartbeatInterval = null;
        this.graphRefreshInterval = null;

        // Logging state (IndexedDB-backed)
        this.sampleStore = new SampleStore();
        this.logging = false;
        this.sampleCount = 0;
        this._logUpdateTimer = null;

        // Channel state
        this.lastCh1 = null;
        this.lastCh2 = null;
        this.ch1Offset = 0;
        this.ch2Offset = 0;
        this.ch1Input = null;
        this.ch2Input = null;
        this.mathInput = null;
        this.ch1Inputs = [];
        this.ch2Inputs = [];

        // Range state
        this.ch1RangeIdx = 0;
        this.ch2RangeIdx = 0;
        this.ch1AutoRange = true;
        this.ch2AutoRange = true;
        this._ch1RangeAutoOffset = 1;
        this._ch2RangeAutoOffset = 1;

        // Continuity beep
        this._audioCtx = null;
        this._beepActive = false;
        this.continuityEnabled = true;

        // Table
        this.dataTable = null;
        this._tableSource = "live";

        // Serial DMM
        this.dmm = null;
        this._dmmMeterList = [];

        // Hold/freeze display
        this.displayHeld = false;

        // Device mode: "none", "mooshi", "dmm"
        this._deviceMode = "none";

        // Min/Max/Avg stats
        this._ch1Stats = this._emptyStats();
        this._ch2Stats = this._emptyStats();
        this._mathStats = this._emptyStats();

        this._bindUI();
        this._initMenus();
        this._initPaneResize();
        this._initTheme();
        this._initGraph();
        this._initDataTable();
        this._initSampleStore();
        this._checkBluetooth();
        this._initDmm();
        this._showWelcomeIfFirstRun();
        initShortcuts(this);
    }

    // --- Device mode switching ---

    _setDeviceMode(mode) {
        this._deviceMode = mode;
        document.getElementById("measure-none").style.display = mode === "none" ? "" : "none";
        document.getElementById("measure-mooshi").style.display = mode === "mooshi" ? "" : "none";
        document.getElementById("measure-dmm").style.display = mode === "dmm" ? "" : "none";

        // Auto-switch graph mode for DMM (single channel)
        if (mode === "dmm") {
            const graphMode = document.getElementById("graph-mode");
            graphMode.value = "ch1";
            if (this.graph) this.graph.setMode("ch1");
        }
    }

    // --- Dropdown menu system ---

    _initMenus() {
        const menus = document.getElementById("header-menus");
        if (!menus) return;

        // Toggle menu on button click
        menus.querySelectorAll(".menu-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const menuId = btn.dataset.menu;
                const panel = document.getElementById(`menu-${menuId}`);
                const isOpen = panel.classList.contains("open");

                // Close all menus first
                this._closeAllMenus();

                if (!isOpen) {
                    panel.classList.add("open");
                    btn.classList.add("active");
                }
            });
        });

        // Close menus when clicking outside
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".menu-group")) {
                this._closeAllMenus();
            }
        });

        // Close menus on Escape
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this._closeAllMenus();
        });

        // Prevent menu panels from closing when clicking inside them
        menus.querySelectorAll(".menu-panel").forEach(panel => {
            panel.addEventListener("click", (e) => e.stopPropagation());
        });
    }

    _closeAllMenus() {
        document.querySelectorAll(".menu-panel.open").forEach(p => p.classList.remove("open"));
        document.querySelectorAll(".menu-btn.active").forEach(b => b.classList.remove("active"));
    }

    // --- Theme toggle ---

    _initTheme() {
        const saved = localStorage.getItem("mooshi:theme");
        if (saved === "dark") this._applyTheme("dark");

        document.getElementById("btn-theme").addEventListener("click", () => {
            const next = document.body.classList.contains("theme-light") ? "dark" : "light";
            this._applyTheme(next);
            localStorage.setItem("mooshi:theme", next);
        });
    }

    _applyTheme(theme) {
        const btn = document.getElementById("btn-theme");
        const icon = btn.querySelector("i");
        if (theme === "light") {
            document.body.classList.add("theme-light");
            if (icon) icon.className = "fa-solid fa-sun";
        } else {
            document.body.classList.remove("theme-light");
            if (icon) icon.className = "fa-solid fa-moon";
        }
        if (this.dataTable) this.dataTable.updateTheme();
    }

    // --- First-run welcome dialog ---

    _showWelcomeIfFirstRun() {
        this._initWelcomeDialog();

        if (sessionStorage.getItem("mooshi:welcomed") !== "1") {
            this._showWelcome();
        }
    }

    _initWelcomeDialog() {
        const overlay = document.getElementById("welcome-overlay");
        if (!overlay) return;

        const closeBtn = document.getElementById("btn-welcome-close");

        const close = () => {
            sessionStorage.setItem("mooshi:welcomed", "1");
            overlay.style.display = "none";
        };

        closeBtn.addEventListener("click", close);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });

        document.getElementById("btn-about").addEventListener("click", () => this._showWelcome());
    }

    _showWelcome() {
        const overlay = document.getElementById("welcome-overlay");
        if (overlay) overlay.style.display = "";
    }

    // --- Bluetooth availability ---

    _checkBluetooth() {
        if (!navigator.bluetooth) {
            this._setStatus("Web Bluetooth not supported. Use Chrome or Edge on a desktop OS.", "error");
            showToast("Web Bluetooth not supported", { type: "error", duration: 5000 });
            document.getElementById("btn-scan").disabled = true;
            return;
        }
        navigator.bluetooth.getAvailability().then(avail => {
            if (!avail) {
                this._setStatus("Bluetooth is not available on this device.", "error");
            }
        });
    }

    // --- UI Binding ---

    _bindUI() {
        // Connection
        document.getElementById("btn-scan").addEventListener("click", () => this._onScan());
        document.getElementById("btn-disconnect").addEventListener("click", () => this._onDisconnect());

        // Channel input selectors
        document.getElementById("ch1-input").addEventListener("change", () => this._onInputChanged(1));
        document.getElementById("ch1-range").addEventListener("change", () => this._onRangeChanged(1));
        document.getElementById("ch1-zero").addEventListener("click", () => { this.ch1Offset = this.lastCh1 || 0; });

        document.getElementById("ch2-input").addEventListener("change", () => this._onInputChanged(2));
        document.getElementById("ch2-range").addEventListener("change", () => this._onRangeChanged(2));
        document.getElementById("ch2-zero").addEventListener("click", () => { this.ch2Offset = this.lastCh2 || 0; });

        // Math channel
        document.getElementById("math-input").addEventListener("change", () => this._onMathChanged());

        // Continuity toggle
        document.getElementById("btn-continuity").addEventListener("click", () => {
            this.continuityEnabled = !this.continuityEnabled;
            const btn = document.getElementById("btn-continuity");
            btn.innerHTML = this.continuityEnabled
                ? '<i class="fa-solid fa-volume-high"></i> Beep: ON'
                : '<i class="fa-solid fa-volume-xmark"></i> Beep: OFF';
            btn.classList.toggle("active", this.continuityEnabled);
        });

        // Sampling
        document.getElementById("samp-rate").addEventListener("change", (e) =>
            this._sendCmd(`SAMPLING:RATE ${e.target.selectedIndex}`));
        document.getElementById("samp-depth").addEventListener("change", (e) =>
            this._sendCmd(`SAMPLING:DEPTH ${e.target.selectedIndex}`));

        // Display font
        document.getElementById("measure-font").addEventListener("change", (e) => this._onFontChanged(e.target.value));
        this._loadFontPref();

        document.getElementById("btn-stream").addEventListener("click", () => this._toggleStream());
        document.getElementById("btn-single").addEventListener("click", () => this._sendCmd("SAMPLING:TRIGGER 1"));

        // Hold/freeze
        document.getElementById("btn-hold").addEventListener("click", () => this._toggleHold());

        // Logging (IndexedDB)
        document.getElementById("btn-log").addEventListener("click", () => this._toggleLogging());
        document.getElementById("btn-sessions").addEventListener("click", () => this._showSessionsModal());

        // SD logging
        document.getElementById("btn-sd-log").addEventListener("click", () => this._toggleSdLog());
        document.getElementById("sd-interval").addEventListener("change", (e) => {
            const ms = [0, 1000, 10000, 60000, 600000][e.target.selectedIndex] || 1000;
            this._sendCmd(`LOG:INTERVAL ${ms}`);
        });

        // Table source
        document.getElementById("table-source").addEventListener("change", (e) => this._onTableSourceChanged(e.target.value));

        // Swap panes
        document.getElementById("btn-swap-panes").addEventListener("click", () => this._swapPanes());

        // Graph controls
        document.getElementById("graph-points").addEventListener("change", (e) => {
            if (this.graph) this.graph.setMaxPoints(parseInt(e.target.value));
        });
        document.getElementById("graph-mode").addEventListener("change", (e) => {
            if (this.graph) this.graph.setMode(e.target.value);
        });
        document.getElementById("btn-graph-clear").addEventListener("click", () => {
            if (this.graph) this.graph.clear();
        });
        document.getElementById("btn-graph-export").addEventListener("click", () => this._exportGraphCSV());

        // Table export
        document.getElementById("btn-table-export").addEventListener("click", () => {
            if (this.dataTable) {
                this.dataTable.exportCsv();
                showToast("Table exported as CSV", { type: "success", duration: 2000 });
            }
        });

        // Utilities
        document.getElementById("btn-sync-time").addEventListener("click", () => {
            this._sendCmd(`TIME_UTC ${Math.floor(Date.now() / 1000)}`);
            showToast("Time synced to UTC", { type: "success", duration: 2000 });
        });
        document.getElementById("btn-reboot").addEventListener("click", () => {
            if (confirm("Reboot the Mooshimeter?")) this._sendCmd("REBOOT 1");
        });
    }

    // --- Hold/freeze display ---

    _toggleHold() {
        this.displayHeld = !this.displayHeld;
        const btn = document.getElementById("btn-hold");
        btn.innerHTML = this.displayHeld
            ? '<i class="fa-solid fa-play"></i> Resume'
            : '<i class="fa-solid fa-pause"></i> Hold';
        btn.classList.toggle("active", this.displayHeld);
        showToast(this.displayHeld ? "Display held" : "Display resumed", { duration: 1500 });
    }

    // --- Min/Max/Avg stats ---

    _emptyStats() {
        return { min: Infinity, max: -Infinity, sum: 0, count: 0 };
    }

    _updateStats(stats, value, prefix) {
        if (!isFinite(value)) return;
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);
        stats.sum += value;
        stats.count++;

        if (stats.count % 5 !== 0) return;
        const avg = stats.sum / stats.count;

        const desc = prefix === "ch1" ? this.ch1Input : prefix === "ch2" ? this.ch2Input : null;
        const units = desc?.units || "";
        const isTemp = desc?.isTemp;

        const fmt = (v) => {
            if (isTemp) return `${(v - 273.15).toFixed(1)}`;
            return formatValue(v, units);
        };

        const minEl = document.getElementById(`${prefix}-min`);
        const maxEl = document.getElementById(`${prefix}-max`);
        const avgEl = document.getElementById(`${prefix}-avg`);
        if (minEl) minEl.textContent = fmt(stats.min);
        if (maxEl) maxEl.textContent = fmt(stats.max);
        if (avgEl) avgEl.textContent = fmt(avg);
    }

    _resetStats(stats, prefix) {
        stats.min = Infinity;
        stats.max = -Infinity;
        stats.sum = 0;
        stats.count = 0;
        for (const s of ["min", "max", "avg"]) {
            const el = document.getElementById(`${prefix}-${s}`);
            if (el) el.textContent = "---";
        }
    }

    _resetAllStats() {
        this._resetStats(this._ch1Stats, "ch1");
        this._resetStats(this._ch2Stats, "ch2");
        this._resetStats(this._mathStats, "math");
    }

    _initGraph() {
        const container = document.getElementById("graph-container");
        this.graph = new RealtimeGraph(container, 500);
        this.graphRefreshInterval = setInterval(() => {
            if (this.graph) this.graph.refresh();
            if (this.dataTable && this._tableSource === "live") this.dataTable.refresh();
        }, 200);
    }

    _initDataTable() {
        const container = document.getElementById("table-container");
        this.dataTable = new DataTable(container);
        this.dataTable.setLiveSource(this.graph.data);
        this._populateTableSources();

        // Restore saved pane swap
        if (localStorage.getItem("mooshi:panes-swapped") === "1") {
            this._swapPanes();
        }
    }

    // --- Pane vertical resize ---

    _initPaneResize() {
        const divider = document.getElementById("pane-divider");
        const main = document.querySelector(".main");
        const graphPane = document.getElementById("pane-graph");
        let startY, startH;

        const onMove = (e) => {
            const mainRect = main.getBoundingClientRect();
            const newH = Math.max(80, Math.min(mainRect.height - 120, startH + e.clientY - startY));
            const pct = (newH / mainRect.height * 100).toFixed(1);
            main.style.setProperty("--pane-split", pct + "%");
        };

        const onUp = () => {
            divider.classList.remove("dragging");
            document.body.classList.remove("pane-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            localStorage.setItem("mooshi:pane-split", main.style.getPropertyValue("--pane-split"));
            if (this.graph) this.graph.refresh();
        };

        divider.addEventListener("mousedown", (e) => {
            e.preventDefault();
            startY = e.clientY;
            startH = graphPane.offsetHeight;
            divider.classList.add("dragging");
            document.body.classList.add("pane-resizing");
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        const saved = localStorage.getItem("mooshi:pane-split");
        if (saved) main.style.setProperty("--pane-split", saved);
    }

    _swapPanes() {
        const main = document.querySelector(".main");
        const graphPane = document.getElementById("pane-graph");
        const tablePane = document.getElementById("pane-table");
        const divider = document.getElementById("pane-divider");

        const isSwapped = main.classList.toggle("panes-swapped");

        if (isSwapped) {
            main.insertBefore(tablePane, graphPane);
            main.insertBefore(divider, graphPane);
        } else {
            main.insertBefore(graphPane, tablePane);
            main.insertBefore(divider, tablePane);
        }

        localStorage.setItem("mooshi:panes-swapped", isSwapped ? "1" : "0");

        requestAnimationFrame(() => {
            if (this.graph) this.graph.refresh();
        });
    }

    async _populateTableSources() {
        const sel = document.getElementById("table-source");
        const currentVal = sel.value;
        sel.innerHTML = `<option value="live">Live</option>`;

        try {
            const sessions = await this.sampleStore.listSessions();
            for (const s of sessions) {
                const date = new Date(s.startTime).toLocaleDateString();
                const count = (s.sampleCount || 0).toLocaleString();
                const dur = s.endTime ? formatDuration(s.endTime - s.startTime) : "active";
                const opt = document.createElement("option");
                opt.value = `session:${s.id}`;
                const label = s.title ? `${s.title} — ${date} (${dur})` : `${date} (${dur}, ${count} rows)`;
                opt.textContent = label;
                sel.appendChild(opt);
            }
        } catch (e) { /* IDB not ready */ }

        for (const opt of sel.options) {
            if (opt.value === currentVal) { sel.value = currentVal; return; }
        }
        sel.value = "live";
        this._tableSource = "live";
    }

    async _onTableSourceChanged(value) {
        if (value === "live") {
            this._tableSource = "live";
            this.dataTable.setLiveSource(this.graph.data);
            document.getElementById("table-row-count").textContent = "";
        } else if (value.startsWith("session:")) {
            const sessionId = parseInt(value.split(":")[1]);
            this._tableSource = value;
            showToast("Loading session...", { duration: 1500 });
            const sessions = await this.sampleStore.listSessions();
            const session = sessions.find(s => s.id === sessionId);
            const hasMath = !!(session && session.mathLabel);
            await this.dataTable.setSessionSource(this.sampleStore, sessionId, hasMath);
            const count = await this.sampleStore.getSessionSampleCount(sessionId);
            document.getElementById("table-row-count").textContent = `${count.toLocaleString()} rows`;
        }
    }

    async _initSampleStore() {
        try {
            await this.sampleStore.open();
            this._populateTableSources();
        } catch (e) {
            console.warn("IndexedDB not available:", e);
        }
    }

    // --- Connection state indicator ---

    _setConnectionState(state) {
        const dot = document.getElementById("conn-dot");
        dot.className = "conn-dot " + state;
    }

    // --- Range handling ---

    _onRangeChanged(ch) {
        const sel = document.getElementById(`ch${ch}-range`);
        const selectedIdx = sel.selectedIndex;
        const offset = ch === 1 ? this._ch1RangeAutoOffset : this._ch2RangeAutoOffset;

        if (selectedIdx === 0) {
            if (ch === 1) this.ch1AutoRange = true;
            else this.ch2AutoRange = true;
        } else {
            const rangeIdx = selectedIdx - offset;
            if (ch === 1) { this.ch1AutoRange = false; this.ch1RangeIdx = rangeIdx; }
            else { this.ch2AutoRange = false; this.ch2RangeIdx = rangeIdx; }
            this._sendCmd(`CH${ch}:RANGE_I ${rangeIdx}`);
        }
    }

    _refreshRanges(ch) {
        if (!this.meter?.isTreeLoaded) return;
        const input = ch === 1 ? this.ch1Input : this.ch2Input;
        const mappingName = input?.mapping || "";
        const { names, autoOffset } = getRangeOptions(this.meter, ch, mappingName);

        if (ch === 1) this._ch1RangeAutoOffset = autoOffset;
        else this._ch2RangeAutoOffset = autoOffset;

        this._populateSelect(`ch${ch}-range`, names);
        document.getElementById(`ch${ch}-range`).selectedIndex = 0;
        if (ch === 1) this.ch1AutoRange = true;
        else this.ch2AutoRange = true;
    }

    _doAutoRange(ch, absValue) {
        const isAuto = ch === 1 ? this.ch1AutoRange : this.ch2AutoRange;
        if (!isAuto) return;
        const input = ch === 1 ? this.ch1Input : this.ch2Input;
        if (!input) return;

        const currentIdx = ch === 1 ? this.ch1RangeIdx : this.ch2RangeIdx;
        const newIdx = autoRangeCheck(absValue, currentIdx, input.mapping);

        if (newIdx !== null) {
            if (ch === 1) this.ch1RangeIdx = newIdx;
            else this.ch2RangeIdx = newIdx;
            this._sendCmd(`CH${ch}:RANGE_I ${newIdx}`);
            const offset = ch === 1 ? this._ch1RangeAutoOffset : this._ch2RangeAutoOffset;
            const sel = document.getElementById(`ch${ch}-range`);
            if (sel.options.length > newIdx + offset) sel.selectedIndex = newIdx + offset;
        }
    }

    // --- Input selection ---

    _onInputChanged(ch) {
        const sel = document.getElementById(`ch${ch}-input`);
        const inputs = ch === 1 ? this.ch1Inputs : this.ch2Inputs;
        const desc = inputs[sel.selectedIndex];
        if (!desc || !this.meter) return;

        if (ch === 1) this.ch1Input = desc;
        else this.ch2Input = desc;

        // Update measurement bar label
        const labelEl = document.getElementById(`ch${ch}-label`);
        if (labelEl) labelEl.textContent = desc.label;

        const mappingIdx = findMappingIndex(this.meter, ch, desc.mapping);
        if (mappingIdx < 0) { console.warn(`Mapping "${desc.mapping}" not found`); return; }

        this._sendCmd(`CH${ch}:MAPPING ${mappingIdx}`);
        setTimeout(() => this._sendCmd(`CH${ch}:ANALYSIS ${desc.analysis}`), 60);

        setTimeout(() => {
            this._refreshRanges(ch);
            if (desc.sharedRangeHint !== undefined) {
                setTimeout(() => {
                    const rangeIdx = findSharedRangeIndex(this.meter, ch, desc.sharedRangeHint);
                    if (rangeIdx >= 0) {
                        if (ch === 1) this.ch1RangeIdx = rangeIdx;
                        else this.ch2RangeIdx = rangeIdx;
                        this._sendCmd(`CH${ch}:RANGE_I ${rangeIdx}`);
                    }
                }, 150);
            }
        }, 200);

        if (ch === 1) { this.ch1Offset = 0; this._resetStats(this._ch1Stats, "ch1"); }
        else { this.ch2Offset = 0; this._resetStats(this._ch2Stats, "ch2"); }
    }

    _onMathChanged() {
        const sel = document.getElementById("math-input");
        this.mathInput = MATH_INPUTS[sel.selectedIndex] || null;

        const mathCard = document.getElementById("measure-math-card");
        const active = this.mathInput && this.mathInput.id !== "off";
        if (!active) {
            if (mathCard) mathCard.style.display = "none";
            document.getElementById("math-value").textContent = "---";
        } else {
            if (mathCard) mathCard.style.display = "";
            const labelEl = document.getElementById("math-label");
            if (labelEl) labelEl.textContent = this.mathInput.label;
        }
        this._resetStats(this._mathStats, "math");

        // Update graph and table math channel
        if (this.graph) this.graph.setMathActive(active, active ? this.mathInput.label : "Math");
        if (this.dataTable) this.dataTable.setMathActive(active);
    }

    // --- Display font ---

    _fontMap = {
        default: '"Consolas", "Cascadia Code", "JetBrains Mono", monospace',
        digital: '"Digital Display", "Consolas", monospace',
        cascadia: '"Cascadia Code", "Consolas", monospace',
        jetbrains: '"JetBrains Mono", "Consolas", monospace',
        fira: '"Fira Code", "Consolas", monospace',
        source: '"Source Code Pro", "Consolas", monospace',
        courier: '"Courier New", "Courier", monospace',
    };

    _onFontChanged(value) {
        const family = this._fontMap[value] || this._fontMap.default;
        document.documentElement.style.setProperty("--measure-font", family);
        try { localStorage.setItem("mooshi_measure_font", value); } catch {}
    }

    _loadFontPref() {
        try {
            const saved = localStorage.getItem("mooshi_measure_font");
            if (saved && this._fontMap[saved]) {
                document.getElementById("measure-font").value = saved;
                this._onFontChanged(saved);
            }
        } catch {}
    }

    // --- Scan & Connect ---

    async _onScan() {
        try {
            this._setConnectionState("connecting");
            this._setStatus("Requesting device...");
            this.meter = new Mooshimeter();
            this._attachMeterEvents();

            await this.meter.requestDevice();
            this._setStatus(`Connecting to ${this.meter.device.name || "device"}...`);
            await this.meter.connect();
        } catch (e) {
            if (e.name === "NotFoundError") {
                this._setStatus("No device selected.");
                this._setConnectionState("disconnected");
            } else {
                this._setStatus(`Error: ${e.message}`, "error");
                this._setConnectionState("error");
                showToast(`Connection failed: ${e.message}`, { type: "error" });
                console.error(e);
            }
        }
    }

    _attachMeterEvents() {
        this.meter.addEventListener("connected", () => {
            this._setConnectionState("connected");
            this._setDeviceMode("mooshi");
            document.getElementById("btn-scan").disabled = true;
            document.getElementById("btn-disconnect").disabled = false;
            this._enableControls(true);
            this._populateControls();
            this._startHeartbeat();
            showToast(`Connected to ${this.meter.deviceName}`, { type: "success" });
        });

        this.meter.addEventListener("disconnected", () => {
            this._setConnectionState("disconnected");
            this._setDeviceMode("none");
            this._setStatus("Disconnected");
            document.getElementById("btn-scan").disabled = false;
            document.getElementById("btn-disconnect").disabled = true;
            this._enableControls(false);
            this._stopHeartbeat();
            this.streaming = false;
            document.getElementById("btn-stream").innerHTML = '<i class="fa-solid fa-play"></i> Start';
            document.getElementById("btn-stream").classList.remove("active");
            showToast("Disconnected", { type: "warning" });
        });

        this.meter.addEventListener("status", (e) => this._setStatus(e.detail.message));

        this.meter.addEventListener("ch1", (e) => {
            this.lastCh1 = e.detail.value;
            const adjusted = e.detail.value - this.ch1Offset;
            this._updateChannelDisplay(1, adjusted);
            this._updateStats(this._ch1Stats, adjusted, "ch1");
            this._checkContinuity(1, adjusted);
            this._doAutoRange(1, Math.abs(adjusted));
        });

        this.meter.addEventListener("ch2", (e) => {
            this.lastCh2 = e.detail.value;
            const adjusted = e.detail.value - this.ch2Offset;
            this._updateChannelDisplay(2, adjusted);
            this._updateStats(this._ch2Stats, adjusted, "ch2");
            this._checkContinuity(2, adjusted);
            this._doAutoRange(2, Math.abs(adjusted));
        });

        this.meter.addEventListener("sample", (e) => {
            const { ch1, ch2 } = e.detail;
            const mathValue = this._computeMathValue(ch1, ch2);
            if (this.graph) this.graph.addSample(ch1 - this.ch1Offset, ch2 - this.ch2Offset, mathValue);
            this._updateMathDisplay(mathValue);
            this._logSample(ch1, ch2, mathValue);
            this.sampleCount++;
            if (this.sampleCount % 5 === 0) {
                const el = document.getElementById("sample-count");
                el.textContent = `${this.sampleCount} samples`;
                el.style.display = "";
            }
        });

        this.meter.addEventListener("battery", (e) => {
            const v = e.detail.value;
            const el = document.getElementById("bat-value");
            el.textContent = `${v.toFixed(2)}V`;
            if (v < 2.5) el.style.color = "var(--error)";
            else if (v < 2.8) el.style.color = "var(--warning)";
            else el.style.color = "";
        });

        this.meter.addEventListener("name", (e) => {
            document.getElementById("device-name").textContent = e.detail.value;
        });

        this.meter.addEventListener("pcb", (e) => {
            document.getElementById("pcb-value").textContent = `v${e.detail.value}`;
        });
    }

    async _onDisconnect() {
        if (this.meter) {
            await this.meter.disconnect();
            this.meter = null;
        }
    }

    // --- Populate controls from config tree ---

    _populateControls() {
        if (!this.meter?.isTreeLoaded) return;

        this.ch1Inputs = getAvailableInputs(this.meter, 1);
        this.ch2Inputs = getAvailableInputs(this.meter, 2);

        this._populateSelect("ch1-input", this.ch1Inputs.map(d => d.label));
        this._populateSelect("ch2-input", this.ch2Inputs.map(d => d.label));
        this._populateSelect("math-input", MATH_INPUTS.map(d => d.label));

        this.ch1Input = this.ch1Inputs[0] || null;
        this.ch2Input = this.ch2Inputs[0] || null;
        this.mathInput = MATH_INPUTS[0];

        // Update measurement bar labels
        if (this.ch1Input) {
            const l1 = document.getElementById("ch1-label");
            if (l1) l1.textContent = this.ch1Input.label;
        }
        if (this.ch2Input) {
            const l2 = document.getElementById("ch2-label");
            if (l2) l2.textContent = this.ch2Input.label;
        }

        this._refreshRanges(1);
        this._refreshRanges(2);

        this._populateSelect("samp-rate", this.meter.getSampleRates());
        this._populateSelect("samp-depth", this.meter.getBufferDepths());
        const depthSel = document.getElementById("samp-depth");
        if (depthSel.options.length >= 4) depthSel.selectedIndex = 3;

        if (this.meter.device?.name) {
            document.getElementById("device-name").textContent = this.meter.device.name;
        }
        this._sendCmd("NAME");
        this._sendCmd("PCB_VERSION");
    }

    _populateSelect(id, options) {
        const sel = document.getElementById(id);
        sel.innerHTML = "";
        for (const opt of options) {
            const el = document.createElement("option");
            el.textContent = opt;
            sel.appendChild(el);
        }
    }

    // --- Channel display ---

    _updateChannelDisplay(ch, value) {
        if (this.displayHeld) return;
        const desc = ch === 1 ? this.ch1Input : this.ch2Input;
        if (!desc) return;

        let display;
        if (desc.isTemp) {
            display = `${kelvinToCelsius(value).toFixed(2)} \u00b0C`;
        } else {
            display = formatValue(value, desc.units);
        }

        const el = document.getElementById(`ch${ch}-value`);
        el.textContent = display;

        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
    }

    // --- Math channel ---

    _computeMathValue(ch1Raw, ch2Raw) {
        const desc = this.mathInput;
        if (!desc || desc.id === "off") return null;

        switch (desc.id) {
            case "real_power":
                return this.meter?.realPower != null ? this.meter.realPower : null;
            case "apparent_power":
                return Math.abs(ch1Raw) * Math.abs(ch2Raw);
            case "power_factor":
                if (this.meter?.realPower != null) {
                    const apparent = Math.abs(ch1Raw) * Math.abs(ch2Raw);
                    if (apparent > 1e-9) {
                        return Math.max(-1, Math.min(1, this.meter.realPower / apparent));
                    }
                }
                return null;
            case "tc_k":
            case "tc_j":
            case "tc_t": {
                let auxV = null, tempK = null;
                if (this.ch1Input?.mapping === "SHARED" && !this.ch1Input?.isTemp) auxV = ch1Raw;
                else if (this.ch1Input?.isTemp) tempK = ch1Raw;
                if (this.ch2Input?.mapping === "SHARED" && !this.ch2Input?.isTemp) auxV = ch2Raw;
                else if (this.ch2Input?.isTemp) tempK = ch2Raw;
                if (tempK === null) tempK = 298.15;
                if (auxV !== null) {
                    return kelvinToCelsius(thermocoupleVoltageToTemp(auxV, tempK, desc.tcType));
                }
                return null;
            }
        }
        return null;
    }

    _updateMathDisplay(numericValue) {
        if (this.displayHeld) return;
        const desc = this.mathInput;
        if (!desc || desc.id === "off") return;

        const el = document.getElementById("math-value");
        let display = "---";

        if (numericValue !== null) {
            switch (desc.id) {
                case "real_power":
                case "apparent_power":
                    display = formatValue(numericValue, "W");
                    break;
                case "power_factor":
                    display = numericValue.toFixed(4);
                    break;
                case "tc_k":
                case "tc_j":
                case "tc_t":
                    display = `${numericValue.toFixed(2)} \u00b0C`;
                    break;
            }
        }

        el.textContent = display;
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");

        if (numericValue !== null) {
            this._updateStats(this._mathStats, numericValue, "math");
        }
    }

    // --- Continuity ---

    _checkContinuity(ch, value) {
        if (!this.continuityEnabled) return;
        const desc = ch === 1 ? this.ch1Input : this.ch2Input;
        if (!desc) return;

        let shouldBeep = false;
        if (desc.label === "Resistance" && value >= 0 && value < CONTINUITY_THRESHOLD_OHMS) shouldBeep = true;
        if (desc.isDiode && value >= 0 && value < DIODE_BEEP_THRESHOLD_V) shouldBeep = true;

        if (shouldBeep && !this._beepActive) this._startBeep();
        else if (!shouldBeep && this._beepActive) this._stopBeep();
    }

    _startBeep() {
        if (this._beepActive) return;
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this._beepOsc = this._audioCtx.createOscillator();
            this._beepGain = this._audioCtx.createGain();
            this._beepOsc.type = "sine";
            this._beepOsc.frequency.value = 800;
            this._beepGain.gain.value = 0.15;
            this._beepOsc.connect(this._beepGain);
            this._beepGain.connect(this._audioCtx.destination);
            this._beepOsc.start();
            this._beepActive = true;
        } catch (e) { /* AudioContext may not be available */ }
    }

    _stopBeep() {
        if (!this._beepActive) return;
        try { this._beepOsc.stop(); this._beepOsc.disconnect(); this._beepGain.disconnect(); }
        catch (e) { /* ignore */ }
        this._beepActive = false;
    }

    // --- Streaming ---

    _toggleStream() {
        if (this._deviceMode === "none") return;

        const btn = document.getElementById("btn-stream");

        // For Mooshimeter
        if (this._deviceMode === "mooshi" && this.meter?.isConnected) {
            if (this.streaming) {
                this._sendCmd("SAMPLING:TRIGGER 0");
                btn.innerHTML = '<i class="fa-solid fa-play"></i> Start';
                btn.classList.remove("active");
                this.streaming = false;
            } else {
                this._sendCmd("SAMPLING:TRIGGER 2");
                btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
                btn.classList.add("active");
                this.streaming = true;
                this._resetAllStats();
                this._switchToLiveSource();
            }
        }

        // For DMM — streaming is always on when connected, but we toggle the UI state
        if (this._deviceMode === "dmm") {
            this.streaming = !this.streaming;
            btn.innerHTML = this.streaming
                ? '<i class="fa-solid fa-stop"></i> Stop'
                : '<i class="fa-solid fa-play"></i> Start';
            btn.classList.toggle("active", this.streaming);
            if (this.streaming) {
                this._resetAllStats();
                this._switchToLiveSource();
            }
        }
    }

    _switchToLiveSource() {
        if (this._tableSource !== "live") {
            this._tableSource = "live";
            const sel = document.getElementById("table-source");
            sel.value = "live";
            if (this.dataTable && this.graph) {
                this.dataTable.setLiveSource(this.graph.data);
            }
            document.getElementById("table-row-count").textContent = "";
        }
    }

    // --- IndexedDB Logging ---

    async _toggleLogging() {
        const btn = document.getElementById("btn-log");
        const status = document.getElementById("log-status");

        if (this.logging) {
            const session = await this.sampleStore.stopSession();
            this.logging = false;
            this._stopLogUpdateTimer();
            btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i> Start Log';
            btn.classList.remove("active");
            const count = session?.sampleCount || 0;
            const dur = session ? formatDuration(session.endTime - session.startTime) : "";
            status.textContent = `Saved ${count.toLocaleString()} samples (${dur})`;

            // Show save-session modal for title/note
            if (session) {
                this._showSaveSessionModal(session);
            }

            this._populateTableSources();
        } else {
            const ch1Label = this.ch1Input?.label || "CH1";
            const ch2Label = this.ch2Input?.label || "CH2";
            const mathLabel = (this.mathInput && this.mathInput.id !== "off") ? this.mathInput.label : null;
            await this.sampleStore.startSession(ch1Label, ch2Label, mathLabel);
            this.logging = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-stop"></i> Stop Log';
            btn.classList.add("active");
            status.textContent = "Recording...";
            showToast("Logging started", { type: "info", duration: 1500 });
            this._startLogUpdateTimer();
        }
    }

    _logSample(ch1, ch2, math) {
        if (!this.logging) return;
        this.sampleStore.addSample(ch1, ch2, math);
    }

    _startLogUpdateTimer() {
        this._stopLogUpdateTimer();
        this._logUpdateTimer = setInterval(() => {
            if (this.logging) {
                document.getElementById("log-status").textContent =
                    `Recording... ${this.sampleStore.activeCount.toLocaleString()} samples`;
            }
        }, 1000);
    }

    _stopLogUpdateTimer() {
        if (this._logUpdateTimer) { clearInterval(this._logUpdateTimer); this._logUpdateTimer = null; }
    }

    _showSaveSessionModal(session) {
        const count = (session.sampleCount || 0).toLocaleString();
        const dur = session.endTime ? formatDuration(session.endTime - session.startTime) : "";

        const modal = document.createElement("div");
        modal.className = "modal-overlay";
        modal.id = "save-session-modal";
        modal.innerHTML = `
            <div class="modal-content" style="min-width:380px; max-width:460px;">
                <div class="modal-header">
                    <span class="card-title" style="margin:0; font-size:13px;">Session Saved</span>
                    <span style="font-size:11px; color:var(--text-dim);">${count} samples &middot; ${dur}</span>
                    <span style="flex:1;"></span>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                    <div>
                        <label style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim); display:block; margin-bottom:3px;">Title</label>
                        <input type="text" id="session-title-input" placeholder="e.g. Motor startup test" style="width:100%; padding:6px 8px; font-size:13px; background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:4px; outline:none; font-family:inherit;">
                    </div>
                    <div>
                        <label style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim); display:block; margin-bottom:3px;">Note</label>
                        <textarea id="session-note-input" rows="3" placeholder="Optional notes about this session..." style="width:100%; padding:6px 8px; font-size:13px; background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:4px; outline:none; font-family:inherit; resize:vertical;"></textarea>
                    </div>
                </div>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                    <button class="small" id="btn-session-skip">Skip</button>
                    <button class="primary" id="btn-session-save"><i class="fa-solid fa-check"></i> Save</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        const titleInput = document.getElementById("session-title-input");
        const noteInput = document.getElementById("session-note-input");
        titleInput.focus();

        const close = () => modal.remove();

        const save = async () => {
            const title = titleInput.value.trim();
            const note = noteInput.value.trim();
            if (title || note) {
                await this.sampleStore.updateSessionMeta(session.id, title || undefined, note || undefined);
                this._populateTableSources();
                showToast("Session saved" + (title ? `: ${title}` : ""), { type: "success", duration: 2000 });
            } else {
                showToast(`Logged ${count} samples (${dur})`, { type: "success" });
            }
            close();
        };

        document.getElementById("btn-session-skip").addEventListener("click", () => {
            showToast(`Logged ${count} samples (${dur})`, { type: "success" });
            close();
        });
        document.getElementById("btn-session-save").addEventListener("click", save);

        // Enter in title saves, Escape skips
        titleInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { close(); showToast(`Logged ${count} samples (${dur})`, { type: "success" }); }
        });
        noteInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { close(); showToast(`Logged ${count} samples (${dur})`, { type: "success" }); }
        });

        modal.addEventListener("click", (e) => {
            if (e.target === modal) { close(); showToast(`Logged ${count} samples (${dur})`, { type: "success" }); }
        });
    }

    // --- Session Management Modal ---

    async _showSessionsModal() {
        const existing = document.getElementById("sessions-modal");
        if (existing) { existing.remove(); return; }

        const sessions = await this.sampleStore.listSessions();
        const est = await this.sampleStore.estimateStorage();

        const modal = document.createElement("div");
        modal.id = "sessions-modal";
        modal.className = "modal-overlay";

        let rows = "";
        if (sessions.length === 0) {
            rows = `<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:20px;">No saved sessions</td></tr>`;
        } else {
            for (const s of sessions) {
                const dur = s.endTime ? formatDuration(s.endTime - s.startTime) : "In progress...";
                const date = new Date(s.startTime).toLocaleString();
                const count = (s.sampleCount || 0).toLocaleString();
                const title = s.title ? `<strong>${this._escHtml(s.title)}</strong>` : `<span style="color:var(--text-dim);">—</span>`;
                const note = s.note ? `<span title="${this._escHtml(s.note)}" style="cursor:help;">${this._escHtml(s.note).substring(0, 40)}${s.note.length > 40 ? "…" : ""}</span>` : "";
                rows += `<tr data-sid="${s.id}">
                    <td>${title}${note ? `<br><span style="font-size:10px; color:var(--text-dim);">${note}</span>` : ""}</td>
                    <td>${date}</td><td>${dur}</td><td>${count}</td>
                    <td>
                        <button class="small session-export" data-sid="${s.id}" title="Export as CSV">Export</button>
                        <button class="small danger session-delete" data-sid="${s.id}" title="Delete session">Delete</button>
                    </td>
                </tr>`;
            }
        }

        modal.innerHTML = `
            <div class="modal-content" style="min-width:600px; max-width:800px;">
                <div class="modal-header">
                    <span class="card-title" style="margin:0; font-size:13px;">Saved Sessions</span>
                    <span style="font-size:11px; color:var(--text-dim);">Storage: ${formatBytes(est.used)} / ${formatBytes(est.quota)}</span>
                    <span style="flex:1;"></span>
                    <button class="small danger" id="btn-delete-all-sessions" title="Delete all sessions">Delete All</button>
                    <button class="small" id="btn-close-sessions">Close</button>
                </div>
                <table class="sessions-table">
                    <thead><tr><th>Title</th><th>Date</th><th>Duration</th><th>Samples</th><th>Actions</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        document.body.appendChild(modal);

        document.getElementById("btn-close-sessions").addEventListener("click", () => modal.remove());
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll(".session-export").forEach(btn => {
            btn.addEventListener("click", async () => {
                const sid = parseInt(btn.dataset.sid);
                btn.textContent = "...";
                btn.disabled = true;
                try {
                    const blob = await this.sampleStore.exportSessionCSV(sid);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `mooshimeter_${sid}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    btn.textContent = "Done";
                    showToast("Session exported", { type: "success", duration: 2000 });
                } catch (e) {
                    btn.textContent = "Error";
                    showToast("Export failed", { type: "error" });
                }
            });
        });

        modal.querySelectorAll(".session-delete").forEach(btn => {
            btn.addEventListener("click", async () => {
                const sid = parseInt(btn.dataset.sid);
                if (!confirm("Delete this session?")) return;
                await this.sampleStore.deleteSession(sid);
                showToast("Session deleted", { type: "info", duration: 1500 });
                modal.remove();
                this._showSessionsModal();
            });
        });

        document.getElementById("btn-delete-all-sessions").addEventListener("click", async () => {
            if (!confirm("Delete ALL saved sessions?")) return;
            await this.sampleStore.deleteAll();
            showToast("All sessions deleted", { type: "info", duration: 1500 });
            modal.remove();
            this._showSessionsModal();
        });
    }

    // --- CSV Export ---

    async _exportGraphCSV() {
        if (this._tableSource.startsWith("session:")) {
            const sessionId = parseInt(this._tableSource.split(":")[1]);
            showToast("Exporting session...", { duration: 2000 });
            try {
                const blob = await this.sampleStore.exportSessionCSV(sessionId);
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `mooshimeter_${sessionId}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                showToast("Session exported", { type: "success" });
            } catch (e) {
                showToast("Export failed: " + e.message, { type: "error" });
            }
            return;
        }

        if (!this.graph || this.graph.data[0].length === 0) {
            showToast("No graph data to export", { type: "warning", duration: 2000 });
            return;
        }
        const ch1Label = this.ch1Input?.label || "CH1";
        const ch2Label = this.ch2Input?.label || "CH2";
        const mathLabel = (this.mathInput && this.mathInput.id !== "off") ? this.mathInput.label : null;
        this.graph.exportCSV(ch1Label, ch2Label, mathLabel);
        showToast(`Exported ${this.graph.data[0].length} graph points`, { type: "success", duration: 2000 });
    }

    // --- SD Card Logging ---

    _sdLogging = false;
    _toggleSdLog() {
        const btn = document.getElementById("btn-sd-log");
        if (this._sdLogging) {
            this._sendCmd("LOG:ON 0");
            btn.innerHTML = '<i class="fa-solid fa-sd-card"></i> Enable';
            btn.classList.remove("active");
            this._sdLogging = false;
        } else {
            this._sendCmd("LOG:ON 1");
            btn.innerHTML = '<i class="fa-solid fa-sd-card"></i> Disable';
            btn.classList.add("active");
            this._sdLogging = true;
        }
    }

    // --- Heartbeat ---

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.meter?.isConnected) this.meter.heartbeat().catch(() => {});
        }, 10000);
    }

    _stopHeartbeat() {
        if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    }

    // --- Helpers ---

    _sendCmd(cmd) {
        if (this.meter?.isConnected) {
            this.meter.sendCommand(cmd).catch(e => console.error("Cmd error:", e));
        }
    }

    _escHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    _setStatus(msg, level = "info") {
        const el = document.getElementById("status-text");
        el.textContent = msg;
        el.className = `status-${level}`;
    }

    _enableControls(enabled) {
        const ids = [
            "ch1-input", "ch1-range", "ch1-zero",
            "ch2-input", "ch2-range", "ch2-zero",
            "math-input", "btn-continuity",
            "samp-rate", "samp-depth", "btn-stream", "btn-single", "btn-hold",
            "btn-log", "btn-sd-log", "sd-interval",
            "btn-sync-time", "btn-reboot",
        ];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        }
        if (!enabled) {
            document.getElementById("ch1-value").textContent = "---";
            document.getElementById("ch2-value").textContent = "---";
            document.getElementById("math-value").textContent = "---";
            document.getElementById("bat-value").textContent = "---";
            document.getElementById("device-name").textContent = "---";
            document.getElementById("pcb-value").textContent = "---";
            const sc = document.getElementById("sample-count");
            sc.textContent = "";
            sc.style.display = "none";
            this._stopBeep();
            this._resetAllStats();
            this.displayHeld = false;
            const holdBtn = document.getElementById("btn-hold");
            if (holdBtn) { holdBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Hold'; holdBtn.classList.remove("active"); }
        }
    }

    // --- Serial DMM (Experimental) ---

    _initDmm() {
        const sel = document.getElementById("dmm-meter");
        const connectBtn = document.getElementById("btn-dmm-connect");
        const disconnectBtn = document.getElementById("btn-dmm-disconnect");

        if (!sel || !connectBtn) return;

        // Populate meter selector grouped by protocol
        const groups = metersByProtocol();
        const protocolLabels = {
            metex14: "Metex14 (polled)",
            peaktech10: "PeakTech10 (polled)",
            voltcraft14: "Voltcraft14 (streaming)",
            voltcraft15: "Voltcraft15 (streaming)",
            vc820: "VC820 / FS9721 (streaming)",
        };

        this._dmmMeterList = [];
        for (const [proto, meters] of Object.entries(groups)) {
            const optgroup = document.createElement("optgroup");
            optgroup.label = protocolLabels[proto] || proto;
            for (const m of meters) {
                const opt = document.createElement("option");
                opt.textContent = meterName(m);
                opt.value = this._dmmMeterList.length;
                this._dmmMeterList.push(m);
                optgroup.appendChild(opt);
            }
            sel.appendChild(optgroup);
        }

        if (!DmmManager.isSupported()) {
            connectBtn.disabled = true;
            connectBtn.title = "WebSerial API not available. Use Chrome or Edge 89+";
            document.getElementById("dmm-status").textContent = "WebSerial not available";
            return;
        }

        connectBtn.addEventListener("click", () => this._dmmConnect());
        disconnectBtn.addEventListener("click", () => this._dmmDisconnect());
    }

    async _dmmConnect() {
        const sel = document.getElementById("dmm-meter");
        const meter = this._dmmMeterList[parseInt(sel.value)];
        if (!meter) return;

        if (this.dmm) await this._dmmDisconnect();

        this.dmm = new DmmManager();

        this.dmm.addEventListener("connected", (e) => {
            this._setDeviceMode("dmm");
            this._setConnectionState("connected");
            document.getElementById("btn-dmm-connect").disabled = true;
            document.getElementById("btn-dmm-disconnect").disabled = false;
            document.getElementById("dmm-status").textContent = `Connected: ${e.detail.name}`;

            // Enable streaming controls for DMM
            document.getElementById("btn-stream").disabled = false;
            document.getElementById("btn-hold").disabled = false;
            document.getElementById("btn-log").disabled = false;

            // Update device info
            document.getElementById("device-name").textContent = e.detail.name;

            showToast(`DMM connected: ${e.detail.name}`, { type: "success", duration: 2000 });
        });

        this.dmm.addEventListener("disconnected", () => {
            this._setDeviceMode("none");
            this._setConnectionState("disconnected");
            document.getElementById("btn-dmm-connect").disabled = false;
            document.getElementById("btn-dmm-disconnect").disabled = true;
            document.getElementById("dmm-status").textContent = "Disconnected";
            document.getElementById("btn-stream").disabled = true;
            document.getElementById("btn-hold").disabled = true;
            document.getElementById("btn-log").disabled = true;
            document.getElementById("device-name").textContent = "---";
            this.dmm = null;
        });

        this.dmm.addEventListener("error", (e) => {
            document.getElementById("dmm-status").textContent = `Error: ${e.detail.message}`;
            showToast(`DMM error: ${e.detail.message}`, { type: "error" });
        });

        this.dmm.addEventListener("reading", (e) => {
            const r = e.detail;

            // Update DMM measurement bar
            const valEl = document.getElementById("dmm-value");
            const unitEl = document.getElementById("dmm-unit");
            const modeEl = document.getElementById("dmm-mode-label");
            const flagsEl = document.getElementById("dmm-flags");

            // Mode label
            const modeLabels = {
                ac: "AC", dc: "DC", resistance: "Resistance", diode: "Diode",
                frequency: "Frequency", capacitance: "Capacitance",
                temperature: "Temperature", duty: "Duty Cycle",
            };
            const modeText = modeLabels[r.mode] || r.mode || "---";
            const unitText = (r.unit || "");
            modeEl.textContent = r.ac ? `AC ${unitText}` : r.dc ? `DC ${unitText}` : `${modeText} ${unitText}`.trim();

            // Value
            valEl.textContent = r.overload ? "OL" : r.display;
            valEl.classList.remove("flash");
            void valEl.offsetWidth;
            valEl.classList.add("flash");

            // Unit with prefix
            unitEl.textContent = r.overload ? "" : (r.prefix || "") + (r.unit || "");

            // Flags (for VC820-type meters with rich flag data)
            if (r.auto !== undefined) {
                const flags = [];
                if (r.auto) flags.push({ label: "AUTO", active: true });
                if (r.hold) flags.push({ label: "HOLD", active: true });
                if (r.relative) flags.push({ label: "REL", active: true });
                if (r.diode) flags.push({ label: "DIODE", active: true });
                if (r.continuity) flags.push({ label: "BEEP", active: true });
                if (r.lowBattery) flags.push({ label: "LOW BAT", active: true });
                flagsEl.innerHTML = flags.map(f =>
                    `<span class="dmm-flag${f.active ? " active" : ""}">${f.label}</span>`
                ).join("");
            } else {
                flagsEl.innerHTML = "";
            }

            // Feed to graph
            if (this.graph && r.value !== null) {
                this.graph.addSample(r.value, null, null);
            }

            this.sampleCount++;
            if (this.sampleCount % 5 === 0) {
                const el = document.getElementById("sample-count");
                el.textContent = `${this.sampleCount} samples`;
                el.style.display = "";
            }

            // Log if active
            if (this.logging && r.value !== null) {
                this.sampleStore.addSample(r.value, null, null);
            }
        });

        try {
            document.getElementById("dmm-status").textContent = "Connecting...";
            await this.dmm.connect(meter);
        } catch (e) {
            if (e.name !== "NotFoundError") {
                document.getElementById("dmm-status").textContent = `Error: ${e.message}`;
            } else {
                document.getElementById("dmm-status").textContent = "No port selected";
            }
            this.dmm = null;
        }
    }

    async _dmmDisconnect() {
        if (this.dmm) {
            await this.dmm.disconnect();
            this.dmm = null;
        }
    }
}

document.addEventListener("DOMContentLoaded", () => { window.app = new App(); });
