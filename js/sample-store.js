/**
 * IndexedDB-backed sample store for long-duration logging (24hr+).
 *
 * Samples are buffered in memory and flushed to IndexedDB in batches.
 * The live graph still reads from an in-memory rolling window.
 * Full exports stream from IndexedDB via cursor so memory stays bounded.
 *
 * DB schema:
 *   Database: "mooshimeter_logs"
 *   Object stores:
 *     "sessions"  - { id (auto), name, startTime, endTime, sampleCount, ch1Label, ch2Label }
 *     "samples"   - { id (auto), sessionId, t, ch1, ch2 }
 *       index: "bySession" on sessionId
 */

const DB_NAME = "mooshimeter_logs";
const DB_VERSION = 1;

/** Flush buffer to IDB every this many samples or this many ms, whichever comes first. */
const FLUSH_BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 2000;

export class SampleStore {
    constructor() {
        this.db = null;
        this._activeSessionId = null;
        this._buffer = [];
        this._flushTimer = null;
        this._sampleCount = 0;
        this._startTime = 0;
    }

    /** Open (or create) the database. Call once at app startup. */
    async open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;

                if (!db.objectStoreNames.contains("sessions")) {
                    db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
                }

                if (!db.objectStoreNames.contains("samples")) {
                    const store = db.createObjectStore("samples", { keyPath: "id", autoIncrement: true });
                    store.createIndex("bySession", "sessionId", { unique: false });
                }
            };

            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Start a new logging session. Returns the session ID. */
    async startSession(ch1Label = "CH1", ch2Label = "CH2", mathLabel) {
        await this.flush();

        const session = {
            name: `Session ${new Date().toLocaleString()}`,
            startTime: Date.now(),
            endTime: null,
            sampleCount: 0,
            ch1Label,
            ch2Label,
        };
        if (mathLabel) session.mathLabel = mathLabel;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readwrite");
            const req = tx.objectStore("sessions").add(session);
            req.onsuccess = () => {
                this._activeSessionId = req.result;
                this._sampleCount = 0;
                this._startTime = performance.now();
                this._startFlushTimer();
                resolve(this._activeSessionId);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Add a sample to the buffer. Non-blocking. */
    addSample(ch1, ch2, math) {
        if (this._activeSessionId === null) return;

        const t = (performance.now() - this._startTime) / 1000;
        const sample = { sessionId: this._activeSessionId, t, ch1, ch2 };
        if (math != null) sample.math = math;
        this._buffer.push(sample);
        this._sampleCount++;

        if (this._buffer.length >= FLUSH_BATCH_SIZE) {
            this.flush();
        }
    }

    /** Flush buffered samples to IndexedDB. */
    async flush() {
        if (!this.db || this._buffer.length === 0) return;

        const batch = this._buffer.splice(0);
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("samples", "readwrite");
            const store = tx.objectStore("samples");
            for (const sample of batch) {
                store.add(sample);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /** Stop the active session. Flushes remaining buffer and updates session metadata. */
    async stopSession() {
        if (this._activeSessionId === null) return null;

        this._stopFlushTimer();
        await this.flush();

        const sessionId = this._activeSessionId;
        const count = this._sampleCount;
        this._activeSessionId = null;

        // Update session with final count and end time
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readwrite");
            const store = tx.objectStore("sessions");
            const getReq = store.get(sessionId);

            getReq.onsuccess = () => {
                const session = getReq.result;
                if (session) {
                    session.endTime = Date.now();
                    session.sampleCount = count;
                    store.put(session);
                }
                tx.oncomplete = () => resolve(session);
            };
            getReq.onerror = (e) => reject(e.target.error);
        });
    }

    /** Update a session's title and note after stopping. */
    async updateSessionMeta(sessionId, title, note) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readwrite");
            const store = tx.objectStore("sessions");
            const getReq = store.get(sessionId);

            getReq.onsuccess = () => {
                const session = getReq.result;
                if (session) {
                    if (title !== undefined) session.title = title;
                    if (note !== undefined) session.note = note;
                    store.put(session);
                }
                tx.oncomplete = () => resolve(session);
            };
            getReq.onerror = (e) => reject(e.target.error);
        });
    }

    get isRecording() {
        return this._activeSessionId !== null;
    }

    get activeCount() {
        return this._sampleCount;
    }

    /** List all saved sessions, newest first. */
    async listSessions() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readonly");
            const req = tx.objectStore("sessions").getAll();
            req.onsuccess = () => resolve(req.result.reverse());
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Delete a session and all its samples. */
    async deleteSession(sessionId) {
        // Delete samples by cursor over the bySession index
        await new Promise((resolve, reject) => {
            const tx = this.db.transaction("samples", "readwrite");
            const idx = tx.objectStore("samples").index("bySession");
            const req = idx.openCursor(IDBKeyRange.only(sessionId));

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        // Delete session record
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readwrite");
            tx.objectStore("sessions").delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /** Delete all sessions and samples. */
    async deleteAll() {
        await new Promise((resolve, reject) => {
            const tx = this.db.transaction(["sessions", "samples"], "readwrite");
            tx.objectStore("sessions").clear();
            tx.objectStore("samples").clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Export a session as CSV via streaming cursor.
     * Memory-efficient: builds the file in chunks, never loads all rows at once.
     * Returns a Blob.
     */
    async exportSessionCSV(sessionId) {
        // Get session metadata for headers
        const session = await new Promise((resolve, reject) => {
            const tx = this.db.transaction("sessions", "readonly");
            const req = tx.objectStore("sessions").get(sessionId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });

        if (!session) throw new Error("Session not found");

        const ch1Label = session.ch1Label || "CH1";
        const ch2Label = session.ch2Label || "CH2";
        const mathLabel = session.mathLabel || null;

        // Stream samples in chunks to build CSV
        const chunks = [];

        // Prepend title and note as metadata rows if set
        if (session.title) chunks.push(`Title,${session.title}\n`);
        if (session.note) chunks.push(`Note,${session.note}\n`);

        const header = mathLabel
            ? `Time(s),${ch1Label},${ch2Label},${mathLabel}\n`
            : `Time(s),${ch1Label},${ch2Label}\n`;
        chunks.push(header);
        let lineBuffer = [];
        const CHUNK_LINES = 5000;

        await new Promise((resolve, reject) => {
            const tx = this.db.transaction("samples", "readonly");
            const idx = tx.objectStore("samples").index("bySession");
            const req = idx.openCursor(IDBKeyRange.only(sessionId));

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const s = cursor.value;
                    let line = `${s.t.toFixed(4)},${s.ch1},${s.ch2}`;
                    if (mathLabel) line += `,${s.math != null ? s.math : ""}`;
                    lineBuffer.push(line);
                    if (lineBuffer.length >= CHUNK_LINES) {
                        chunks.push(lineBuffer.join("\n") + "\n");
                        lineBuffer = [];
                    }
                    cursor.continue();
                }
            };
            tx.oncomplete = () => {
                if (lineBuffer.length > 0) {
                    chunks.push(lineBuffer.join("\n") + "\n");
                }
                resolve();
            };
            tx.onerror = (e) => reject(e.target.error);
        });

        return new Blob(chunks, { type: "text/csv" });
    }

    /**
     * Get the total sample count for a session (from metadata, not by counting).
     */
    async getSessionSampleCount(sessionId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("samples", "readonly");
            const idx = tx.objectStore("samples").index("bySession");
            const req = idx.count(IDBKeyRange.only(sessionId));
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Random-access page reading (for virtual-scroll table)              */
    /* ------------------------------------------------------------------ */

    // On first getPage() call for a session we build a primary-key index
    // via openKeyCursor (reads only index entries — fast even for 800K rows).
    // After that, any page is fetched with a single getAll() bounded by the
    // known keys — true O(pageSize) regardless of offset.

    _keyIndex = null;
    _keyIndexSession = null;

    async _buildKeyIndex(sessionId) {
        return new Promise((resolve, reject) => {
            const keys = [];
            const tx = this.db.transaction("samples", "readonly");
            const idx = tx.objectStore("samples").index("bySession");
            const req = idx.openKeyCursor(IDBKeyRange.only(sessionId));

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    keys.push(cursor.primaryKey);
                    cursor.continue();
                }
            };
            tx.oncomplete = () => {
                this._keyIndex = keys;
                this._keyIndexSession = sessionId;
                resolve(keys);
            };
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Retrieve a page of samples for the virtual-scroll table.
     * @param {number} sessionId
     * @param {number} offset  - row offset (0-based)
     * @param {number} limit   - max rows to return
     * @returns {Promise<Object[]>}
     */
    async getPage(sessionId, offset, limit) {
        // Ensure the key index is built for this session
        if (!this._keyIndex || this._keyIndexSession !== sessionId) {
            await this._buildKeyIndex(sessionId);
        }

        if (offset >= this._keyIndex.length || offset < 0) return [];

        const end = Math.min(offset + limit, this._keyIndex.length);
        const minKey = this._keyIndex[offset];
        const maxKey = this._keyIndex[end - 1];

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("samples", "readonly");
            const store = tx.objectStore("samples");
            const range = IDBKeyRange.bound(minKey, maxKey);
            const req = store.getAll(range);

            req.onsuccess = () => {
                // Filter to this session only (handles any interleaved data from other sessions)
                const rows = req.result.filter(r => r.sessionId === sessionId);
                resolve(rows);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Return the total number of rows in the key index (after it's built). */
    get keyIndexSize() {
        return this._keyIndex ? this._keyIndex.length : 0;
    }

    /**
     * Estimate total IndexedDB storage used (approximate).
     * Uses Storage API if available.
     */
    async estimateStorage() {
        if (navigator.storage?.estimate) {
            const est = await navigator.storage.estimate();
            return { used: est.usage || 0, quota: est.quota || 0 };
        }
        return { used: 0, quota: 0 };
    }

    _startFlushTimer() {
        this._stopFlushTimer();
        this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    }

    _stopFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }
}

/**
 * Format a byte count as human-readable string.
 */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format a duration in ms as human-readable string.
 */
export function formatDuration(ms) {
    if (ms == null) return "---";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
}
