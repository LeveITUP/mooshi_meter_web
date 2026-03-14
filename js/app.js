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

        // Min/Max/Avg stats
        this._ch1Stats = this._emptyStats();
        this._ch2Stats = this._emptyStats();
        this._mathStats = this._emptyStats();

        this._bindUI();
        this._initAccordion();
        this._initResizeHandle();
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

    // --- Theme toggle ---

    _initTheme() {
        const saved = localStorage.getItem("mooshi:theme");
        // Default is light (set in HTML), only switch if explicitly saved as dark
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

        // Utilities
        document.getElementById("btn-sync-time").addEventListener("click", () => {
            this._sendCmd(`TIME_UTC ${Math.floor(Date.now() / 1000)}`);
            showToast("Time synced to UTC", { type: "success", duration: 2000 });
        });
        document.getElementById("btn-reboot").addEventListener("click", () => {
            if (confirm("Reboot the Mooshimeter?")) this._sendCmd("REBOOT 1");
        });
    }

    // --- Collapsible accordion ---

    _initAccordion() {
        document.querySelectorAll("[data-collapsible] > .card-title").forEach(title => {
            title.addEventListener("click", () => {
                const card = title.parentElement;
                card.classList.toggle("collapsed");
                // Persist state
                const key = `collapsed:${card.querySelector(".card-title").textContent.trim().toLowerCase()}`;
                localStorage.setItem(key, card.classList.contains("collapsed") ? "1" : "0");
            });
        });

        // Restore saved state
        document.querySelectorAll("[data-collapsible]").forEach(card => {
            const key = `collapsed:${card.querySelector(".card-title").textContent.trim().toLowerCase()}`;
            if (localStorage.getItem(key) === "1") {
                card.classList.add("collapsed");
            }
        });
    }

    // --- Drag-resizable left panel ---

    _initResizeHandle() {
        const handle = document.getElementById("panel-resize-handle");
        const panel = document.getElementById("panel-left");
        let startX, startW;

        const onMove = (e) => {
            const newW = Math.max(250, Math.min(600, startW + e.clientX - startX));
            document.documentElement.style.setProperty("--panel-left-width", newW + "px");
        };

        const onUp = () => {
            handle.classList.remove("dragging");
            document.body.classList.remove("panel-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            localStorage.setItem("panel-width", panel.offsetWidth);
        };

        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            startX = e.clientX;
            startW = panel.offsetWidth;
            handle.classList.add("dragging");
            document.body.classList.add("panel-resizing");
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        // Restore saved width
        const saved = localStorage.getItem("panel-width");
        if (saved) {
            const w = parseInt(saved);
            if (w >= 250 && w <= 600) {
                document.documentElement.style.setProperty("--panel-left-width", w + "px");
            }
        }
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

        // Update DOM every 5th sample to reduce writes
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
        const panel = document.querySelector(".panel-right");
        const graphPane = document.getElementById("pane-graph");
        let startY, startH;

        const onMove = (e) => {
            const panelRect = panel.getBoundingClientRect();
            const newH = Math.max(80, Math.min(panelRect.height - 120, startH + e.clientY - startY));
            const pct = (newH / panelRect.height * 100).toFixed(1);
            panel.style.setProperty("--pane-split", pct + "%");
        };

        const onUp = () => {
            divider.classList.remove("dragging");
            document.body.classList.remove("pane-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            localStorage.setItem("mooshi:pane-split", panel.style.getPropertyValue("--pane-split"));
            // Trigger graph resize
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

        // Restore saved split
        const saved = localStorage.getItem("mooshi:pane-split");
        if (saved) panel.style.setProperty("--pane-split", saved);
    }

    _swapPanes() {
        const panel = document.querySelector(".panel-right");
        const graphPane = document.getElementById("pane-graph");
        const tablePane = document.getElementById("pane-table");
        const divider = document.getElementById("pane-divider");

        const isSwapped = panel.classList.toggle("panes-swapped");

        if (isSwapped) {
            panel.insertBefore(tablePane, graphPane);
            panel.insertBefore(divider, graphPane);
        } else {
            panel.insertBefore(graphPane, tablePane);
            panel.insertBefore(divider, tablePane);
        }

        localStorage.setItem("mooshi:panes-swapped", isSwapped ? "1" : "0");

        // Refresh graph dimensions after DOM reflow
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
                opt.textContent = `${date} (${dur}, ${count} rows)`;
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
            await this.dataTable.setSessionSource(this.sampleStore, sessionId);
            const count = await this.sampleStore.getSessionSampleCount(sessionId);
            document.getElementById("table-row-count").textContent = `${count.toLocaleString()} rows`;
        }
    }

    async _initSampleStore() {
        try {
            await this.sampleStore.open();
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
        if (!this.mathInput || this.mathInput.id === "off") {
            document.getElementById("math-value").textContent = "---";
        }
        this._resetStats(this._mathStats, "math");
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
            document.getElementById("btn-scan").disabled = true;
            document.getElementById("btn-disconnect").disabled = false;
            this._enableControls(true);
            this._populateControls();
            this._startHeartbeat();
            showToast(`Connected to ${this.meter.deviceName}`, { type: "success" });
        });

        this.meter.addEventListener("disconnected", () => {
            this._setConnectionState("disconnected");
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
            if (this.graph) this.graph.addSample(ch1 - this.ch1Offset, ch2 - this.ch2Offset);
            this._updateMathDisplay(ch1, ch2);
            this._logSample(ch1, ch2);
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

        // Value flash animation
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
    }

    // --- Math channel ---

    _updateMathDisplay(ch1Raw, ch2Raw) {
        if (this.displayHeld) return;
        const desc = this.mathInput;
        if (!desc || desc.id === "off") return;

        const el = document.getElementById("math-value");
        let display = "---";
        let numericValue = null;

        switch (desc.id) {
            case "real_power":
                if (this.meter?.realPower != null) {
                    numericValue = this.meter.realPower;
                    display = formatValue(numericValue, "W");
                }
                break;
            case "apparent_power":
                numericValue = Math.abs(ch1Raw) * Math.abs(ch2Raw);
                display = formatValue(numericValue, "W");
                break;
            case "power_factor":
                if (this.meter?.realPower != null) {
                    const apparent = Math.abs(ch1Raw) * Math.abs(ch2Raw);
                    if (apparent > 1e-9) {
                        numericValue = Math.max(-1, Math.min(1, this.meter.realPower / apparent));
                        display = numericValue.toFixed(4);
                    }
                }
                break;
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
                    numericValue = kelvinToCelsius(thermocoupleVoltageToTemp(auxV, tempK, desc.tcType));
                    display = `${numericValue.toFixed(2)} \u00b0C`;
                }
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
        if (!this.meter?.isConnected) return;
        const btn = document.getElementById("btn-stream");
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
            showToast(`Logged ${count.toLocaleString()} samples (${dur})`, { type: "success" });
            this._populateTableSources();
        } else {
            const ch1Label = this.ch1Input?.label || "CH1";
            const ch2Label = this.ch2Input?.label || "CH2";
            await this.sampleStore.startSession(ch1Label, ch2Label);
            this.logging = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-stop"></i> Stop Log';
            btn.classList.add("active");
            status.textContent = "Recording...";
            showToast("Logging started", { type: "info", duration: 1500 });
            this._startLogUpdateTimer();
        }
    }

    _logSample(ch1, ch2) {
        if (!this.logging) return;
        this.sampleStore.addSample(ch1, ch2);
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
            rows = `<tr><td colspan="4" style="text-align:center; color:var(--text-dim); padding:20px;">No saved sessions</td></tr>`;
        } else {
            for (const s of sessions) {
                const dur = s.endTime ? formatDuration(s.endTime - s.startTime) : "In progress...";
                const date = new Date(s.startTime).toLocaleString();
                const count = (s.sampleCount || 0).toLocaleString();
                rows += `<tr data-sid="${s.id}">
                    <td>${date}</td><td>${dur}</td><td>${count}</td>
                    <td>
                        <button class="small session-export" data-sid="${s.id}" title="Export as CSV">Export</button>
                        <button class="small danger session-delete" data-sid="${s.id}" title="Delete session">Delete</button>
                    </td>
                </tr>`;
            }
        }

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <span class="card-title" style="margin:0; font-size:13px;">Saved Sessions</span>
                    <span style="font-size:11px; color:var(--text-dim);">Storage: ${formatBytes(est.used)} / ${formatBytes(est.quota)}</span>
                    <span style="flex:1;"></span>
                    <button class="small danger" id="btn-delete-all-sessions" title="Delete all sessions">Delete All</button>
                    <button class="small" id="btn-close-sessions">Close</button>
                </div>
                <table class="sessions-table">
                    <thead><tr><th>Date</th><th>Duration</th><th>Samples</th><th>Actions</th></tr></thead>
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
        this.graph.exportCSV(ch1Label, ch2Label);
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

        // Check WebSerial support
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
            document.getElementById("btn-dmm-connect").disabled = true;
            document.getElementById("btn-dmm-disconnect").disabled = false;
            document.getElementById("dmm-status").textContent = `Connected: ${e.detail.name}`;
            document.getElementById("dmm-reading").style.display = "";
            showToast(`DMM connected: ${e.detail.name}`, { type: "success", duration: 2000 });
        });

        this.dmm.addEventListener("disconnected", () => {
            document.getElementById("btn-dmm-connect").disabled = false;
            document.getElementById("btn-dmm-disconnect").disabled = true;
            document.getElementById("dmm-status").textContent = "Disconnected";
            document.getElementById("dmm-reading").style.display = "none";
            this.dmm = null;
        });

        this.dmm.addEventListener("error", (e) => {
            document.getElementById("dmm-status").textContent = `Error: ${e.detail.message}`;
            showToast(`DMM error: ${e.detail.message}`, { type: "error" });
        });

        this.dmm.addEventListener("reading", (e) => {
            const r = e.detail;
            // Update DMM display
            const valEl = document.getElementById("dmm-value");
            const unitEl = document.getElementById("dmm-unit");
            const modeEl = document.getElementById("dmm-mode");

            valEl.textContent = r.overload ? "OL" : r.display;
            unitEl.textContent = (r.prefix || "") + (r.unit || "");
            modeEl.textContent = r.mode || "";

            // Feed to graph as CH1 (CH2 = null)
            if (this.graph && r.value !== null) {
                this.graph.addSample(r.value, null);
            }

            // Update CH1 value display
            if (!this.displayHeld && r.value !== null) {
                const el = document.getElementById("ch1-value");
                el.textContent = r.overload ? "OL" : `${r.display} ${(r.prefix || "") + (r.unit || "")}`;
                el.classList.remove("flash");
                void el.offsetWidth;
                el.classList.add("flash");
            }

            this.sampleCount++;
            if (this.sampleCount % 5 === 0) {
                const el = document.getElementById("sample-count");
                el.textContent = `${this.sampleCount} samples`;
                el.style.display = "";
            }

            // Log if active
            if (this.logging && r.value !== null) {
                this.sampleStore.addSample(r.value, null);
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
