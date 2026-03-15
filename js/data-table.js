/**
 * Spreadsheet-style data table using AG Grid Community.
 *
 * Two data sources:
 *   - "live": reads from the in-memory graph data arrays (rolling window)
 *   - "session": reads from IndexedDB via SampleStore, using AG Grid's
 *     Infinite Row Model for seamless virtual scrolling over 800K+ rows
 */

const PAGE_SIZE = 200;

export class DataTable {
    constructor(container) {
        this.container = container;
        this._mode = "live";
        this._liveData = null;
        this._store = null;
        this._sessionId = null;
        this._totalRows = 0;
        this._gridApi = null;
        this._liveRowData = [];
        this._lastLiveLen = 0;
        this._mathActive = false;

        this._build();
    }

    _mathColDef() {
        return {
            headerName: "Math",
            field: "math",
            flex: 1,
            minWidth: 110,
            valueFormatter: (p) => this._fmt(p.value),
            cellClass: "ag-math-cell",
            filter: "agNumberColumnFilter",
        };
    }

    _baseColumns(withFilters = true) {
        const cols = [
            {
                headerName: "#",
                field: "rowNum",
                width: 80,
                minWidth: 60,
                pinned: "left",
                sortable: false,
                filter: false,
                suppressMovable: true,
                cellClass: "ag-row-number",
            },
            {
                headerName: "Time (s)",
                field: "time",
                width: 130,
                minWidth: 90,
                valueFormatter: (p) => p.value != null ? p.value.toFixed(4) : "...",
                ...(withFilters && { filter: "agNumberColumnFilter" }),
            },
            {
                headerName: "CH1",
                field: "ch1",
                flex: 1,
                minWidth: 110,
                valueFormatter: (p) => this._fmt(p.value),
                cellClass: "ag-ch1-cell",
                ...(withFilters && { filter: "agNumberColumnFilter" }),
            },
            {
                headerName: "CH2",
                field: "ch2",
                flex: 1,
                minWidth: 110,
                valueFormatter: (p) => this._fmt(p.value),
                cellClass: "ag-ch2-cell",
                ...(withFilters && { filter: "agNumberColumnFilter" }),
            },
        ];
        return cols;
    }

    _themeParams() {
        const isDark = !document.body.classList.contains("theme-light");
        return isDark ? {
            backgroundColor: "#2d2d2d",
            foregroundColor: "#d4d4d4",
            headerBackgroundColor: "#252526",
            headerForegroundColor: "#808080",
            borderColor: "#404040",
            rowHoverColor: "rgba(255,255,255,0.04)",
            selectedRowBackgroundColor: "rgba(0,122,204,0.15)",
            oddRowBackgroundColor: "rgba(255,255,255,0.02)",
            columnBorder: true,
            wrapperBorderRadius: "0px",
            headerColumnBorderHeight: "100%",
            headerColumnBorder: true,
        } : {
            backgroundColor: "#ffffff",
            foregroundColor: "#1a1a1a",
            headerBackgroundColor: "#f5f6fa",
            headerForegroundColor: "#616161",
            borderColor: "#e0e0e0",
            rowHoverColor: "rgba(43,87,154,0.04)",
            selectedRowBackgroundColor: "rgba(43,87,154,0.1)",
            oddRowBackgroundColor: "#fafbfc",
            columnBorder: true,
            wrapperBorderRadius: "0px",
            headerColumnBorderHeight: "100%",
            headerColumnBorder: true,
        };
    }

    _build() {
        this.container.innerHTML = "";

        this._gridDiv = document.createElement("div");
        this._gridDiv.style.width = "100%";
        this._gridDiv.style.height = "100%";
        this._gridDiv.style.flex = "1";
        this.container.appendChild(this._gridDiv);

        this._initGrid();
    }

    _initGrid() {
        const cols = this._baseColumns(true);
        if (this._mathActive) cols.push(this._mathColDef());

        const gridOptions = {
            columnDefs: cols,
            defaultColDef: {
                sortable: true,
                resizable: true,
                suppressHeaderMenuButton: false,
            },
            rowSelection: "multiple",
            enableCellTextSelection: true,
            ensureDomOrder: true,
            animateRows: false,
            suppressColumnVirtualisation: true,
            rowHeight: 26,
            headerHeight: 30,
            rowModelType: "clientSide",
            getRowId: (params) => String(params.data.rowNum),
            theme: agGrid.themeQuartz.withParams(this._themeParams()),
        };

        this._gridApi = agGrid.createGrid(this._gridDiv, gridOptions);
    }

    /** Recreate grid when theme changes */
    updateTheme() {
        const mode = this._mode;
        const liveData = this._liveData;
        const store = this._store;
        const sessionId = this._sessionId;

        this._build();

        if (mode === "live" && liveData) {
            this.setLiveSource(liveData);
        } else if (mode === "session" && store && sessionId) {
            this.setSessionSource(store, sessionId);
        }
    }

    /** Set whether the math column is visible. Rebuilds grid if changed. */
    setMathActive(active) {
        if (active === this._mathActive) return;
        this._mathActive = active;
        // Rebuild to add/remove column
        if (this._mode === "live") {
            this._build();
            if (this._liveData) {
                this._gridApi.setGridOption("rowData", this._liveRowData);
            }
        }
    }

    /** Attach in-memory graph data for live view. */
    setLiveSource(data) {
        this._mode = "live";
        this._liveData = data;
        this._store = null;
        this._sessionId = null;
        this._lastLiveLen = 0;
        this._liveRowData = [];

        if (this._gridApi) {
            this._gridApi.setGridOption("rowData", []);
        }
    }

    /** Attach an IndexedDB session with infinite scrolling. */
    async setSessionSource(store, sessionId, hasMath) {
        this._mode = "session";
        this._store = store;
        this._sessionId = sessionId;
        this._liveData = null;
        this._totalRows = await store.getSessionSampleCount(sessionId);

        // Check if session has math data
        if (hasMath !== undefined) this._mathActive = hasMath;

        // Rebuild grid in infinite row model mode
        this._gridDiv.innerHTML = "";

        const cols = this._baseColumns(false);
        if (this._mathActive) cols.push({
            ...this._mathColDef(),
            filter: undefined,
        });

        const gridOptions = {
            columnDefs: cols,
            defaultColDef: {
                sortable: false,
                resizable: true,
            },
            rowSelection: "multiple",
            enableCellTextSelection: true,
            ensureDomOrder: true,
            animateRows: false,
            rowHeight: 26,
            headerHeight: 30,
            rowModelType: "infinite",
            cacheBlockSize: PAGE_SIZE,
            maxBlocksInCache: 50,
            infiniteInitialRowCount: this._totalRows,
            datasource: this._createSessionDatasource(store, sessionId),
            theme: agGrid.themeQuartz.withParams(this._themeParams()),
        };

        this._gridApi = agGrid.createGrid(this._gridDiv, gridOptions);
    }

    _createSessionDatasource(store, sessionId) {
        const self = this;
        return {
            getRows(params) {
                const offset = params.startRow;
                const limit = params.endRow - params.startRow;

                store.getPage(sessionId, offset, limit).then(rows => {
                    const mapped = rows.map((r, i) => {
                        const row = {
                            rowNum: offset + i + 1,
                            time: r.t,
                            ch1: r.ch1,
                            ch2: r.ch2,
                        };
                        if (r.math != null) row.math = r.math;
                        return row;
                    });

                    const lastRow = (offset + mapped.length >= self._totalRows)
                        ? self._totalRows : -1;
                    params.successCallback(mapped, lastRow);
                }).catch(() => {
                    params.failCallback();
                });
            }
        };
    }

    /** Push new live rows — called on a 200ms timer. */
    refresh() {
        if (this._mode !== "live" || !this._liveData || !this._gridApi) return;

        const d = this._liveData;
        const len = d[0].length;
        if (len === this._lastLiveLen) return;

        // Build row data for new entries
        for (let i = this._lastLiveLen; i < len; i++) {
            const row = {
                rowNum: i + 1,
                time: d[0][i],
                ch1: d[1][i],
                ch2: d[2][i],
            };
            if (this._mathActive && d[3] && d[3][i] != null) {
                row.math = d[3][i];
            }
            this._liveRowData.push(row);
        }

        // Trim if graph data was trimmed (rolling window)
        const trimmed = this._liveRowData.length - len;
        if (trimmed > 0) {
            this._liveRowData.splice(0, trimmed);
            for (let i = 0; i < this._liveRowData.length; i++) {
                this._liveRowData[i].rowNum = i + 1;
            }
        }

        this._lastLiveLen = len;

        this._gridApi.setGridOption("rowData", this._liveRowData);
        this._gridApi.ensureIndexVisible(this._liveRowData.length - 1, "bottom");
    }

    /** Export visible grid data as CSV using AG Grid's native export. */
    exportCsv(fileName) {
        if (!this._gridApi) return;
        const keys = ["time", "ch1", "ch2"];
        if (this._mathActive) keys.push("math");
        this._gridApi.exportDataAsCsv({
            fileName: fileName || `mooshimeter_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
            columnKeys: keys,
        });
    }

    clear() {
        this._liveRowData = [];
        this._lastLiveLen = 0;
        if (this._gridApi) {
            this._gridApi.setGridOption("rowData", []);
        }
    }

    destroy() {
        if (this._gridApi) {
            this._gridApi.destroy();
            this._gridApi = null;
        }
        this.container.innerHTML = "";
    }

    _fmt(v) {
        if (v == null) return "---";
        const abs = Math.abs(v);
        if (abs >= 1000) return v.toFixed(2);
        if (abs >= 1) return v.toFixed(4);
        if (abs >= 0.001) return (v * 1000).toFixed(3) + "m";
        if (abs >= 0.000001) return (v * 1e6).toFixed(2) + "\u00b5";
        if (v === 0) return "0.0000";
        return v.toExponential(3);
    }
}
