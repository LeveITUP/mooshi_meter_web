/** Real-time graphing with combined, split, and per-channel modes + CSV export. */

// Graph display modes
export const GRAPH_MODE = {
    COMBINED: "combined",   // Both channels, dual Y-axes
    SPLIT:    "split",      // Two side-by-side graphs
    CH1_ONLY: "ch1",        // CH1 only
    CH2_ONLY: "ch2",        // CH2 only
};

export class RealtimeGraph {
    constructor(container, maxPoints = 500) {
        this.container = container;
        this.maxPoints = maxPoints;
        this.startTime = null;
        this.mode = GRAPH_MODE.COMBINED;

        // Shared data store: [timestamps, ch1, ch2, math]
        this.data = [[], [], [], []];

        // Math channel state
        this.mathActive = false;
        this.mathLabel = "Math";

        // Plot instances
        this.plot = null;
        this.plot2 = null;   // second plot for split mode
        this.plot3 = null;   // third plot for math in split mode

        // Inner wrappers for split layout
        this._topDiv = null;
        this._botDiv = null;
        this._mathDiv = null;

        this._buildLayout();
        this._initPlots();

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(container);
    }

    _buildLayout() {
        // Create inner divs for split mode (side by side)
        this.container.innerHTML = "";

        this._splitWrap = document.createElement("div");
        this._splitWrap.className = "graph-split-wrap";
        this._splitWrap.style.cssText = "display:flex; width:100%; height:100%;";

        this._topDiv = document.createElement("div");
        this._topDiv.className = "graph-pane graph-pane-left";
        this._topDiv.style.cssText = "position:relative; height:100%;";

        this._botDiv = document.createElement("div");
        this._botDiv.className = "graph-pane graph-pane-right";
        this._botDiv.style.cssText = "position:relative; height:100%; display:none;";

        this._mathDiv = document.createElement("div");
        this._mathDiv.className = "graph-pane graph-pane-math";
        this._mathDiv.style.cssText = "position:relative; height:100%; display:none;";

        this._splitWrap.appendChild(this._topDiv);
        this._splitWrap.appendChild(this._botDiv);
        this._splitWrap.appendChild(this._mathDiv);
        this.container.appendChild(this._splitWrap);

        this._applyLayout();
    }

    _applyLayout() {
        const split = this.mode === GRAPH_MODE.SPLIT;
        const mathSplit = split && this.mathActive;

        if (mathSplit) {
            this._topDiv.style.width = "33.33%";
            this._botDiv.style.display = "block";
            this._botDiv.style.width = "33.33%";
            this._mathDiv.style.display = "block";
            this._mathDiv.style.width = "33.34%";
        } else if (split) {
            this._topDiv.style.width = "50%";
            this._botDiv.style.display = "block";
            this._botDiv.style.width = "50%";
            this._mathDiv.style.display = "none";
        } else {
            this._topDiv.style.width = "100%";
            this._botDiv.style.display = "none";
            this._mathDiv.style.display = "none";
        }
    }

    _makePlotOpts(series, axes, targetDiv) {
        return {
            width: targetDiv.clientWidth || 800,
            height: targetDiv.clientHeight || 220,
            cursor: { show: true, drag: { x: true, y: false } },
            select: { show: false },
            legend: { show: true },
            scales: { x: { time: false } },
            axes: [
                {
                    stroke: "#888",
                    grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
                    ticks: { stroke: "#555", width: 1 },
                    font: "11px monospace",
                    label: "Time (s)",
                    labelFont: "11px sans-serif",
                    labelSize: 18,
                },
                ...axes,
            ],
            series: [{ label: "Time" }, ...series],
        };
    }

    _ch1Series() {
        return {
            label: "CH1", scale: "y1", stroke: "#ff4444", width: 1.5,
            points: { show: false },
        };
    }

    _ch1Axis() {
        return {
            scale: "y1", stroke: "#ff4444", side: 3,
            grid: { stroke: "rgba(255,68,68,0.08)", width: 1 },
            ticks: { stroke: "#553333", width: 1 },
            font: "11px monospace", label: "CH1",
            labelFont: "11px sans-serif", labelSize: 20,
        };
    }

    _ch2Series() {
        return {
            label: "CH2", scale: "y2", stroke: "#44cc44", width: 1.5,
            points: { show: false },
        };
    }

    _ch2Axis() {
        return {
            scale: "y2", stroke: "#44cc44", side: 1,
            grid: { show: false },
            ticks: { stroke: "#335533", width: 1 },
            font: "11px monospace", label: "CH2",
            labelFont: "11px sans-serif", labelSize: 20,
        };
    }

    _mathSeries() {
        return {
            label: this.mathLabel, scale: "y3", stroke: "#4488ff", width: 1.5,
            points: { show: false },
        };
    }

    _mathAxis() {
        return {
            scale: "y3", stroke: "#4488ff", side: 1,
            grid: { show: false },
            ticks: { stroke: "#334466", width: 1 },
            font: "11px monospace", label: this.mathLabel,
            labelFont: "11px sans-serif", labelSize: 20,
        };
    }

    _destroyPlots() {
        if (this.plot) { this.plot.destroy(); this.plot = null; }
        if (this.plot2) { this.plot2.destroy(); this.plot2 = null; }
        if (this.plot3) { this.plot3.destroy(); this.plot3 = null; }
        this._topDiv.innerHTML = "";
        this._botDiv.innerHTML = "";
        this._mathDiv.innerHTML = "";
    }

    _initPlots() {
        this._destroyPlots();
        this._applyLayout();

        switch (this.mode) {
            case GRAPH_MODE.COMBINED: {
                const series = [this._ch1Series(), this._ch2Series()];
                const axes = [this._ch1Axis(), this._ch2Axis()];
                const empty = [[], [], []];
                if (this.mathActive) {
                    series.push(this._mathSeries());
                    axes.push(this._mathAxis());
                    empty.push([]);
                }
                const opts = this._makePlotOpts(series, axes, this._topDiv);
                this.plot = new uPlot(opts, empty, this._topDiv);
                break;
            }
            case GRAPH_MODE.CH1_ONLY: {
                const opts = this._makePlotOpts(
                    [this._ch1Series()],
                    [this._ch1Axis()],
                    this._topDiv,
                );
                this.plot = new uPlot(opts, [[], []], this._topDiv);
                break;
            }
            case GRAPH_MODE.CH2_ONLY: {
                const s = this._ch2Series();
                s.scale = "y1";
                const a = this._ch2Axis();
                a.scale = "y1"; a.side = 3;
                a.grid = { stroke: "rgba(68,204,68,0.08)", width: 1 };
                const opts = this._makePlotOpts([s], [a], this._topDiv);
                this.plot = new uPlot(opts, [[], []], this._topDiv);
                break;
            }
            case GRAPH_MODE.SPLIT: {
                const opts1 = this._makePlotOpts(
                    [this._ch1Series()],
                    [this._ch1Axis()],
                    this._topDiv,
                );
                this.plot = new uPlot(opts1, [[], []], this._topDiv);

                const s2 = this._ch2Series();
                s2.scale = "y1";
                const a2 = this._ch2Axis();
                a2.scale = "y1"; a2.side = 3;
                a2.grid = { stroke: "rgba(68,204,68,0.08)", width: 1 };
                const opts2 = this._makePlotOpts([s2], [a2], this._botDiv);
                this.plot2 = new uPlot(opts2, [[], []], this._botDiv);

                if (this.mathActive) {
                    const sm = this._mathSeries();
                    sm.scale = "y1";
                    const am = this._mathAxis();
                    am.scale = "y1"; am.side = 3;
                    am.grid = { stroke: "rgba(68,136,255,0.08)", width: 1 };
                    const opts3 = this._makePlotOpts([sm], [am], this._mathDiv);
                    this.plot3 = new uPlot(opts3, [[], []], this._mathDiv);
                }
                break;
            }
        }
    }

    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this._initPlots();
        this.refresh();
    }

    /** Enable or disable the math channel on the graph. */
    setMathActive(active, label) {
        if (label) this.mathLabel = label;
        if (active === this.mathActive) return;
        this.mathActive = active;
        this._initPlots();
        this.refresh();
    }

    _resize() {
        const w = this.container.clientWidth;
        if (w <= 0) return;

        if (this.plot && this._topDiv.clientHeight > 0) {
            this.plot.setSize({ width: this._topDiv.clientWidth, height: this._topDiv.clientHeight });
        }
        if (this.plot2 && this._botDiv.clientHeight > 0) {
            this.plot2.setSize({ width: this._botDiv.clientWidth, height: this._botDiv.clientHeight });
        }
        if (this.plot3 && this._mathDiv.clientHeight > 0) {
            this.plot3.setSize({ width: this._mathDiv.clientWidth, height: this._mathDiv.clientHeight });
        }
    }

    addSample(ch1, ch2, math) {
        const now = performance.now() / 1000;
        if (this.startTime === null) this.startTime = now;
        const t = now - this.startTime;

        this.data[0].push(t);
        this.data[1].push(ch1);
        this.data[2].push(ch2);
        this.data[3].push(math != null ? math : null);

        while (this.data[0].length > this.maxPoints) {
            this.data[0].shift();
            this.data[1].shift();
            this.data[2].shift();
            this.data[3].shift();
        }
    }

    refresh() {
        if (this.data[0].length < 2) return;

        switch (this.mode) {
            case GRAPH_MODE.COMBINED:
                if (this.plot) {
                    if (this.mathActive) {
                        this.plot.setData([this.data[0], this.data[1], this.data[2], this.data[3]]);
                    } else {
                        this.plot.setData([this.data[0], this.data[1], this.data[2]]);
                    }
                }
                break;
            case GRAPH_MODE.CH1_ONLY:
                if (this.plot) this.plot.setData([this.data[0], this.data[1]]);
                break;
            case GRAPH_MODE.CH2_ONLY:
                if (this.plot) this.plot.setData([this.data[0], this.data[2]]);
                break;
            case GRAPH_MODE.SPLIT:
                if (this.plot) this.plot.setData([this.data[0], this.data[1]]);
                if (this.plot2) this.plot2.setData([this.data[0], this.data[2]]);
                if (this.plot3 && this.mathActive) this.plot3.setData([this.data[0], this.data[3]]);
                break;
        }
    }

    clear() {
        this.data = [[], [], [], []];
        this.startTime = null;
        const empty2 = [[], []];
        const empty3 = [[], [], []];

        switch (this.mode) {
            case GRAPH_MODE.COMBINED:
                if (this.plot) this.plot.setData(this.mathActive ? [[], [], [], []] : empty3);
                break;
            case GRAPH_MODE.CH1_ONLY:
            case GRAPH_MODE.CH2_ONLY:
                if (this.plot) this.plot.setData(empty2);
                break;
            case GRAPH_MODE.SPLIT:
                if (this.plot) this.plot.setData(empty2);
                if (this.plot2) this.plot2.setData(empty2);
                if (this.plot3) this.plot3.setData(empty2);
                break;
        }
    }

    setMaxPoints(n) {
        this.maxPoints = n;
        while (this.data[0].length > n) {
            this.data[0].shift();
            this.data[1].shift();
            this.data[2].shift();
            this.data[3].shift();
        }
    }

    /** Export current graph data as CSV and trigger browser download. */
    exportCSV(ch1Label = "CH1", ch2Label = "CH2", mathLabel) {
        if (this.data[0].length === 0) return;

        const hasMath = this.mathActive && mathLabel;
        const header = hasMath
            ? `Time(s),${ch1Label},${ch2Label},${mathLabel}`
            : `Time(s),${ch1Label},${ch2Label}`;
        const lines = [header];
        for (let i = 0; i < this.data[0].length; i++) {
            let line = `${this.data[0][i].toFixed(4)},${this.data[1][i]},${this.data[2][i]}`;
            if (hasMath) line += `,${this.data[3][i] != null ? this.data[3][i] : ""}`;
            lines.push(line);
        }

        const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mooshimeter_graph_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    destroy() {
        this._resizeObserver.disconnect();
        this._destroyPlots();
    }
}
