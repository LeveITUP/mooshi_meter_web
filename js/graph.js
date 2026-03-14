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

        // Shared data store: [timestamps, ch1, ch2]
        this.data = [[], [], []];

        // Plot instances
        this.plot = null;
        this.plot2 = null;  // second plot for split mode

        // Inner wrappers for split layout
        this._topDiv = null;
        this._botDiv = null;

        this._buildLayout();
        this._initPlots();

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(container);
    }

    _buildLayout() {
        // Create two inner divs for split mode (side by side)
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

        this._splitWrap.appendChild(this._topDiv);
        this._splitWrap.appendChild(this._botDiv);
        this.container.appendChild(this._splitWrap);

        this._applyLayout();
    }

    _applyLayout() {
        if (this.mode === GRAPH_MODE.SPLIT) {
            this._topDiv.style.width = "50%";
            this._botDiv.style.display = "block";
            this._botDiv.style.width = "50%";
        } else {
            this._topDiv.style.width = "100%";
            this._botDiv.style.display = "none";
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

    _destroyPlots() {
        if (this.plot) { this.plot.destroy(); this.plot = null; }
        if (this.plot2) { this.plot2.destroy(); this.plot2 = null; }
        this._topDiv.innerHTML = "";
        this._botDiv.innerHTML = "";
    }

    _initPlots() {
        this._destroyPlots();
        this._applyLayout();

        const empty = [[], [], []];

        switch (this.mode) {
            case GRAPH_MODE.COMBINED: {
                const opts = this._makePlotOpts(
                    [this._ch1Series(), this._ch2Series()],
                    [this._ch1Axis(), this._ch2Axis()],
                    this._topDiv,
                );
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
                s.scale = "y1";  // use left axis when solo
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

    _resize() {
        const w = this.container.clientWidth;
        if (w <= 0) return;

        if (this.plot && this._topDiv.clientHeight > 0) {
            this.plot.setSize({ width: this._topDiv.clientWidth, height: this._topDiv.clientHeight });
        }
        if (this.plot2 && this._botDiv.clientHeight > 0) {
            this.plot2.setSize({ width: this._botDiv.clientWidth, height: this._botDiv.clientHeight });
        }
    }

    addSample(ch1, ch2) {
        const now = performance.now() / 1000;
        if (this.startTime === null) this.startTime = now;
        const t = now - this.startTime;

        this.data[0].push(t);
        this.data[1].push(ch1);
        this.data[2].push(ch2);

        while (this.data[0].length > this.maxPoints) {
            this.data[0].shift();
            this.data[1].shift();
            this.data[2].shift();
        }
    }

    refresh() {
        if (this.data[0].length < 2) return;

        switch (this.mode) {
            case GRAPH_MODE.COMBINED:
                if (this.plot) this.plot.setData(this.data);
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
                break;
        }
    }

    clear() {
        this.data = [[], [], []];
        this.startTime = null;
        const empty2 = [[], []];
        const empty3 = [[], [], []];

        switch (this.mode) {
            case GRAPH_MODE.COMBINED:
                if (this.plot) this.plot.setData(empty3);
                break;
            case GRAPH_MODE.CH1_ONLY:
            case GRAPH_MODE.CH2_ONLY:
                if (this.plot) this.plot.setData(empty2);
                break;
            case GRAPH_MODE.SPLIT:
                if (this.plot) this.plot.setData(empty2);
                if (this.plot2) this.plot2.setData(empty2);
                break;
        }
    }

    setMaxPoints(n) {
        this.maxPoints = n;
        while (this.data[0].length > n) {
            this.data[0].shift();
            this.data[1].shift();
            this.data[2].shift();
        }
    }

    /** Export current graph data as CSV and trigger browser download. */
    exportCSV(ch1Label = "CH1", ch2Label = "CH2") {
        if (this.data[0].length === 0) return;

        const lines = [`Time(s),${ch1Label},${ch2Label}`];
        for (let i = 0; i < this.data[0].length; i++) {
            lines.push(`${this.data[0][i].toFixed(4)},${this.data[1][i]},${this.data[2][i]}`);
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
