/** Binary serialization/deserialization for the Mooshimeter serial protocol. */

export class UnderflowError extends Error {
    constructor() { super("Buffer underflow"); }
}

export class BytePack {
    constructor(buffer = null) {
        if (buffer instanceof ArrayBuffer) {
            this.bytes = new Uint8Array(buffer);
        } else if (buffer instanceof Uint8Array) {
            this.bytes = new Uint8Array(buffer);
        } else if (Array.isArray(buffer)) {
            this.bytes = new Uint8Array(buffer);
        } else {
            this.bytes = new Uint8Array(0);
        }
        this.i = 0;
    }

    _grow(n) {
        const newBuf = new Uint8Array(this.bytes.length + n);
        newBuf.set(this.bytes);
        this.bytes = newBuf;
    }

    putByte(v) {
        this._grow(1);
        this.bytes[this.bytes.length - 1] = v & 0xFF;
    }

    putBytes(arr) {
        const start = this.bytes.length;
        this._grow(arr.length);
        for (let j = 0; j < arr.length; j++) {
            this.bytes[start + j] = arr[j] & 0xFF;
        }
    }

    putU8(v) { this.putByte(v); }

    putU16(v) {
        this.putByte(v & 0xFF);
        this.putByte((v >> 8) & 0xFF);
    }

    putU32(v) {
        this.putByte(v & 0xFF);
        this.putByte((v >> 8) & 0xFF);
        this.putByte((v >> 16) & 0xFF);
        this.putByte((v >> 24) & 0xFF);
    }

    putS8(v) { this.putByte(v & 0xFF); }
    putS16(v) { this.putU16(v & 0xFFFF); }
    putS32(v) { this.putU32(v >>> 0); }

    putFloat(v) {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, v, true); // little-endian
        const arr = new Uint8Array(buf);
        this.putBytes(arr);
    }

    getU8() {
        if (this.bytesRemaining() < 1) throw new UnderflowError();
        return this.bytes[this.i++];
    }

    getU16() {
        if (this.bytesRemaining() < 2) throw new UnderflowError();
        const v = this.bytes[this.i] | (this.bytes[this.i + 1] << 8);
        this.i += 2;
        return v;
    }

    getU32() {
        if (this.bytesRemaining() < 4) throw new UnderflowError();
        const v = (this.bytes[this.i]
            | (this.bytes[this.i + 1] << 8)
            | (this.bytes[this.i + 2] << 16)
            | (this.bytes[this.i + 3] << 24)) >>> 0;
        this.i += 4;
        return v;
    }

    getS8() {
        const v = this.getU8();
        return v & 0x80 ? v - 256 : v;
    }

    getS16() {
        const v = this.getU16();
        return v & 0x8000 ? v - 65536 : v;
    }

    getS32() {
        const v = this.getU32();
        return v > 0x7FFFFFFF ? v - 0x100000000 : v;
    }

    getFloat() {
        if (this.bytesRemaining() < 4) throw new UnderflowError();
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        for (let j = 0; j < 4; j++) {
            view.setUint8(j, this.bytes[this.i + j]);
        }
        this.i += 4;
        return view.getFloat32(0, true); // little-endian
    }

    getBytes(count) {
        if (this.bytesRemaining() < count) throw new UnderflowError();
        const slice = this.bytes.slice(this.i, this.i + count);
        this.i += count;
        return slice;
    }

    getRemainingBytes() {
        return this.bytes.slice(this.i);
    }

    bytesRemaining() {
        return this.bytes.length - this.i;
    }

    toArray() {
        return Array.from(this.bytes);
    }
}
