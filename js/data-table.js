/**
 * Virtual-scrolling data table for viewing measurement samples.
 *
 * Two data sources:
 *   - "live": reads from the in-memory graph data arrays (rolling window)
 *   - "session": reads from IndexedDB via SampleStore.getPage(), using a
 *     primary-key index for O(1) random page access
 *
 * Only the visible rows (plus a small buffer) are in the DOM at any time,
 * so even a 24hr / 800K+ row session stays responsive.
 */

const ROW_HEIGHT = 26;
const PAGE_SIZE = 100;
const BUFFER_ROWS = 20;
const MAX_CACHED_PAGES = 50;

export class DataTable {
    constructor(container) {
        this.container = container;

        this._mode = "live";       // "live" | "session"
        this._liveData = null;     // ref to graph's [timestamps, ch1, ch2]
        this._store = null;        // SampleStore instance
        this._sessionId = null;
        this._totalRows = 0;

        // Page cache for session mode  (pageIdx → row[])
        this._pageCache = new Map();
        this._pendingPages = new Set();

        this._build();
    }

    /* ------------------------------------------------------------------ */
    /*  DOM                                                                */
    /* ------------------------------------------------------------------ */

    _build() {
        this.container.innerHTML = "";

        this._header = document.createElement("div");
        this._header.className = "dt-header";
        this._header.innerHTML =
            `<div class="dt-cell dt-num">#</div>` +
            `<div class="dt-cell dt-time">Time (s)</div>` +
            `<div class="dt-cell dt-ch1">CH1</div>` +
            `<div class="dt-cell dt-ch2">CH2</div>`;
        this.container.appendChild(this._header);

        this._viewport = document.createElement("div");
        this._viewport.className = "dt-viewport";
        this.container.appendChild(this._viewport);

        this._spacer = document.createElement("div");
        this._spacer.className = "dt-spacer";
        this._viewport.appendChild(this._spacer);

        this._rowsDiv = document.createElement("div");
        this._rowsDiv.className = "dt-rows";
        this._viewport.appendChild(this._rowsDiv);

        this._viewport.addEventListener("scroll", () => this._render(), { passive: true });
    }

    /* ------------------------------------------------------------------ */
    /*  Data sources                                                       */
    /* ------------------------------------------------------------------ */

    /** Attach the in-memory graph data arrays for live view. */
    setLiveSource(data) {
        this._mode = "live";
        this._liveData = data;
        this._store = null;
        this._sessionId = null;
        this._pageCache.clear();
        this.refresh();
    }

    /** Attach an IndexedDB session.  Builds a primary-key index first. */
    async setSessionSource(store, sessionId) {
        this._mode = "session";
        this._store = store;
        this._sessionId = sessionId;
        this._liveData = null;
        this._pageCache.clear();
        this._totalRows = await store.getSessionSampleCount(sessionId);
        this._spacer.style.height = `${this._totalRows * ROW_HEIGHT}px`;
        this._viewport.scrollTop = 0;
        this._render();
    }

    /** Call on a timer to push new live rows into view. */
    refresh() {
        if (this._mode !== "live" || !this._liveData) return;

        this._totalRows = this._liveData[0].length;
        this._spacer.style.height = `${this._totalRows * ROW_HEIGHT}px`;

        // Auto-scroll if user is near the bottom
        const vp = this._viewport;
        const nearBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < ROW_HEIGHT * 3;
        this._render();
        if (nearBottom && this._totalRows > 0) {
            vp.scrollTop = vp.scrollHeight;
        }
    }

    clear() {
        this._totalRows = 0;
        this._pageCache.clear();
        this._spacer.style.height = "0";
        this._rowsDiv.innerHTML = "";
    }

    destroy() {
        this.container.innerHTML = "";
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering (virtual scroll)                                         */
    /* ------------------------------------------------------------------ */

    _render() {
        const scrollTop = this._viewport.scrollTop;
        const viewH = this._viewport.clientHeight;
        if (viewH === 0 || this._totalRows === 0) {
            this._rowsDiv.innerHTML = "";
            return;
        }

        const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
        const last = Math.min(this._totalRows - 1,
            Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + BUFFER_ROWS);

        if (this._mode === "live") {
            this._renderLive(first, last);
        } else {
            this._renderSession(first, last);
        }
    }

    _renderLive(first, last) {
        const d = this._liveData;
        if (!d || d[0].length === 0) { this._rowsDiv.innerHTML = ""; return; }

        const parts = [];
        const end = Math.min(last, d[0].length - 1);
        for (let i = first; i <= end; i++) {
            parts.push(this._rowHTML(i, d[0][i], d[1][i], d[2][i]));
        }
        this._rowsDiv.innerHTML = parts.join("");
    }

    _renderSession(first, last) {
        const firstPage = Math.floor(first / PAGE_SIZE);
        const lastPage = Math.floor(last / PAGE_SIZE);

        // Request any missing pages (+ prefetch neighbours)
        for (let p = Math.max(0, firstPage - 1); p <= lastPage + 1; p++) {
            if (!this._pageCache.has(p) && !this._pendingPages.has(p)) {
                this._loadPage(p);
            }
        }

        const parts = [];
        for (let i = first; i <= last && i < this._totalRows; i++) {
            const pIdx = Math.floor(i / PAGE_SIZE);
            const page = this._pageCache.get(pIdx);
            if (page) {
                const row = page[i - pIdx * PAGE_SIZE];
                if (row) {
                    parts.push(this._rowHTML(i, row.t, row.ch1, row.ch2));
                    continue;
                }
            }
            // Placeholder while loading
            parts.push(this._placeholderHTML(i));
        }
        this._rowsDiv.innerHTML = parts.join("");
    }

    _rowHTML(i, t, ch1, ch2) {
        const top = i * ROW_HEIGHT;
        return `<div class="dt-row" style="top:${top}px">` +
            `<div class="dt-cell dt-num">${i + 1}</div>` +
            `<div class="dt-cell dt-time">${t.toFixed(4)}</div>` +
            `<div class="dt-cell dt-ch1">${this._fmt(ch1)}</div>` +
            `<div class="dt-cell dt-ch2">${this._fmt(ch2)}</div></div>`;
    }

    _placeholderHTML(i) {
        const top = i * ROW_HEIGHT;
        return `<div class="dt-row dt-loading" style="top:${top}px">` +
            `<div class="dt-cell dt-num">${i + 1}</div>` +
            `<div class="dt-cell dt-time">...</div>` +
            `<div class="dt-cell dt-ch1">...</div>` +
            `<div class="dt-cell dt-ch2">...</div></div>`;
    }

    /* ------------------------------------------------------------------ */
    /*  IndexedDB page loading                                             */
    /* ------------------------------------------------------------------ */

    async _loadPage(pageIdx) {
        if (this._pageCache.has(pageIdx) || this._pendingPages.has(pageIdx)) return;
        this._pendingPages.add(pageIdx);

        try {
            const offset = pageIdx * PAGE_SIZE;
            const rows = await this._store.getPage(this._sessionId, offset, PAGE_SIZE);
            this._pageCache.set(pageIdx, rows);
            this._evictCache(pageIdx);
            this._render();
        } catch (e) {
            console.error("Page load error:", e);
        } finally {
            this._pendingPages.delete(pageIdx);
        }
    }

    /** Keep cache bounded; evict pages farthest from current view. */
    _evictCache(currentPage) {
        if (this._pageCache.size <= MAX_CACHED_PAGES) return;

        const keys = [...this._pageCache.keys()];
        keys.sort((a, b) => Math.abs(b - currentPage) - Math.abs(a - currentPage));
        while (this._pageCache.size > MAX_CACHED_PAGES - 10) {
            this._pageCache.delete(keys.pop());
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Formatting                                                         */
    /* ------------------------------------------------------------------ */

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
